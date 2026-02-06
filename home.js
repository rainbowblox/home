// home.js — fixed to match your auth.js and avoid false redirects
(async function(){
  function toast(msg, time=2500){
    const el = document.getElementById('rbToast');
    if(!el) {
      // fallback: use mobileLog if toast missing
      try { window.mobileLog && window.mobileLog(msg); } catch(e){}
      return;
    }
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(()=> el.classList.remove('show'), time);
  }

  function formatDate(ts){
    try {
      const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
      return d && d.toLocaleDateString ? d.toLocaleDateString() : '-';
    } catch(e){ return '-'; }
  }

  if (!window.RB_AUTH) {
    console.error('RB_AUTH missing');
    toast('Backend not ready');
    return;
  }

  // destructure available helpers from auth
  const { auth, db, getLocalRbUser, ensureAuthOrRedirect, getCurrentUserContext } = window.RB_AUTH;

  // Wait for auth/local session (ensureAuthOrRedirect will redirect if none)
  const ctx = await ensureAuthOrRedirect(6000);
  if (!ctx) return; // ensureAuthOrRedirect already redirected

  // Determine docId and userDoc in a robust way
  let docId = null;
  let userDoc = null;

  async function loadUserDoc() {
    // Use the canonical helper that returns either firebase or local context
    const current = getCurrentUserContext ? getCurrentUserContext() : null;

    // If nothing -> redirect (guard)
    if (!current) {
      location.href = '/0/index.html';
      return;
    }

    // If authType is firebase: try multiple strategies:
    if (current.authType === 'firebase') {
      // 1) try doc by current.id (this is uid if auth)
      if (current.id) {
        try {
          const byUid = await db.collection('users').doc(current.id).get().catch(()=>null);
          if (byUid && byUid.exists) {
            docId = byUid.id;
            userDoc = byUid.data();
            return;
          }
        } catch(e){}
      }

      // 2) try by Username == displayName (common when you write doc under username)
      if (current.displayName) {
        try {
          const q = await db.collection('users')
                          .where('Username','==', current.displayName)
                          .limit(1).get().catch(()=>null);
          if (q && !q.empty) {
            docId = q.docs[0].id;
            userDoc = q.docs[0].data();
            return;
          }
        } catch(e){}
      }

      // 3) fallback: maybe there is a local rb_user that maps to a username doc
      const local = getLocalRbUser();
      if (local && local.id) {
        try {
          // local.id may be username or uid; try both
          const s = await db.collection('users').doc(local.id).get().catch(()=>null);
          if (s && s.exists) {
            docId = s.id;
            userDoc = s.data();
            return;
          }
        } catch(e){}
      }
    }

    // If legacy local session: load by local.id (username)
    const local = getLocalRbUser();
    if (local && local.id) {
      const snap = await db.collection('users').doc(local.id).get().catch(()=>null);
      if (snap && snap.exists) {
        docId = snap.id;
        userDoc = snap.data();
        return;
      } else {
        // local-only fallback doc
        docId = local.id;
        userDoc = {
          Display_Name: local.displayName || local.id,
          ReinBux: "0",
          "E-mail": "",
          "Age Category": "",
          Birthday: null,
          Location: ""
        };
        return;
      }
    }

    // nothing found -> redirect to login
    location.href = '/0/index.html';
  }

  await loadUserDoc();

  // If still no doc, bail (redirect likely already happened)
  if (!docId || !userDoc) return;

  // populate UI with profile
  const displayNameEl = document.getElementById('displayName');
  const usernameEl = document.getElementById('usernameField');
  const emailEl = document.getElementById('emailField');
  const birthdayEl = document.getElementById('birthdayField');
  const locationEl = document.getElementById('locationField');
  const reinEl = document.getElementById('reinbuxAmount');
  const friendsEl = document.getElementById('friendsCount');
  const recentGrid = document.getElementById('recentGrid');
  const recentFallback = document.getElementById('recentFallback');

  if (displayNameEl) displayNameEl.textContent = userDoc.Display_Name || docId;
  if (usernameEl) usernameEl.textContent = docId;
  if (emailEl) emailEl.textContent = userDoc['E-mail'] || '—';
  if (birthdayEl) birthdayEl.textContent = userDoc.Birthday ? formatDate(userDoc.Birthday) : '—';
  if (locationEl) locationEl.textContent = userDoc.Location || '—';
  if (reinEl) reinEl.textContent = userDoc.ReinBux || '0';
  if (friendsEl) friendsEl.textContent = (typeof userDoc.FriendsCount !== 'undefined') ? String(userDoc.FriendsCount) : '0';

  // Avatar outfit switch
  const outfitSelect = document.getElementById('outfitSelect');
  const applyOutfit = document.getElementById('applyOutfit');
  const avatarImg = document.getElementById('avatarImg');

  function applySelectedOutfit() {
    const v = outfitSelect ? outfitSelect.value : 'default';
    if (!avatarImg) return;
    if (v === 'default') avatarImg.src = 'assets/avatar-placeholder.png';
    else if (v === 'casual') avatarImg.src = 'assets/avatar-casual.png';
    else if (v === 'formal') avatarImg.src = 'assets/avatar-formal.png';
    else if (v === 'sport') avatarImg.src = 'assets/avatar-sport.png';
    else avatarImg.src = 'assets/avatar-placeholder.png';
    toast('Outfit applied');
    // optional: you can write the outfit selection into Firestore here
  }

  if (applyOutfit) applyOutfit.addEventListener('click', applySelectedOutfit);

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    try {
      try { if (auth && auth.signOut) await auth.signOut(); } catch(e){}
      localStorage.removeItem('rb_user');
      location.href = '/0/index.html';
    } catch(e) {
      toast('Error signing out');
    }
  });

  // Load recent plays
  async function loadRecentPlays() {
    if (!recentGrid || !recentFallback) return;
    recentGrid.innerHTML = '';
    recentFallback.textContent = 'Loading...';

    try {
      const colRef = db.collection('users').doc(docId).collection('recentPlays');
      const snap = await colRef.orderBy('lastPlayed','desc').limit(10).get().catch(()=>null);
      if (snap && !snap.empty) {
        recentFallback.style.display = 'none';
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderRecent(items);
        return;
      }

      if (userDoc && Array.isArray(userDoc.RecentPlays) && userDoc.RecentPlays.length>0) {
        renderRecent(userDoc.RecentPlays.slice(0,10));
        recentFallback.style.display = 'none';
        return;
      }

      recentFallback.textContent = 'Nothing found';
    } catch(e){
      console.error(e);
      recentFallback.textContent = 'Nothing found';
    }
  }

  function renderRecent(items) {
    if (!recentGrid) return;
    recentGrid.innerHTML = '';
    if (!items || items.length===0) {
      recentFallback.textContent = 'Nothing found';
      return;
    }
    recentFallback.style.display = 'none';
    items.slice(0,10).forEach(it => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const img = document.createElement('img');
      img.alt = (it.name||'Game') + ' image';
      img.src = it.iconURL || 'assets/game-placeholder.png';
      const title = document.createElement('div');
      title.className = 'gtitle';
      title.textContent = it.name || 'Untitled';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const likes = typeof it.likesPercent === 'number' ? it.likesPercent + '% likes' : '-';
      const players = typeof it.currentPlayers === 'number' ? it.currentPlayers + ' playing' : '-';
      meta.textContent = `${likes} · ${players}`;
      tile.appendChild(img);
      tile.appendChild(title);
      tile.appendChild(meta);
      recentGrid.appendChild(tile);
    });
  }

  await loadRecentPlays();

  // year footer
  const yearEl = document.getElementById('yearFooter');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // settings button placeholder
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', ()=> toast('Settings will open here'));

})();
