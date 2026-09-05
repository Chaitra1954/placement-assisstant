// Register Service Worker for Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(err => console.warn(err));
  });
}

// --- FIREBASE CONFIGURATION ---
// Replace the values below with your exact credentials from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDeie-hnqSsqlHjDr_gOyO7Sjc3dAr-I60",
  authDomain: "placement-assistant-bc0e5.firebaseapp.com",
  projectId: "placement-assistant-bc0e5",
  storageBucket: "placement-assistant-bc0e5.firebasestorage.app",
  messagingSenderId: "139614386732",
  appId: "1:139614386732:web:59961b88f1a687b9a0ef89"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// 1. Toggle API Key Visibility
window.toggleApiKey = function() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleBtn = document.getElementById('toggleApiKeyBtn');
  if (!apiKeyInput) return;
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  if (toggleBtn) toggleBtn.textContent = apiKeyInput.type === "password" ? "👁️ Show" : "🙈 Hide";
};

// --- TIMEZONE-SAFE DATE PARSER ---
function getLocalIsoDate(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseToIsoDate(dateStr) {
  try {
    const cleanStr = dateStr.replace(/(st|nd|rd|th)/i, '').trim();
    const parts = cleanStr.split(/\s+/);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const monthMap = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
      const month = monthMap[parts[1].substring(0, 3).toLowerCase()];
      const year = parts[2];
      if (day && month && year) return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  return getLocalIsoDate(new Date());
}

// 2. Extract & Sync Function
window.extractSchedule = async function() {
  const noticeInput = document.getElementById('noticeInput');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const noticeText = (noticeInput?.value || '').trim();
  const apiKey = (apiKeyInput?.value || '').trim();

  if (!noticeText) {
    alert("Please paste a placement notice first!");
    return;
  }

  let newSchedule = null;
  const currentLocalDate = getLocalIsoDate(new Date());

  // Primary LLM Extraction: Gemini 3.6 Flash
  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract placement event details from this notice into valid JSON format only. Reference local date: ${currentLocalDate}.
              JSON format: {"company": "Company Name", "title": "Event Name", "displayDate": "YYYY-MM-DD", "displayTime": "HH:MM AM/PM", "duration": "e.g. 30 mins", "isoTimestamp": "YYYY-MM-THH:mm:ss"}.\n\nNotice:\n${noticeText}`
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
            duration: parsed.duration || "N/A",
            isoTimestamp: parsed.isoTimestamp || new Date().toISOString(),
            notified: false
          };
        }
      }
    } catch (e) {
      console.warn("Gemini 3.6 API failed, falling back to smart regex parser:", e);
    }
  }

  // Fallback Regex Parser
  if (!newSchedule) {
    const compMatch = noticeText.match(/(?:process of|assessment of|company:)\s*([A-Za-z0-9\s&]+(?:Pvt\.|Ltd\.|Inc\.|Corp)?)/i) || noticeText.match(/(?:Company):\s*(.*)/i);
    const dateMatch = noticeText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})/i);
    const timeMatches = noticeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/gi);
    const eventMatch = noticeText.match(/(?:online assessment|interview|coding test|placement talk|aptitude test)/i);

    const extractedCompany = compMatch ? compMatch[1].replace(/As a mandatory.*/i, '').trim() : "Placement Company";
    const extractedDate = dateMatch ? parseToIsoDate(dateMatch[1]) : currentLocalDate;
    const startTime = timeMatches ? timeMatches[0] : "10:00 AM";
    const durationStr = timeMatches && timeMatches.length > 1 ? `${timeMatches[0]} to ${timeMatches[1]}` : "30 mins";

    let isoTs = new Date().toISOString();
    try {
      const combined = new Date(`${extractedDate} ${startTime}`);
      if (!isNaN(combined.getTime())) isoTs = combined.toISOString();
    } catch(e) {}

    newSchedule = {
      company: extractedCompany,
      title: eventMatch ? (eventMatch[1] || eventMatch[0]) : "Placement Assessment",
      date: extractedDate,
      time: startTime,
      duration: durationStr,
      isoTimestamp: isoTs,
      notified: false
    };
  }

  // Conflict Detection against Firestore Data
  try {
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
      const proceed = confirm(`⚠️ TIMING CONFLICT DETECTED!\n\n"${newSchedule.company}" (${newSchedule.time}) is within 15 minutes of "${overlappingEvent.company}" (${overlappingEvent.time}).\n\nDo you still want to save it?`);
      if (!proceed) return;
    }

    newSchedule.hasConflict = hasConflict;

    // Direct Firestore Write
    await db.collection("schedules").add(newSchedule);
    noticeInput.value = "";
    alert("✨ Event Added and Synced Across All Devices!");

  } catch (err) {
    alert("❌ Error saving to database: " + err.message);
  }
};

// 3. Delete Entry
window.deleteSchedule = async function(docId) {
  try {
    await db.collection("schedules").doc(docId).delete();
  } catch (err) {
    alert("Error deleting entry: " + err.message);
  }
};

// 4. Real-time Firestore Listener
function listenToCloudSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  db.collection("schedules").onSnapshot((snapshot) => {
    const schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (schedules.length === 0) {
      scheduleList.innerHTML = "<p style='color: #6c757d;'>No daily activities planned yet.</p>";
      return;
    }

    // Group schedules by Date string
    const grouped = schedules.reduce((acc, item) => {
      const key = item.date || "Unscheduled";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    scheduleList.innerHTML = Object.keys(grouped).sort().map(date => `
      <div style="margin-bottom: 20px;">
        <h3 style="background: #e9ecef; padding: 8px 12px; border-radius: 4px; color: #495057; font-size: 16px; margin-bottom: 10px;">
          📅 Agenda for ${date}
        </h3>
        ${grouped[date].map(item => `
          <div style="border: 1px solid ${item.hasConflict ? '#ffc107' : '#dee2e6'}; padding: 12px; margin-bottom: 8px; border-radius: 6px; background: ${item.hasConflict ? '#fff9e6' : '#fff'};">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div><strong>🏢 ${item.company}</strong> - ${item.title}</div>
              ${item.hasConflict ? '<span class="conflict-badge">⚠️ Conflict</span>' : ''}
            </div>
            <div style="margin-top: 6px; color: #555; font-size: 13px;">
              ⏰ <strong>Time:</strong> ${item.time} &nbsp;|&nbsp; ⏳ <strong>Duration:</strong> ${item.duration}
            </div>
            <button class="btn-danger" onclick="deleteSchedule('${item.id}')">
              🗑️ Delete Entry
            </button>
          </div>
        `).join('')}
      </div>
    `).join('');
  }, (error) => {
    scheduleList.innerHTML = `<p style="color: #dc3545;">❌ Database Sync Error: ${error.message}</p>`;
  });
}

// 5. 15-Minute Advance Alert Interval Loop
setInterval(async () => {
  if (Notification.permission !== "granted") return;

  try {
    const snapshot = await db.collection("schedules").get();
    const now = new Date().getTime();

    snapshot.docs.forEach(async (doc) => {
      const item = doc.data();
      if (item.notified || !item.isoTimestamp) return;

      const diffMs = new Date(item.isoTimestamp).getTime() - now;

      if (diffMs <= 15 * 60 * 1000 && diffMs > -5 * 60 * 1000) {
        new Notification(`🚨 Placement Alert: ${item.company}`, {
          body: `${item.title} starts in 15 mins (${item.time}) | Duration: ${item.duration}`,
        });
        await db.collection("schedules").doc(doc.id).update({ notified: true });
      }
    });
  } catch (e) {}
}, 15000);

// Initialize State
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.value = localStorage.getItem('geminiApiKey') || '';
    apiKeyInput.addEventListener('input', (e) => localStorage.setItem('geminiApiKey', e.target.value.trim()));
  }
  listenToCloudSchedules();
});
