// Firebase configuration - loaded as regular script to avoid import issues
(async function() {
    try {
        // Import Firebase modules dynamically
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const { getAnalytics } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js");
        const { getDatabase } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");

// Your web app's Firebase configuration
        // NOTE: This Firebase API key is safe to expose in client-side code
        // It's not a secret and is designed to be public for client authentication
const firebaseConfig = {
  apiKey: "AIzaSyDrIwGLHc4T5XlH3QBID18Lc48xF9dmDi4",
  authDomain: "quizgame-9916c.firebaseapp.com",
  databaseURL: "https://quizgame-9916c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "quizgame-9916c",
  storageBucket: "quizgame-9916c.firebasestorage.app",
  messagingSenderId: "918293512223",
  appId: "1:918293512223:web:bd261da506d1c1a270952a",
  measurementId: "G-E4883TXD7S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);

        // Make Firebase available globally
        window.firebaseApp = app;
        window.firebaseAnalytics = analytics;
        window.firebaseDatabase = database;
        window.firebaseReady = true;

        console.log('🔥 Firebase initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize Firebase:', error);
        window.firebaseReady = false;
    }
})(); 