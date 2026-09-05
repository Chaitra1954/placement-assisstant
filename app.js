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
    toggleBtn.textContent = " Hide";
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
    new Notification("🔔 Notifications Enabled!", {
      body: "You will now receive placement schedule alerts on this device.",
    });
  } else {
    alert("Notification permissions were denied. Please enable them in your browser settings.");
  }
};

// 3. Extract & Save Schedule
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

  // Try parsing with Gemini API if key exists, otherwise fallback to standard text extraction
  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract key placement event info from this notice into valid JSON only. Format: {"company": "Name", "title": "Event/Role Name", "time": "Time/Date"}.\n\nNotice:\n${noticeText}`
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
            notified: false
          };
        }
      }
    } catch (e) {
      console.warn("Gemini API call failed, using text fallback:", e);
    }
  }

  // Fallback parser if API key is missing or fails
  if (!newSchedule) {
    const compMatch = noticeText.match(/Company:\s*(.*)/i);
    const eventMatch = noticeText.match(/Event:\s*(.*)/i);
    const timeMatch = noticeText.match(/Time:\s*(.*)/i);

    newSchedule = {
      id: Date.now(),
      company: compMatch ? compMatch[1] : "Test Corp AI",
      title: eventMatch ? eventMatch[1] : "Live System Test",
      time: timeMatch ? timeMatch[1] : "Upcoming",
      notified: false
    };
  }

  // Save to LocalStorage
  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  schedules.push(newSchedule);
  localStorage.setItem("placementSchedules", JSON.stringify(schedules));

  noticeInput.value = "";
  alert("✨ Schedule Saved Successfully!");
  renderSchedules();
};

// 4. Render Schedule List
function renderSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  
  if (schedules.length === 0) {
    scheduleList.innerHTML = "<p>No upcoming schedules saved yet.</p>";
    return;
  }

  scheduleList.innerHTML = schedules.map(item => `
    <div style="border: 1px solid #e0e0e0; padding: 12px; margin-bottom: 10px; border-radius: 6px; background: #fafafa;">
      <strong>🏢 ${item.company}</strong> - ${item.title}<br>
      ⏰ Time: ${item.time}
    </div>
  `).join('');
}

// 5. Restore API key and list on load
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
