// Register Service Worker for Background Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js')
      .then(reg => console.log('Service Worker registered successfully:', reg.scope))
      .catch(err => console.warn('Service Worker registration skipped or failed:', err));
  });
}

// 1. Toggle API Key Visibility
window.toggleApiKey = function() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleBtn = document.getElementById('toggleApiKeyBtn');
  
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    toggleBtn.textContent = "🙈 Hide";
  } else {
    apiKeyInput.type = "password";
    toggleBtn.textContent = "👁️ Show";
  }
};

// 2. Enable Notifications
window.requestNotificationPermission = async function() {
  if (!("Notification" in window)) {
    alert("This browser does not support desktop notifications.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("🔔 Daily Schedule Alerts Active!", {
      body: "You will now be notified 15 minutes prior to scheduled events.",
    });
  } else {
    alert("Notification permissions were denied. Please enable them in your browser settings.");
  }
};

// 3. Extract & Save Schedule (Smart Date/Time Parsing)
window.extractSchedule = async function() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const noticeInput = document.getElementById('noticeInput');
  
  const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
  const noticeText = noticeInput ? noticeInput.value.trim() : '';

  if (!noticeText) {
    alert("Please paste a placement notice first!");
    return;
  }

  let newSchedule = null;
  const currentIsoTime = new Date().toISOString();

  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract key placement event info from this notice into valid JSON only. Current time context is ${currentIsoTime}. 
              Format: {"company": "Name", "title": "Event/Role Name", "time": "Readable Time Display", "isoTimestamp": "YYYY-MM-THH:mm:ss"}. 
              Convert relative terms like "today", "tomorrow", or specific times into an accurate ISO-8601 string in local time.\n\nNotice:\n${noticeText}`
            }]
          }]
        })
      });

      const data = await response.json();
      if (data.candidates && data.candidates[0].content.parts[0].text) {
        const rawText = data.candidates[0].content.parts[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          newSchedule = {
            id: Date.now(),
            company: parsed.company || "Placement Company",
            title: parsed.title || "Placement Event",
            time: parsed.time || "Scheduled Time",
            isoTimestamp: parsed.isoTimestamp || null,
            notified: false
          };
        }
      }
    } catch (e) {
      console.warn("Gemini API call failed, using fallback:", e);
    }
  }

  // Basic fallback parser if API is unavailable
  if (!newSchedule) {
    const compMatch = noticeText.match(/Company:\s*(.*)/i);
    const eventMatch = noticeText.match(/Event:\s*(.*)/i);
    const timeMatch = noticeText.match(/Time:\s*(.*)/i);

    newSchedule = {
      id: Date.now(),
      company: compMatch ? compMatch[1] : "Test Corp AI",
      title: eventMatch ? eventMatch[1] : "Live System Test",
      time: timeMatch ? timeMatch[1] : "Upcoming",
      isoTimestamp: null,
      notified: false
    };
  }

  const existingSchedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");

  // Conflict Detection Logic (Checks exact ISO time or matching time string)
  const conflict = existingSchedules.find(item => 
    (item.isoTimestamp && newSchedule.isoTimestamp && item.isoTimestamp === newSchedule.isoTimestamp) ||
    (item.time.toLowerCase() === newSchedule.time.toLowerCase())
  );
  
  if (conflict) {
    const proceed = confirm(`⚠️ SCHEDULE CONFLICT DETECTED!\n\nYou already have "${conflict.company} - ${conflict.title}" scheduled around ${conflict.time}.\n\nDo you still want to add this event?`);
    if (!proceed) return;
  }

  existingSchedules.push(newSchedule);
  localStorage.setItem("placementSchedules", JSON.stringify(existingSchedules));

  noticeInput.value = "";
  alert("✨ Schedule Saved Successfully with Daily Reminders!");
  renderSchedules();
};

// 4. Delete Individual Schedule Item
window.deleteSchedule = function(id) {
  let schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  schedules = schedules.filter(item => item.id !== id);
  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
  renderSchedules();
};

// 5. Render Schedule List
function renderSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  
  if (schedules.length === 0) {
    scheduleList.innerHTML = "<p>No upcoming schedules saved yet.</p>";
    return;
  }

  scheduleList.innerHTML = schedules.map(item => `
    <div style="border: 1px solid #ccc; padding: 12px; margin-bottom: 10px; border-radius: 6px; background: #fff;">
      <div><strong>🏢 ${item.company}</strong> - ${item.title}</div>
      <div style="margin-top: 4px; color: #555;">⏰ Time: ${item.time}</div>
      <button onclick="deleteSchedule(${item.id})" style="background-color: #dc3545; color: white; padding: 5px 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 8px;">
        🗑️ Delete Entry
      </button>
    </div>
  `).join('');
}

// 6. Real-Time Daily Notification Loop (Runs every 30 seconds)
setInterval(() => {
  if (Notification.permission !== "granted") return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  const now = new Date().getTime();

  schedules.forEach(item => {
    if (item.notified) return;

    if (item.isoTimestamp) {
      const eventTime = new Date(item.isoTimestamp).getTime();
      const timeDifference = eventTime - now;

      // Triggers alert if the event is within 15 minutes (900,000 ms) and hasn't passed
      if (timeDifference <= 15 * 60 * 1000 && timeDifference > -5 * 60 * 1000) {
        new Notification(`🚨 Upcoming Placement Alert: ${item.company}`, {
          body: `${item.title} starts in 15 minutes (${item.time})!`,
        });
        item.notified = true;
      }
    } else {
      // Immediate alert fallback if timestamp parsing was unavailable
      new Notification(`📌 New Schedule Logged: ${item.company}`, {
        body: `${item.title} scheduled for ${item.time}`,
      });
      item.notified = true;
    }
  });

  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
}, 30000);

// Restore Key & Data on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.value = localStorage.getItem('geminiApiKey') || '';
    apiKeyInput.addEventListener('input', (e) => {
      localStorage.setItem('geminiApiKey', e.target.value.trim());
    });
  }
  renderSchedules();
});
