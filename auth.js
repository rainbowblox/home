/* auth.js — single-file auth + signup + login + session + guard
   Requires: firebase compat SDK already loaded in the page (app-compat, auth-compat, firestore-compat)
   Put this file after the Firebase scripts.
*/

(function(){
  // ---------- CONFIG ----------
  const firebaseConfig = {
    apiKey: "AIzaSyDnZfP7eGI4vA4fPbJ8PWoOeSmfgRpMBBU",
    authDomain: "rainbowblox-7547b.firebaseapp.com",
    projectId: "rainbowblox-7547b",
    storageBucket: "rainbowblox-7547b.firebasestorage.app",
    messagingSenderId: "202824714199",
    appId: "1:202824714199:web:7766d8fb9ff419e97bed92",
    measurementId: "G-GNGY62BF89"
  };

  // ---------- sanity checks ----------
  if (typeof window.firebase === 'undefined' || !firebase.initializeApp) {
    console.error('Firebase compat SDK not found — include firebase-app-compat, firebase-auth-compat, firebase-firestore-compat first.');
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();
  const Timestamp = firebase.firestore.Timestamp;
  const FieldValue = firebase.firestore.FieldValue;

  // ---------- utilities ----------
  function mobileLog(msg){
    // minimal in-page log for debugging (non-blocking)
    try {
      let el = document.getElementById('mobileDebug');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mobileDebug';
        el.style.position = 'fixed';
        el.style.left = '0';
        el.style.bottom = '0';
        el.style.width = '100%';
        el.style.maxHeight = '180px';
        el.style.overflowY = 'auto';
        el.style.background = 'rgba(0,0,0,0.75)';
        el.style.color = '#fff';
        el.style.fontSize = '12px';
        el.style.zIndex = '99999';
        el.style.padding = '6px';
        el.style.fontFamily = 'monospace, system-ui';
        document.body.appendChild(el);
      }
      const p = document.createElement('div');
      p.textContent = (new Date()).toLocaleTimeString() + ' — ' + msg;
      el.appendChild(p);
      el.scrollTop = el.scrollHeight;
    } catch(e){}
  }

  function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

  function getLocalRbUser(){
    try {
      const s = localStorage.getItem('rb_user');
      if (!s) return null;
      return JSON.parse(s);
    } catch(e){ return null; }
  }
  function setLocalRbUser(obj){
    try { localStorage.setItem('rb_user', JSON.stringify(obj)); } catch(e){}
  }
  function clearLocalRbUser(){
    try { localStorage.removeItem('rb_user'); } catch(e){}
  }

  function computeAge(birthDate){
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  }
  function computeAgeCategory(birthDate){
    const age = computeAge(birthDate);
    if (age >= 7 && age <= 10) return "7-10";
    if (age >= 11 && age <= 13) return "11-13";
    if (age >= 14 && age <= 17) return "14-17";
    return "18+";
  }

  // PBKDF2 helpers for legacy (no-email) accounts
  async function generateSalt(){
    return crypto.getRandomValues(new Uint8Array(16));
  }
  async function deriveKey(password, salt){
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: salt,
      iterations: 120000,
      hash: 'SHA-256'
    }, keyMaterial, 256);
    return new Uint8Array(derived);
  }
  function bufToHex(buf){
    return Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  function hexToBuf(hex){
    const out = new Uint8Array(hex.length/2);
    for (let i=0;i<out.length;i++) out[i] = parseInt(hex.substr(i*2,2),16);
    return out;
  }

  // ---------- Firestore helpers ----------
  async function writeUserDocUsername(username, docData){
    // writes full doc to users/{username} (overwrites)
    const ref = db.collection('users').doc(username);
    await ref.set(docData, { merge: false });
  }

  // Try get user doc by id (username)
  async function getUserDocById(username){
    const ref = db.collection('users').doc(username);
    const snap = await ref.get();
    if (snap.exists) return { id: snap.id, data: snap.data() };
    return null;
  }

  // ---------- auth flow functions (exposed) ----------
  async function signup({ username, email, password, dobStr, location = '', displayName = null }){
    mobileLog('signup() start: ' + username + ' email:' + (email ? 'yes':'no'));
    if (!username || !password || !dobStr) throw new Error('username, password and DOB required');
    username = String(username).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Invalid username format');

    const birthDate = new Date(dobStr);
    if (isNaN(birthDate.getTime())) throw new Error('Invalid birthday');
    const age = computeAge(birthDate);
    if (age < 7) throw new Error('Minimum age is 7');

    const ageCategory = computeAgeCategory(birthDate);
    const display = displayName || username;
    const safeEmail = email && String(email).trim() ? String(email).trim() : '';

    // Build baseline fields exactly as requested
    const baseFields = {
      "Age Category": ageCategory,
      "Birthday": Timestamp.fromDate(birthDate),
      "Display_Name": display,
      "E-mail": safeEmail,
      "Location": location || "",
      "Password": null,
      "Phone Number": 0,
      "ReinBux": "0",
      "Username": username,
      createdAt: FieldValue.serverTimestamp()
    };

    if (safeEmail) {
      // EMAIL PATH: create Firebase Auth user (so Firestore rules that require auth pass)
      try {
        const cred = await auth.createUserWithEmailAndPassword(safeEmail, password);
        // update profile displayName best-effort
        try { await cred.user.updateProfile({ displayName: display }); } catch(e){}

        // write document at users/{username}
        await writeUserDocUsername(username, baseFields);

        // persist session marker locally (firebase auth exists too)
        setLocalRbUser({
          authType: 'firebase',
          id: cred.user.uid,
          username,
          displayName: display,
          email: safeEmail
        });

        // short wait so onAuthStateChanged can propagate
        await sleep(300);
        mobileLog('signup(email) success -> redirect');
        location.href = '/home/index.html';
        return;
      } catch (err) {
        // if email already in use, try to sign in (user may already exist)
        mobileLog('signup email error: ' + (err && err.message ? err.message : String(err)));
        if (err && err.code === 'auth/email-already-in-use') {
          try {
            const cred = await auth.signInWithEmailAndPassword(safeEmail, password);
            // ensure doc exists
            await writeUserDocUsername(username, baseFields).catch(()=>{});
            setLocalRbUser({
              authType: 'firebase',
              id: cred.user.uid,
              username,
              displayName: display,
              email: safeEmail
            });
            await sleep(300);
            location.href = '/home/index.html';
            return;
          } catch(siErr){
            throw new Error('Email already exists and sign-in failed: ' + (siErr && siErr.message ? siErr.message : String(siErr)));
          }
        }
        throw err;
      }
    } else {
      // LEGACY PATH (no email): store pbkdf2 hash + salt in Firestore under users/{username}
      try {
        const salt = await generateSalt();
        const derived = await deriveKey(password, salt);
        const saltHex = bufToHex(salt);
        const hashHex = bufToHex(derived);

        const legacyFields = Object.assign({}, baseFields, {
          Password: hashHex,
          salt: saltHex,
          legacyAuth: true
        });

        // Attempt to write to Firestore. If rules block (permission-denied), fallback to local-only.
        try {
          await writeUserDocUsername(username, legacyFields);
          // success online
          setLocalRbUser({
            authType: 'legacy',
            id: username,
            username,
            displayName: display
          });
          await sleep(200);
          location.href = '/home/index.html';
          return;
        } catch(writeErr) {
          mobileLog('Firestore write failed (legacy): ' + (writeErr && writeErr.message ? writeErr.message : String(writeErr)));
          // fallback: store locally with hash so user can login locally
          setLocalRbUser({
            authType: 'legacy-local',
            id: username,
            username,
            displayName: display,
            Password: hashHex,
            salt: saltHex
          });
          await sleep(200);
          alert('Signup saved locally because Firestore blocked writes. Provide an email later to fully register online.');
          location.href = '/home/index.html';
          return;
        }
      } catch(e){
        throw e;
      }
    }
  }

  async function login({ loginId, password }){
    mobileLog('login() start: ' + loginId);
    if (!loginId || !password) throw new Error('loginId and password required');
    loginId = String(loginId).trim();

    // if looks like email — try Firebase Auth
    if (loginId.includes('@')) {
      try {
        const cred = await auth.signInWithEmailAndPassword(loginId, password);
        const u = cred.user;
        setLocalRbUser({
          authType: 'firebase',
          id: u.uid,
          displayName: u.displayName || loginId,
          email: loginId
        });
        await sleep(300);
        location.href = '/home/index.html';
        return;
      } catch(e){
        mobileLog('Email login failed: ' + (e && e.message ? e.message : String(e)));
        throw e;
      }
    }

    // else treat as username
    try {
      // check if doc users/{username} exists
      const snap = await db.collection('users').doc(loginId).get().catch(()=>null);
      if (!snap || !snap.exists) {
        // fallback: maybe local-only legacy
        const local = getLocalRbUser();
        if (local && (local.id === loginId) && (local.authType && local.authType.startsWith('legacy'))) {
          // verify if stored hash present
          if (local.Password && local.salt) {
            const saltBuf = hexToBuf(local.salt);
            const derived = await deriveKey(password, saltBuf);
            const hashHex = bufToHex(derived);
            if (hashHex === local.Password) {
              setLocalRbUser({
                authType: 'legacy',
                id: loginId,
                displayName: local.displayName || loginId
              });
              await sleep(200);
              location.href = '/home/index.html';
              return;
            } else throw new Error('Invalid password');
          } else {
            // local legacy but no stored hash: permit local login
            setLocalRbUser({
              authType: local.authType,
              id: loginId,
              displayName: local.displayName || loginId
            });
            await sleep(200);
            location.href = '/home/index.html';
            return;
          }
        }
        throw new Error('Account not found');
      }

      const data = snap.data();

      // if legacy stored in Firestore -> verify
      if (data && data.Password && data.salt && data.legacyAuth) {
        const saltBuf = hexToBuf(data.salt);
        const derived = await deriveKey(password, saltBuf);
        const hashHex = bufToHex(derived);
        if (hashHex === data.Password) {
          setLocalRbUser({
            authType: 'legacy',
            id: loginId,
            displayName: data.Display_Name || loginId
          });
          await sleep(200);
          location.href = '/home/index.html';
          return;
        } else throw new Error('Invalid password');
      }

      // else if Firestore doc has E-mail -> try sign in via stored email
      if (data && data["E-mail"]) {
        const email = data["E-mail"];
        if (email) {
          try {
            const cred = await auth.signInWithEmailAndPassword(email, password);
            const u = cred.user;
            setLocalRbUser({
              authType: 'firebase',
              id: u.uid,
              displayName: data.Display_Name || u.displayName || loginId,
              email
            });
            await sleep(300);
            location.href = '/home/index.html';
            return;
          } catch(e){
            throw e;
          }
        }
      }

      throw new Error('No usable auth method found for this account');
    } catch(e){
      mobileLog('login(username) error: ' + (e && e.message ? e.message : String(e)));
      throw e;
    }
  }

  async function logout(){
    try {
      try { await auth.signOut(); } catch(e){}
    } catch(e){}
    clearLocalRbUser();
    location.href = '/';
  }

  // ---------- guard for pages: wait for auth OR local session, else redirect ----------
  // timeoutMs default 8000
  async function ensureAuthOrRedirect(timeoutMs = 8000){
    // quick local check
    const local = getLocalRbUser();
    if (local && (local.authType === 'legacy' || local.authType === 'legacy-local' || local.authType === 'firebase')) {
      // For firebase local marker we still wait a short time for auth propagation
      if (local.authType === 'firebase') {
        // try wait for firebase user presence (short)
        const got = await waitForAuthStateShort(Math.min(3000, timeoutMs));
        if (got) return { mode: 'firebase', id: local.id, displayName: local.displayName };
      } else {
        return { mode: 'legacy', id: local.id, displayName: local.displayName };
      }
    }

    // wait for Firebase auth state
    const user = await waitForAuthState(timeoutMs);
    if (user) {
      const ctx = { mode: 'firebase', uid: user.uid, displayName: user.displayName || null, email: user.email || null };
      // store quick local marker (so next page sees it immediately)
      setLocalRbUser({ authType: 'firebase', id: user.uid, displayName: user.displayName || user.email, email: user.email || '' });
      return ctx;
    }

    // nothing -> redirect to login
    location.href = '/0/index.html';
    return null;
  }

  // helper: wait for auth state but short (no redirect)
  function waitForAuthState(timeout=8000){
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(()=> { if(!done){ done=true; resolve(auth.currentUser || null); } }, timeout);
      const unsub = auth.onAuthStateChanged((u)=>{
        if (!done) { done = true; clearTimeout(t); unsub(); resolve(u || null); }
      });
    });
  }
  function waitForAuthStateShort(timeout=2000){
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(()=> { if(!done){ done=true; resolve(auth.currentUser || null); } }, timeout);
      const unsub = auth.onAuthStateChanged((u)=>{
        if (!done) { done = true; clearTimeout(t); unsub(); resolve(u || null); }
      });
    });
  }

  // helper to expose current user context quickly
  function getCurrentUserContext(){
    const local = getLocalRbUser();
    const u = auth.currentUser;
    if (u) return { authType: 'firebase', id: u.uid, displayName: u.displayName || null, email: u.email || null };
    if (local) return { authType: local.authType || 'legacy-local', id: local.id, displayName: local.displayName || local.id, email: local.email || null };
    return null;
  }

  // ---------- expose to window ----------
  window.RB_AUTH = {
    signup,
    login,
    logout,
    ensureAuthOrRedirect,
    getCurrentUserContext,
    getLocalRbUser,
    setLocalRbUser
  };

  // small startup log
  mobileLog('RB_AUTH initialized');

})();
