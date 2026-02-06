// auth.js — improved auth init + safe redirect logic
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyDnZfP7eGI4vA4fPbJ8PWoOeSmfgRpMBBU",
    authDomain: "rainbowblox-7547b.firebaseapp.com",
    projectId: "rainbowblox-7547b",
    storageBucket: "rainbowblox-7547b.firebasestorage.app",
    messagingSenderId: "202824714199",
    appId: "1:202824714199:web:7766d8fb9ff419e97bed92",
    measurementId: "G-GNGY62BF89"
  };

  // If firebase SDK missing — short fallback (do not immediately redirect aggressively)
  if (!window.firebase || !firebase.initializeApp) {
    console.error('Firebase SDK not loaded');
    // Let page render a bit (so user sees UI) and then redirect to login
    setTimeout(()=> { location.href = '/0/index.html'; }, 1500);
    return;
  }

  // init app if needed
  try { if (!firebase.apps.length) firebase.initializeApp(firebaseConfig); } catch(e){}

  const auth = firebase.auth();
  const db = firebase.firestore();

  // local helper
  function getLocalRbUser(){
    try {
      const s = localStorage.getItem('rb_user');
      if (!s) return null;
      return JSON.parse(s);
    } catch(e){ return null; }
  }

  // wait for auth state change once (resolve with current user or null)
  function waitForAuthState(timeout = 6000) {
    return new Promise((resolve) => {
      let resolved = false;
      const cleanup = () => { resolved = true; };
      const id = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(auth.currentUser || null); }
      }, timeout);

      const unsub = auth.onAuthStateChanged((user) => {
        if (!resolved) {
          clearTimeout(id);
          cleanup();
          unsub(); // unsubscribe after first trigger
          resolve(user || null);
        }
      });
      // in case onAuthStateChanged fires synchronously, the above will handle it
    });
  }

  // high-level function used by pages to ensure auth or redirect
  async function ensureAuthOrRedirect(opts = {}) {
    // opts: { timeoutMs }
    const timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 6000;
    // first check quick localStorage — if present, allow immediately (legacy)
    const local = getLocalRbUser();
    if (local && (local.authType === 'legacy' || local.authType === 'legacy-local')) {
      // local legacy session allowed without waiting for firebase
      return { mode: 'legacy', id: local.id, displayName: local.displayName || local.id };
    }

    // wait for firebase auth state (but don't block forever)
    const user = await waitForAuthState(timeout);

    if (user) {
      // Firebase user present
      return { mode: 'firebase', uid: user.uid, displayName: user.displayName || null, email: user.email || null };
    }

    // no firebase user and no local -> redirect to login
    location.href = '/0/index.html';
    // return null so callers can handle (though redirect occurs)
    return null;
  }

  // helper for other scripts to get unified user context
  function getCurrentUserContext() {
    const local = getLocalRbUser();
    const u = auth.currentUser;
    if (u) return { authType: 'firebase', id: u.uid, displayName: u.displayName || null, email: u.email || null };
    if (local) return { authType: local.authType || 'legacy-local', id: local.id, displayName: local.displayName || local.id };
    return null;
  }

  // export
  window.RB_AUTH = {
    auth,
    db,
    getLocalRbUser,
    ensureAuthOrRedirect,
    getCurrentUserContext,
    waitForAuthState
  };

})();
