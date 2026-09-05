// ==========================================
// 1. SERVICE WORKER REGISTRATION (Background Push)
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js')
      .then((registration) => {
        console.log('Service Worker registered successfully:', registration.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
  });
}

// ==========================================
// 2. PERMISSION REQUEST & INSTANT TEST
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
// 3. BACKGROUND NOTIFICATION LOOP (Tab Fallback)
// ==========================================
// Checks saved schedules every 30 seconds for events starting in 10-15 minutes
setInterval(() => {
  if (Notification.permission !== "granted") return;

  const schedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
  const now = new Date();

  schedules.forEach((item) => {
    if (!item.time || item.notified) return;

    // Parse item time assuming standard HH:MM format or ISO string
    const eventTime = new Date(item.time);
    const diffInMinutes = (eventTime - now) / (1000 * 60);

    // Trigger notification if event is between 0 and 15 minutes away
    if (diffInMinutes > 0 && diffInMinutes <= 15) {
      new Notification(`🚨 Upcoming Event: ${item.company || "Placement Alert"}`, {
        body: `${item.title || "Event"} starts in ${Math.round(diffInMinutes)} minutes!`,
      });
      item.notified = true; // Prevent duplicate alerts
    }
  });

  localStorage.setItem("placementSchedules", JSON.stringify(schedules));
}, 30000);
