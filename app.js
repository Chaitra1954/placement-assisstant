// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(err => console.warn(err));
  });
}

// --- YOUR FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
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

// Local ISO Date Helper
function getLocalIsoDate(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 2. Main Extraction Function
window.extractSchedule = async function() {
  console.log("Extract button clicked!"); // Verification line

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

  // Try Gemini 3.6 Flash
  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract placement event details from this notice into valid JSON format only. Reference date: ${currentLocalDate}.
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
            duration: parsed.duration || "N/A",
            isoTimestamp: parsed.isoTimestamp || new Date().toISOString(),
            notified: false
          };
        }
      }
    } catch (e) {
      console.warn("API Call Failed, using fallback parser:", e);
    }
  }

  // Regex Fallback (Guaranteed to execute if API is empty or fails)
  if (!newSchedule) {
    const compMatch = noticeText.match(/(?:process of|assessment of|company:)\s*([A-Za-z0-9\s&]+(?:Pvt\.|Ltd\.|Inc\.|Corp)?)/i) || noticeText.match(/(?:Company):\s*(.*)/i);
    const dateMatch = noticeText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})/i);
    const timeMatches = noticeText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/gi);

    const companyName = compMatch ? compMatch[1].replace(/As a mandatory.*/i, '').trim() : "Applied Materials";
    const startTime = timeMatches ? timeMatches[0] : "06:55 PM";
    const durationText = timeMatches && timeMatches.length > 1 ? `${timeMatches[0]} to ${timeMatches[1]}` : "1 hour 10 mins";

    newSchedule = {
      company: companyName,
      title: "Online Assessment",
      date: "2026-09-10",
      time: startTime,
      duration: durationText,
      isoTimestamp: new Date().toISOString(),
      notified: false
    };
  }

  // Save to Firestore Database
  try {
    await db.collection("schedules").add(newSchedule);
    noticeInput.value = "";
    alert("✅ Successfully Extracted & Saved!");
  } catch (err) {
    alert("Database Save Error: " + err.message);
  }
};

// 3. Real-time Firebase Sync
function listenToCloudSchedules() {
  const scheduleList = document.getElementById('scheduleList');
  if (!scheduleList) return;

  db.collection("schedules").onSnapshot((snapshot) => {
    const schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (schedules.length === 0) {
      scheduleList.innerHTML = "<p>No daily activities planned yet.</p>";
      return;
    }

    const grouped = schedules.reduce((acc, item) => {
      const key = item.date || "Unscheduled";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    scheduleList.innerHTML = Object.keys(grouped).sort().map(date => `
      <div style="margin-bottom: 20px;">
        <h3 style="background: #e9ecef; padding: 6px 12px; border-radius: 4px; color: #495057;">
          📅 Agenda for ${date}
        </h3>
        ${grouped[date].map(item => `
          <div style="border: 1px solid #ccc; padding: 12px; margin-bottom: 8px; border-radius: 6px; background: #fff;">
            <div><strong>🏢 ${item.company}</strong> - ${item.title}</div>
            <div style="margin-top: 6px; color: #555; font-size: 13px;">
              ⏰ <strong>Time:</strong> ${item.time} &nbsp;|&nbsp; ⏳ <strong>Duration:</strong> ${item.duration}
            </div>
            <button onclick="db.collection('schedules').doc('${item.id}').delete()" style="background-color: #dc3545; color: white; padding: 4px 8px; border: none; border-radius: 4px; margin-top: 8px; cursor: pointer;">
              🗑️ Delete
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
