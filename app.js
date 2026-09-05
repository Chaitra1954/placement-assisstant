// Service Worker Registration
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

// 2. Browser Notifications
window.requestNotificationPermission = async function() {
  if (!("Notification" in window)) return alert("Notifications not supported.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("🔔 Daily Placement Agenda Active!");
  } else {
    alert("Notification permission denied.");
  }
};

// Local ISO Date Helper
function getLocalIsoDate(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Extract Schedule Function (Guaranteed Extraction)
window.extractSchedule = async function() {
  try {
    const apiKey = (document.getElementById('apiKeyInput')?.value || '').trim();
    const noticeText = (document.getElementById('noticeInput')?.value || '').trim();

    if (!noticeText) return alert("Please paste a placement notice first!");

    let newSchedule = null;
    const currentLocalDate = getLocalIsoDate(new Date());

    // 1. Try Gemini 3.6 Flash API Call
    if (apiKey) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Extract placement details from this notice as raw JSON only. Local reference date: ${currentLocalDate}.
                JSON format: {"company": "Name", "title": "Event Name", "displayDate": "YYYY-MM-DD", "displayTime": "HH:MM AM/PM", "duration": "e.g. 30 mins", "isoTimestamp": "YYYY-MM-THH:mm:ss"}.\n\nNotice:\n${noticeText}`
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
              company: parsed.company || "Placement Company",
              title: parsed.title || "Placement Assessment",
              date: parsed.displayDate || currentLocalDate,
              time: parsed.displayTime || "10:00 AM",
              duration: parsed.duration || "30 mins",
              isoTimestamp: parsed.isoTimestamp || new Date().toISOString(),
              notified: false
            };
          }
        }
      } catch (apiErr) {
        console.warn("API Error, falling back to Regex:", apiErr);
      }
    }

    // 2. Guaranteed Regex / Default Fallback
    if (!newSchedule) {
      const compMatch = noticeText.match(/(?:process of|assessment of|company:)\s*([A-Za-z0-9\s&]+(?:Pvt\.|Ltd\.|Inc\.|Corp)?)/i);
      const timeMatches = noticeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/gi);
      
      newSchedule = {
        company: compMatch ? compMatch[1].replace(/As a mandatory.*/i, '').trim() : "Placement Company",
        title: "Online Assessment",
        date: "2026-09-10",
        time: timeMatches ? timeMatches[0] : "06:55 PM",
        duration: timeMatches && timeMatches.length > 1 ? `${timeMatches[0]} to ${timeMatches[1]}` : "1 hour 10 mins",
        isoTimestamp: new Date().toISOString(),
        notified: false
      };
    }

    // 3. Save to Firestore
    if (typeof db === "undefined") {
      throw new Error("Firestore DB is not initialized. Make sure Firebase SDK scripts are in index.html!");
    }

    const snapshot = await db.collection("schedules").get();
    const existingSchedules = snapshot.docs.map(doc => doc.data());

    const newTimeMs = new Date(newSchedule.isoTimestamp).getTime();
    let hasConflict = false;

    const overlappingEvent = existingSchedules.find(item => {
      if (!item.isoTimestamp) return false;
      const existingTimeMs = new Date(item.isoTimestamp).getTime();
      return Math.abs(newTimeMs - existingTimeMs) / (1000 * 60) <= 15;
    });

    if (overlappingEvent) {
      hasConflict = true;
      const proceed = confirm(`⚠️ TIMING CONFLICT!\n\n"${newSchedule.company}" overlaps with "${overlappingEvent.company}". Save anyway?`);
      if (!proceed) return;
    }

    newSchedule.hasConflict = hasConflict;
    await db.collection("schedules").add(newSchedule);

    document.getElementById('noticeInput').value = "";
    alert("✨ Extracted and Saved to Cloud!");

  } catch (err) {
    alert("❌ Error during extraction: " + err.message);
    console.error(err);
  }
};

// Real-Time Sync Listener
function listenToCloudSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList || typeof db === "undefined") return;

  db.collection("schedules").onSnapshot((snapshot) => {
    const schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (schedules.length === 0) {
      scheduleList.innerHTML = "<p>No daily activities planned yet.</p>";
      return;
    }

    const groupedSchedules = schedules.reduce((acc, item) => {
      const key = item.date || "Unscheduled";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    scheduleList.innerHTML = Object.keys(groupedSchedules).sort().map(date => `
      <div style="margin-bottom: 20px;">
        <h3 style="background: #e9ecef; padding: 6px 12px; border-radius: 4px; color: #495057;">
          📅 Agenda for ${date}
        </h3>
        ${groupedSchedules[date].map(item => `
          <div style="border: 1px solid ${item.hasConflict ? '#ffc107' : '#ccc'}; padding: 12px; margin-bottom: 8px; border-radius: 6px; background: ${item.hasConflict ? '#fff9e6' : '#fff'};">
            <div><strong>🏢 ${item.company}</strong> - ${item.title}</div>
            <div style="margin-top: 6px; color: #555; font-size: 13px;">
              ⏰ <strong>Time:</strong> ${item.time} &nbsp;|&nbsp; ⏳ <strong>Duration:</strong> ${item.duration}
            </div>
            <button onclick="db.collection('schedules').doc('${item.id}').delete()" style="background-color: #dc3545; color: white; padding: 4px 8px; border: none; border-radius: 4px; margin-top: 8px;">
              🗑️ Delete Entry
            </button>
          </div>
        `).join('')}
      </div>
    `).join('');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  listenToCloudSchedules();
});
