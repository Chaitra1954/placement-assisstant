// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(err => console.warn(err));
  });
}

// 1. Toggle API Key Visibility
window.toggleApiKey = function() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleBtn = document.getElementById('toggleApiKeyBtn');
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  toggleBtn.textContent = apiKeyInput.type === "password" ? "👁️ Show" : "🙈 Hide";
};

// 2. Notification Authorization
window.requestNotificationPermission = async function() {
  if (!("Notification" in window)) return alert("Notifications not supported in this browser.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("🔔 Daily Placement Alerts Active!", { body: "You will receive notifications 15 minutes prior to scheduled events." });
  } else {
    alert("Permission denied. Enable notifications in your browser settings.");
  }
};

// 3. Extract Schedule (AI + Regex Fallback Parser)
window.extractSchedule = async function() {
  const apiKey = (document.getElementById('apiKeyInput')?.value || '').trim();
  const noticeText = (document.getElementById('noticeInput')?.value || '').trim();

  if (!noticeText) return alert("Please paste a placement notice first!");

  let newSchedule = null;
  const currentIsoTime = new Date().toISOString();

  // Primary Parsing via Gemini API
  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract key placement event info from this notice into valid JSON only. Current time context is ${currentIsoTime}. 
              Format: {"company": "Name", "title": "Event/Role Name", "displayDate": "YYYY-MM-DD", "displayTime": "HH:MM AM/PM", "duration": "e.g. 45 mins / 2 hours", "isoTimestamp": "YYYY-MM-THH:mm:ss"}. 
              Convert relative dates like "today" or "tomorrow" into accurate YYYY-MM-DD dates.\n\nNotice:\n${noticeText}`
            }]
          }]
        })
      });

      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const rawText = data.candidates[0].content.parts[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          newSchedule = {
            id: Date.now(),
            company: parsed.company || "Placement Company",
            title: parsed.title || "Placement Event",
            date: parsed.displayDate || new Date().toISOString().split('T')[0],
            time: parsed.displayTime || "Scheduled Time",
            duration: parsed.duration || "N/A",
            isoTimestamp: parsed.isoTimestamp || new Date().toISOString(),
            notified: false
          };
        }
      }
    } catch (e) {
      console.warn("Gemini API parsing failed, falling back to regex parser:", e);
    }
  }

  // Fallback Text Parser (Runs if Gemini fails or API key is missing)
  if (!newSchedule) {
    const compMatch = noticeText.match(/(?:Company|Organization):\s*(.*)/i);
    const eventMatch = noticeText.match(/(?:Event|Title|Role):\s*(.*)/i);
    const timeMatch = noticeText.match(/(?:Time|Schedule):\s*(.*)/i);
    const dateMatch = noticeText.match(/(?:Date):\s*(.*)/i);
    const durMatch = noticeText.match(/(?:Duration|Length):\s*(.*)/i);

    const todayStr = new Date().toISOString().split('T')[0];

    newSchedule = {
      id: Date.now(),
      company: compMatch ? compMatch[1].trim() : "Placement Company",
      title: eventMatch ? eventMatch[1].trim() : "Placement Assessment",
      date: dateMatch ? dateMatch[1].trim() : todayStr,
      time: timeMatch ? timeMatch[1].trim() : "Upcoming",
      duration: durMatch ? durMatch[1].trim() : "N/A",
      isoTimestamp: new Date().toISOString(),
      notified: false
    };
  }

  const existingSchedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");

  // Concurrency & Overlap Checking (Flags events within 15 mins of each other)
  const newTimeMs = new Date(newSchedule.isoTimestamp).getTime();
  let hasConflict = false;

  const overlappingEvent = existingSchedules.find(item => {
    if (!item.isoTimestamp) return false;
    const existingTimeMs = new Date(item.isoTimestamp).getTime();
    return Math.abs(newTimeMs - existingTimeMs) / (1000 * 60) <= 15;
  });

  if (overlappingEvent) {
    hasConflict = true;
    const proceed = confirm(`⚠️ TIMING CONFLICT DETECTED!\n\n"${newSchedule.company}" (${newSchedule.time}) overlaps with "${overlappingEvent.company}" (${overlappingEvent.time}).\n\nSave to schedule anyway?`);
    if (!proceed) return;
  }

  newSchedule.hasConflict = hasConflict;
  existingSchedules.push(newSchedule);
  localStorage.setItem("placementSchedules", JSON.stringify(existingSchedules));

  document.getElementById('noticeInput').value = "";
  alert("✨ Schedule Added Successfully!");
  renderSchedules();
};

// 4. Delete Schedule Entry
window.deleteSchedule = function(id) {
  let schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  schedules = schedules.filter(item => item.id !== id);
  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
  renderSchedules();
};

// 5. Render Daily Schedule Plan Grouped by Date
function renderSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");

  if (schedules.length === 0) {
    scheduleList.innerHTML = "<p>No daily activities planned yet.</p>";
    return;
  }

  // Group events by Date string
  const groupedSchedules = schedules.reduce((acc, item) => {
    const key = item.date || "Unscheduled Date";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // Output daily agendas
  scheduleList.innerHTML = Object.keys(groupedSchedules).sort().map(date => `
    <div style="margin-bottom: 20px;">
      <h3 style="background: #e9ecef; padding: 6px 12px; border-radius: 4px; margin-bottom: 10px; color: #495057;">
        📅 Agenda for ${date}
      </h3>
      ${groupedSchedules[date].map(item => `
        <div style="border: 1px solid ${item.hasConflict ? '#ffc107' : '#ccc'}; padding: 12px; margin-bottom: 8px; border-radius: 6px; background: ${item.hasConflict ? '#fff9e6' : '#fff'};">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div><strong>🏢 ${item.company}</strong> - ${item.title}</div>
            ${item.hasConflict ? '<span style="background: #ffc107; color: #000; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold;">⚠️ Conflict</span>' : ''}
          </div>
          <div style="margin-top: 6px; color: #555; font-size: 13px;">
            ⏰ <strong>Time:</strong> ${item.time} &nbsp;|&nbsp; ⏳ <strong>Duration:</strong> ${item.duration}
          </div>
          <button onclick="deleteSchedule(${item.id})" style="background-color: #dc3545; color: white; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; margin-top: 8px;">
            🗑️ Delete Entry
          </button>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// 6. Background Notification Loop (Evaluates every 15 seconds)
setInterval(() => {
  if (Notification.permission !== "granted") return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  const now = new Date().getTime();

  schedules.forEach(item => {
    if (item.notified || !item.isoTimestamp) return;

    const diffMs = new Date(item.isoTimestamp).getTime() - now;

    // Fires 15 minutes before event start time
    if (diffMs <= 15 * 60 * 1000 && diffMs > -5 * 60 * 1000) {
      new Notification(`🚨 Placement Alert: ${item.company}`, {
        body: `${item.title} starts in 15 mins (${item.time}) | Duration: ${item.duration}`,
      });
      item.notified = true;
    }
  });

  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
}, 15000);

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.value = localStorage.getItem('geminiApiKey') || '';
    apiKeyInput.addEventListener('input', (e) => localStorage.setItem('geminiApiKey', e.target.value.trim()));
  }
  renderSchedules();
});
