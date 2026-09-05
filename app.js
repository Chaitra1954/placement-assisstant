let schedules = JSON.parse(localStorage.getItem("schedules")) || [];
let notifiedIds = new Set();

// 1. Save and Load API Key automatically via LocalStorage
function saveApiKey() {
  const key = document.getElementById("apiKey").value.trim();
  localStorage.setItem("gemini_api_key", key);
}

function loadApiKey() {
  const savedKey = localStorage.getItem("gemini_api_key");
  if (savedKey) {
    document.getElementById("apiKey").value = savedKey;
  }
}

// 2. Request Desktop Notification Permission
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

// 3. AI Parsing using Gemini 3.6 Flash & Structured JSON Schema
async function addScheduleWithAI() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const rawText = document.getElementById("rawInput").value.trim();
  const btn = document.getElementById("parseBtn");

  if (!apiKey) return alert("Please enter your Gemini API Key!");
  if (!rawText) return alert("Please paste the placement notice text!");

  btn.innerText = "Parsing & Extracting Rules...";
  btn.disabled = true;

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

  // Using local time to prevent UTC timezone offset issues
  const nowLocal = new Date().toString();

  const systemPrompt = `Extract schedule details from this placement notice.
Current local user time reference: ${nowLocal}.
Return a JSON object with:
- company: Company name (string)
- roundType: Event/Round name (string)
- startTimeISO: The exact scheduled start date and time formatted as a valid ISO string (e.g. "2026-09-05T12:20:00") matching the user's local day/time context.
- durationMinutes: Estimated duration in minutes (integer, default 60 if unspecified).
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
    
    // Convert exact target local ISO string to epoch milliseconds
    const startMs = new Date(parsedResult.startTimeISO).getTime();
    const endMs = startMs + ((parsedResult.durationMinutes || 60) * 60000);

    const newEvent = {
      id: Date.now(),
      company: parsedResult.company || "Company",
      roundType: parsedResult.roundType || "Placement Event",
      link: parsedResult.link || "#",
      startTime: startMs,
      endTime: endMs,
      rules: parsedResult.rules || []
    };

    schedules.push(newEvent);
    localStorage.setItem("schedules", JSON.stringify(schedules));
    document.getElementById("rawInput").value = "";
    
    renderSchedules();
    renderDailyDigest(false);
    alert(`Added: ${newEvent.company} (${newEvent.roundType})`);

  } catch (err) {
    alert("Parsing Error: " + err.message);
  } finally {
    btn.innerText = "✨ Extract & Save Schedule";
    btn.disabled = false;
  }
}

// 4. Overlap/Conflict Engine
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

// 5. Daily Morning Briefing Generator
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

  const lastNotifiedDay = localStorage.getItem("last_morning_digest_date");
  if (lastNotifiedDay !== todayStr && Notification.permission === "granted") {
    new Notification("☀️ Morning Placement Briefing", {
      body: `You have ${todaysEvents.length} event(s) scheduled for today. Check your dashboard for details!`,
      requireInteraction: true
    });
    localStorage.setItem("last_morning_digest_date", todayStr);
  }
}

// 6. Render Schedule List with Conflict Indicators & Rule Checklists
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
      </div>
    `;
  });
}

// 7. Background Loop for 15-Minute Warnings
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
renderSchedules();
renderDailyDigest(false);
