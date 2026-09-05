// Import Firebase SDKs for Service Workers
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging-compat.js');

// Initialize Firebase inside the Service Worker
// Replace these placeholders with your actual Firebase config values
firebase.initializeApp({
  apiKey: "AIzaSyDeie-hnqSsqlHjDr_gOyO7Sjc3dAr-I60",
  authDomain: "placement-assistant-bc0e5.firebaseapp.com",
  projectId: "placement-assistant-bc0e5",
  storageBucket: "placement-assistant-bc0e5.appspot.com",
  messagingSenderId: "139614386732",
  appId: "1:139614386732:web:59961b88f1a687b9a0ef89"
});

const messaging = firebase.messaging();

// Handle background notifications when the app/tab is closed
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);

  const notificationTitle = payload.notification?.title || "🚨 Placement Alert";
  const notificationOptions = {
    body: payload.notification?.body || "You have an upcoming placement schedule event.",
    icon: "/icon.png" // Optional: Path to an app icon image
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});