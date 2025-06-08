// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase } from "firebase/database";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

export { app, analytics, database }; 