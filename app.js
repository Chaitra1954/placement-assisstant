// ==========================================
// 1. SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js')
      .then((registration) => {
        console.log('Service Worker registered:', registration.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
  });
}

// ==========================================
// 2. TOGGLE API KEY VISIBILITY
// ==========================================
function toggleApiKey() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleBtn = document.getElementById('toggleApiKeyBtn');
  
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    toggleBtn.textContent = " Hide";
  } else {
    apiKeyInput.type = "password";
    toggleBtn.textContent = "👁️ Show";
  }
}

// ==========================================
// 3. ENABLE NOTIFICATIONS BUTTON HANDLER
// ==========================================
async function requestNotificationPermission() {
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
    alert("Notification permissions were denied. Enable them in browser settings.");
  }
}

// ==========================================
// 4. EXTRACT & SAVE SCHEDULE BUTTON HANDLER
// ==========================================
async function extractSchedule() {
  const noticeInput = document.getElementById('noticeInput');
  const noticeText = noticeInput ? noticeInput.value.trim() : "";

  if (!noticeText) {
    alert("Please paste a placement notice first!");
    return;
  }

  // Basic regex parsing fallback
  const companyMatch = noticeText.match(/Company:\s*(.*)/i);
  const eventMatch = noticeText.match(/Event:\s*(.*)/i);
  const timeMatch = noticeText.match(/Time:\s*(.*)/i);

  const newSchedule = {
    id: Date.now(),
    company: companyMatch ? companyMatch[1] : "Test Corp AI",
    title: eventMatch ? eventMatch[1] : "Live System Test",
    time: timeMatch ? timeMatch[1] : "Upcoming",
    notified: false
  };

  const existingSchedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  existingSchedules.push(newSchedule);
  localStorage.setItem("placementSchedules", JSON.stringify(existingSchedules));

  noticeInput.value = "";
  alert("✨ Schedule Extracted & Saved Successfully!");
  renderSchedules();
}

// ==========================================
// 5. RENDER SCHEDULES ON SCREEN
// ==========================================
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

// ==========================================
// 6. BACKGROUND NOTIFICATION LOOP
// ==========================================
setInterval(() => {
  if (Notification.permission !== "granted") return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");

  schedules.forEach((item) => {
    if (item.notified) return;

    new Notification(`🚨 Upcoming Event: ${item.company}`, {
      body: `${item.title} scheduled for ${item.time}`,
    });
    item.notified = true;
  });

  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
}, 30000);

window.addEventListener('DOMContentLoaded', renderSchedules);
