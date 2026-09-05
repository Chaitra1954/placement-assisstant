// 1. Firebase Initialization with your Project Credentials
const firebaseConfig = {
  apiKey: "AIzaSyDeie-hnqSsqlHjDr_gOyO7Sjc3dAr-I60",
  authDomain: "placement-assistant-bc0e5.firebaseapp.com",
  projectId: "placement-assistant-bc0e5",
  storageBucket: "placement-assistant-bc0e5.firebasestorage.app",
  messagingSenderId: "139614386732",
  appId: "1:139614386732:web:59961b88f1a687b9a0ef89",
  measurementId: "G-817L5QV1FE"
};

// Initialize Firebase & Firestore Services
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
if (typeof firebase.analytics === "function") {
  firebase.analytics();
}

let schedules = [];
let notifiedIds = new Set();

// 2. Real-Time Cloud Listener (Syncs changes across devices automatically)
db.collection("schedules").onSnapshot((snapshot) => {
  schedules = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  renderSchedules();
  renderDailyDigest(false);
}, (error) => {
  console.error("Firestore synchronization error:", error);
});

// 3. API Key Management & Masking Functionality
function saveApiKey() {
  const key = document.getElementById("apiKey").value.trim();
  if (key) localStorage.setItem("gemini_api_key", key);
}

function loadApiKey() {
  const savedKey = localStorage.getItem("gemini_api_key");
  const input = document.getElementById("apiKey");
  if (savedKey && input) {
    input.type = "password";
    input.value = savedKey;
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById("apiKey");
  const btn = document.getElementById("toggleBtn");
  if (input.type === "password") {
    input.type = "text";
    btn.innerText = "🙈 Hide";
  } else {
    input.type = "password";
    btn.innerText = "👁️ Show";
  }
}

// 4. Request Desktop Notifications
async function requestNotificationAccess() {
  if (!("Notification" in window)) {
    alert("This browser does not support desktop notifications.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("Notifications Enabled!", {
      body: "You will receive desktop alerts 15 minutes before your schedule."
    });
  }
}

// 5. AI Parser & Direct Cloud Writer
async function addScheduleWithAI() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const rawText = document.getElementById("rawInput").value.trim();
  const btn = document.getElementById("parseBtn");

  if (!apiKey) return alert("Please enter your Gemini API Key!");
  if (!rawText) return alert("Please paste the placement notice text!");

  btn.innerText = "Parsing & Saving to Cloud...";
  btn.disabled = true;

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
  const nowLocal = new Date().toString();

  const systemPrompt = `Extract schedule details from this placement notice.
Current local user time reference: ${nowLocal}.
Return a JSON object with:
- company: Company name (string)
- roundType: Event/Round name (string)
- startTimeISO: The exact scheduled start date and time formatted as a valid ISO string (e.g. "2026-09-05T12:20:00") matching local time.
- durationMinutes: Estimated duration in minutes (integer, default 60).
- link: Test/Meeting URL (string, "" if missing)
- rules: An array of key rules or requirements extracted`;

  const payload = {
    contents: [{ parts: [{ text: `${systemPrompt}\n\nNotice Text:\n${rawText}` }] }],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "OBJECT",
        properties: {
          company: { type: "STRING" },
          roundType: { type: "STRING" },
          startTimeISO: { type: "STRING" },
          durationMinutes: { type: "INTEGER" },
          link: { type: "STRING" },
          rules: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["company", "roundType", "startTimeISO", "durationMinutes", "link", "rules"]
      }
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Parsing error");

    const parsedResult = JSON.parse(data.candidates[0].content.parts[0].text);
    const startMs = new Date(parsedResult.startTimeISO).getTime();
    const endMs = startMs + ((parsedResult.durationMinutes || 60) * 60000);

    const newEvent = {
      company: parsedResult.company || "Company",
      roundType: parsedResult.roundType || "Placement Event",
      link: parsedResult.link || "#",
      startTime: startMs,
      endTime: endMs,
      rules: parsedResult.rules || [],
      createdAt: Date.now()
    };

    // Save directly to Firebase Firestore Cloud Database
    await db.collection("schedules").add(newEvent);

    document.getElementById("rawInput").value = "";
    alert(`Saved to Cloud: ${newEvent.company} (${newEvent.roundType})`);

  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.innerText = "✨ Extract & Save Schedule";
    btn.disabled = false;
  }
}

// 6. Overlap/Conflict Engine
function checkConflicts(event, index) {
  for (let i = 0; i < schedules.length; i++) {
    if (i === index) continue;
    const other = schedules[i];
    if (event.startTime < other.endTime && event.endTime > other.startTime) {
      return true;
    }
  }
  return false;
}

// 7. Cloud Delete Operation
async function deleteSchedule(docId) {
  try {
    await db.collection("schedules").doc(docId).delete();
  } catch (err) {
    alert("Error deleting record from database: " + err.message);
  }
}

// 8. Daily Morning Briefing Generator
function renderDailyDigest(forceShow) {
  const briefingContainer = document.getElementById("briefingContainer");
  const todayStr = new Date().toDateString();
  
  const todaysEvents = schedules.filter(e => 
    new Date(e.startTime).toDateString() === todayStr
  );

  if (todaysEvents.length === 0) {
    if (forceShow) {
      briefingContainer.style.display = "block";
      briefingContainer.innerHTML = "<h3>☀️ Morning Briefing</h3><p>No placement events scheduled for today!</p>";
    }
    return;
  }

  briefingContainer.style.display = "block";
  let html = `<h3>☀️ Daily Placement Briefing (${todayStr})</h3>`;
  html += `<p>You have <strong>${todaysEvents.length} event(s)</strong> lined up today:</p><ul>`;

  todaysEvents.forEach(e => {
    const time = new Date(e.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    html += `<li><strong>${time}</strong> - ${e.company} (${e.roundType})</li>`;
  });
  html += `</ul>`;

  briefingContainer.innerHTML = html;
}

// 9. Render Schedule List with Cloud Record Keys
function renderSchedules() {
  const listDiv = document.getElementById("scheduleList");
  listDiv.innerHTML = "";

  schedules.sort((a, b) => a.startTime - b.startTime);

  schedules.forEach((item, index) => {
    const isConflict = checkConflicts(item, index);
    const startStr = new Date(item.startTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    
    let rulesHtml = "";
    if (item.rules && item.rules.length > 0) {
      rulesHtml = `<div class="checklist"><strong>Extracted Guidelines:</strong><ul>` + 
        item.rules.map(r => `<li>${r}</li>`).join('') + 
        `</ul></div>`;
    }

    listDiv.innerHTML += `
      <div class="card ${isConflict ? 'conflict' : ''}">
        ${isConflict ? '<span class="badge-conflict">⚠️ SCHEDULE CONFLICT</span><br><br>' : ''}
        <strong>${item.company}</strong> — <em>${item.roundType}</em><br>
        📅 Start: ${startStr}<br>
        🔗 ${item.link && item.link !== "#" ? `<a href="${item.link}" target="_blank">Open Event Link</a>` : "No link found"}
        ${rulesHtml}
        <div style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
          <button onclick="deleteSchedule('${item.id}')" style="background-color: #e74c3c; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">
            🗑️ Delete Event
          </button>
        </div>
      </div>
    `;
  });
}

// 10. Background Loop for Warnings
setInterval(() => {
  const now = Date.now();
  schedules.forEach(item => {
    const minutesRemaining = (item.startTime - now) / (1000 * 60);

    if (minutesRemaining > 0 && minutesRemaining <= 15 && !notifiedIds.has(item.id)) {
      if (Notification.permission === "granted") {
        const notif = new Notification(`🚨 Reminder: ${item.company}`, {
          body: `${item.roundType} starts in 15 mins!`,
          requireInteraction: true
        });

        notif.onclick = () => {
          if (item.link && item.link !== "#") window.open(item.link, "_blank");
        };
      }
      notifiedIds.add(item.id);
    }
  });
}, 30000);

// Initialize on page load
loadApiKey();
