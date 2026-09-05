// Register Service Worker for Background Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(err => console.warn(err));
  });
}

// 1. Toggle API Key Visibility
window.toggleApiKey = function() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleBtn = document.getElementById('toggleApiKeyBtn');
  if (!apiKeyInput) return;
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  if (toggleBtn) toggleBtn.textContent = apiKeyInput.type === "password" ? "👁️ Show" : "🙈 Hide";
};

// 2. Enable Notifications
window.requestNotificationPermission = async function() {
  if (!("Notification" in window)) return alert("Notifications are not supported in this browser.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("🔔 Daily Placement Planner Active!", { body: "You will receive alerts 15 minutes prior to scheduled events." });
  } else {
    alert("Notification permissions denied. Please enable them in browser settings.");
  }
};

// --- HELPER FUNCTIONS TO FIX TIMEZONE ROLLBACK BUG ---
function getLocalIsoDate(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseToIsoDate(dateStr) {
  try {
    const cleanStr = dateStr.replace(/(st|nd|rd|th)/i, '');
    const d = new Date(cleanStr);
    if (!isNaN(d.getTime())) {
      return getLocalIsoDate(d); // Safely formats in local timezone
    }
  } catch (e) {}
  return getLocalIsoDate(new Date());
}

// 3. Extract Schedule (Gemini LLM + Smart Fallback Parser)
window.extractSchedule = async function() {
  const apiKey = (document.getElementById('apiKeyInput')?.value || '').trim();
  const noticeText = (document.getElementById('noticeInput')?.value || '').trim();

  if (!noticeText) return alert("Please paste a placement notice first!");

  let newSchedule = null;
  const currentLocalIso = getLocalIsoDate(new Date());

  // Primary LLM Extraction via Gemini 1.5 Flash
  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract key placement event info from this notice into valid JSON only. Current local date is ${currentLocalIso}. 
              Format: {"company": "Name", "title": "Event/Role Name", "displayDate": "YYYY-MM-DD", "displayTime": "HH:MM AM/PM", "duration": "e.g. 30 mins / 2 hours", "isoTimestamp": "YYYY-MM-THH:mm:ss"}. 
              Ensure displayDate matches local date context without shifting timezones.\n\nNotice:\n${noticeText}`
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
            date: parsed.displayDate || currentLocalIso,
            time: parsed.displayTime || "Scheduled Time",
            duration: parsed.duration || "N/A",
            isoTimestamp: parsed.isoTimestamp || new Date().toISOString(),
            notified: false
          };
        }
      }
    } catch (e) {
      console.warn("Gemini API parsing failed, falling back to smart regex parser:", e);
    }
  }

  // Advanced Fallback Parser for Free-Form Paragraph Text & Tables
  if (!newSchedule) {
    const compMatch = noticeText.match(/(?:process of|assessment of|company:)\s*([A-Za-z0-9\s&]+(?:Pvt\.|Ltd\.|Inc\.|Corp)?)/i) || noticeText.match(/(?:Company):\s*(.*)/i);
    const dateMatch = noticeText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})/i) || noticeText.match(/(?:Date):\s*(.*)/i);
    const timeMatches = noticeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/gi);
    const eventMatch = noticeText.match(/(?:online assessment|interview|coding test|placement talk|aptitude test)/i) || noticeText.match(/(?:Event|Title):\s*(.*)/i);

    const extractedCompany = compMatch ? compMatch[1].replace(/As a mandatory.*/i, '').trim() : "Placement Company";
    const extractedDate = dateMatch ? parseToIsoDate(dateMatch[1]) : currentLocalIso;
    const startTime = timeMatches ? timeMatches[0] : "10:00 AM";
    const durationStr = timeMatches && timeMatches.length > 1 ? `${timeMatches[0]} to ${timeMatches[1]}` : "30 mins";

    let isoTs = new Date().toISOString();
    try {
      const combined = new Date(`${extractedDate} ${startTime}`);
      if (!isNaN(combined.getTime())) isoTs = combined.toISOString();
    } catch(e) {}

    newSchedule = {
      id: Date.now(),
      company: extractedCompany,
      title: eventMatch ? (eventMatch[1] || eventMatch[0]) : "Placement Assessment",
      date: extractedDate,
      time: startTime,
      duration: durationStr,
      isoTimestamp: isoTs,
      notified: false
    };
  }

  const existingSchedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");

  // Concurrency & Overlap Checking (15-Minute Window)
  const newTimeMs = new Date(newSchedule.isoTimestamp).getTime();
  let hasConflict = false;

  const overlappingEvent = existingSchedules.find(item => {
    if (!item.isoTimestamp) return false;
    const existingTimeMs = new Date(item.isoTimestamp).getTime();
    return Math.abs(newTimeMs - existingTimeMs) / (1000 * 60) <= 15;
  });

  if (overlappingEvent) {
    hasConflict = true;
    const proceed = confirm(`⚠️ SCHEDULE CONFLICT DETECTED!\n\n"${newSchedule.company}" (${newSchedule.time}) is scheduled within 15 minutes of "${overlappingEvent.company}" (${overlappingEvent.time}).\n\nDo you still want to save it?`);
    if (!proceed) return;
  }

  newSchedule.hasConflict = hasConflict;
  existingSchedules.push(newSchedule);
  localStorage.setItem("placementSchedules", JSON.stringify(existingSchedules));

  const noticeInput = document.getElementById('noticeInput');
  if (noticeInput) noticeInput.value = "";
  alert("✨ Schedule Added Successfully!");
  renderSchedules();
};

// 4. Delete Individual Entry
window.deleteSchedule = function(id) {
  let schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  schedules = schedules.filter(item => item.id !== id);
  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
  renderSchedules();
};

// 5. Render Daily Agendas Grouped by Date
function renderSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");

  if (schedules.length === 0) {
    scheduleList.innerHTML = "<p>No daily activities planned yet.</p>";
    return;
  }

  // Group schedules by Local Date string
  const groupedSchedules = schedules.reduce((acc, item) => {
    const key = item.date || "Unscheduled";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // Output grouped daily agenda cards
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

// 6. Active Background Notification Loop (Evaluates every 15 seconds)
setInterval(() => {
  if (Notification.permission !== "granted") return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  const now = new Date().getTime();

  schedules.forEach(item => {
    if (item.notified || !item.isoTimestamp) return;

    const diffMs = new Date(item.isoTimestamp).getTime() - now;

    // Fires 15 minutes prior to scheduled start time
    if (diffMs <= 15 * 60 * 1000 && diffMs > -5 * 60 * 1000) {
      new Notification(`🚨 Placement Alert: ${item.company}`, {
        body: `${item.title} starts in 15 mins (${item.time}) | Duration: ${item.duration}`,
      });
      item.notified = true;
    }
  });

  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
}, 15000);

// Initialize State
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.value = localStorage.getItem('geminiApiKey') || '';
    apiKeyInput.addEventListener('input', (e) => localStorage.setItem('geminiApiKey', e.target.value.trim()));
  }
  renderSchedules();
});
