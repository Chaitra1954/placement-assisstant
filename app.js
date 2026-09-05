// ==========================================
// 1. SERVICE WORKER REGISTRATION
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
// 2. TOGGLE & SAVE API KEY
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

// Save key automatically when typed
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
// 4. GEMINI AI PARSING & EXTRACT BUTTON
// ==========================================
async function extractSchedule() {
  const apiKey = localStorage.getItem('geminiApiKey') || document.getElementById('apiKeyInput').value.trim();
  const noticeInput = document.getElementById('noticeInput').value.trim();

  if (!apiKey) {
    alert("Please enter and save your Gemini API Key first!");
    return;
  }

  if (!noticeInput) {
    alert("Please paste a placement notice to extract!");
    return;
  }

  try {
    // Direct call to Gemini API for smart extraction
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Extract key placement event info from this notice into valid JSON only. Format: {"company": "Name", "title": "Event/Role Name", "time": "Time/Date"}.\n\nNotice:\n${noticeInput}`
          }]
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      alert("Gemini API Error: " + data.error.message);
      return;
    }

    const rawText = data.candidates[0].content.parts[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsedData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!parsedData) {
      throw new Error("Could not parse schedule JSON from AI response.");
    }

    // Save extracted object to local storage
    const newSchedule = {
      id: Date.now(),
      company: parsedData.company || "Company",
      title: parsedData.title || "Placement Event",
      time: parsedData.time || "Scheduled Time",
      notified: false
    };

    const existingSchedules = JSON.parse(localStorage.getItem("placementSchedules") || "[]");
    existingSchedules.push(newSchedule);
    localStorage.setItem("placementSchedules", JSON.stringify(existingSchedules));

    document.getElementById('noticeInput').value = "";
    alert("✨ Schedule Extracted Successfully!");
    renderSchedules();

  } catch (err) {
    console.error("Extraction Failed:", err);
    alert("Failed to process notice. Check your API key or console for details.");
  }
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
