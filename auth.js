// auth.js
// Initializes Firebase (compat) and exposes a small auth helper used by home.js.
// If user is not authenticated (Firebase user OR localStorage rb_user), redirect to /0/index.html

(function(){
  // Firebase config (use your provided config)
  const firebaseConfig = {
    apiKey: "AIzaSyDnZfP7eGI4vA4fPbJ8PWoOeSmfgRpMBBU",
    authDomain: "rainbowblox-7547b.firebaseapp.com",
    projectId: "rainbowblox-7547b",
    storageBucket: "rainbowblox-7547b.firebasestorage.app",
    messagingSenderId: "202824714199",
    appId: "1:202824714199:web:7766d8fb9ff419e97bed92",
    measurementId: "G-GNGY62BF89"
  };

  if (!window.firebase || !firebase.initializeApp) {
    console.error('Firebase SDK not loaded');
    // If SDK missing, redirect to login page (safe fallback)
    // allow page to show something but redirect to /0/index.html after 1.5s
    setTimeout(()=> location.href = '/0/index.html', 1500);
    return;
  }

  // Initialize (if not already)
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
  } catch(e){ /* ignore if already initialized */ }

  const auth = firebase.auth();
  const db = firebase.firestore();

  // helper: get current session context:
  function getLocalRbUser(){
    try {
      const s = localStorage.getItem('rb_user');
      if (!s) return null;
      return JSON.parse(s);
    } catch(e){ return null; }
  }

  // main check: prefer firebase auth user, else local rb_user
  function ensureAuthOrRedirect(){
    const local = getLocalRbUser();
    const u = auth.currentUser;
    if (u) {
      // signed in via Firebase
      // nothing to do
      return;
    }
    if (local && (local.authType === 'legacy' || local.authType === 'legacy-local')) {
      // allow legacy local session
      return;
    }
    // not logged in -> redirect
    location.href = '/0/index.html';
  }

  // Also wait for auth state change in case page loaded before Firebase resolved
  let done = false;
  auth.onAuthStateChanged((user) => {
    if (!done) {
      ensureAuthOrRedirect();
      done = true;
    }
  });

  // Expose for other scripts
  window.RB_AUTH = {
    auth,
    db,
    getLocalRbUser,
    ensureAuthOrRedirect
  };

  // If auth not ready after 2s, double-check
  setTimeout(()=> {
    if (!done) ensureAuthOrRedirect();
  }, 2000);
})();
