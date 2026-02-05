// home.js
// Requires: firebase compat loaded and auth.js executed (makes window.RB_AUTH available)

(async function(){
  function toast(msg, time=2500){
    const el = document.getElementById('rbToast');
    if(!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(()=> el.classList.remove('show'), time);
  }

  // simple safe helpers
  function formatDate(ts){
    try {
      const d = ts instanceof firebase.firestore.Timestamp ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString();
    } catch(e){ return '-'; }
  }

  // wait until RB_AUTH ready
  if (!window.RB_AUTH) {
    console.error('RB_AUTH missing');
    toast('Backend not ready');
    return;
  }
  const { auth, db, getLocalRbUser } = window.RB_AUTH;

  // determine user id doc: try Firebase uid then local
  let docId = null;
  let userDoc = null;
  async function loadUserDoc() {
    // 1) if firebase user:
    const fbUser = auth.currentUser;
    if (fbUser) {
      // first try doc by uid
      let snap = await db.collection('users').doc(fbUser.uid).get();
      if (snap.exists) {
        docId = snap.id;
        userDoc = snap.data();
        return;
      }
      // else try query by Username == displayName
      if (fbUser.displayName) {
        const q = await db.collection('users').where('Username','==', fbUser.displayName).limit(1).get();
        if (!q.empty) {
          docId = q.docs[0].id;
          userDoc = q.docs[0].data();
          return;
        }
      }
    }

    // 2) fallback to localStorage rb_user
    const local = getLocalRbUser();
    if (local && local.id) {
      const snap = await db.collection('users').doc(local.id).get().catch(()=>null);
      if (snap && snap.exists) {
        docId = snap.id;
        userDoc = snap.data();
        return;
      } else {
        // if no Firestore doc (local-only), build shallow doc from local
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

    // 3) last resort: if no doc, redirect to login
    location.href = '/0/index.html';
  }

  await loadUserDoc();

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
  if (friendsEl) friendsEl.textContent = '0';

  // Avatar simple outfit switch (swap image src or CSS classes)
  const outfitSelect = document.getElementById('outfitSelect');
  const applyOutfit = document.getElementById('applyOutfit');
  const avatarImg = document.getElementById('avatarImg');

  function applySelectedOutfit() {
    const v = outfitSelect.value;
    // For demo: change src depending on selection (placeholders)
    // Make sure you have these assets or use generic colored SVGs
    if (v === 'default') avatarImg.src = '/assets/avatar-placeholder.png';
    else if (v === 'casual') avatarImg.src = '/assets/avatar-casual.png';
    else if (v === 'formal') avatarImg.src = '/assets/avatar-formal.png';
    else if (v === 'sport') avatarImg.src = '/assets/avatar-sport.png';
    else avatarImg.src = '/assets/avatar-placeholder.png';
    toast('Outfit applied');
  }

  if (applyOutfit) applyOutfit.addEventListener('click', applySelectedOutfit);

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    try {
      // sign out firebase if present
      if (auth && auth.currentUser) {
        try { await auth.signOut(); } catch(e){}
      }
      localStorage.removeItem('rb_user');
      location.href = '/0/index.html';
    } catch(e) {
      toast('Error signing out');
    }
  });

  // Load recent plays:
  // Strategy:
  // 1) try subcollection users/{docId}/recentPlays ordered by 'lastPlayed' desc limit 10
  // 2) fallback: check userDoc.RecentPlays array field (if present)
  async function loadRecentPlays() {
    recentGrid.innerHTML = '';
    recentFallback.textContent = 'Loading...';

    try {
      // try subcollection
      const colRef = db.collection('users').doc(docId).collection('recentPlays');
      const snap = await colRef.orderBy('lastPlayed','desc').limit(10).get().catch(()=>null);
      if (snap && !snap.empty) {
        recentFallback.style.display = 'none';
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderRecent(items);
        return;
      }

      // fallback to array field
      if (userDoc && userDoc.RecentPlays && Array.isArray(userDoc.RecentPlays) && userDoc.RecentPlays.length>0) {
        renderRecent(userDoc.RecentPlays.slice(0,10));
        recentFallback.style.display = 'none';
        return;
      }

      // nothing found
      recentFallback.textContent = 'Nothing found';
    } catch(e){
      console.error(e);
      recentFallback.textContent = 'Nothing found';
    }
  }

  function renderRecent(items) {
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
      img.src = it.iconURL || '/assets/game-placeholder.png';
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

  // small UI polish: set year footer
  const yearEl = document.getElementById('yearFooter');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // settings button (placeholder)
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', ()=> toast('Settings will open here'));

})();
