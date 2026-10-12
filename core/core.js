/* ============================================================
   J.A.R.V.I.S. — socle de l'application
   - comptes (authenticator) et synchronisation avec le serveur
   - hub d'accueil + navigation entre modules
   - services partagés : voix, messages, feuilles, notifications

   Ajouter un module : voir modules/README.md
   ============================================================ */
'use strict';
(() => {
const APP_VERSION = '5';
const API = location.hostname === 'localhost' ? 'http://localhost:8787' : 'https://jarvis-api.frensh-developpeur.workers.dev';
const APP_URL = 'https://frensh-developpeur.github.io/jarvis/';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
  del(k){ try { localStorage.removeItem(k); } catch(e) {} },
};

const J = window.J = {
  $, $$, esc, ls, APP_URL,
  eur: n => n.toLocaleString('fr-FR', {style:'currency', currency:'EUR'}),
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  r2: n => Math.round(n * 100) / 100,
  modules: [],
};

/* ============================================================
   Session & API
   ============================================================ */
let session = ls.get('jarvis.session');      // {token, user:{username,isAdmin}}
J.user = () => session && session.user;

J.api = async (method, path, data) => {
  const res = await fetch(API + path, {
    method,
    headers: Object.assign({'Content-Type':'application/json'}, session ? {Authorization:'Bearer ' + session.token} : {}),
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
  });
  let out = {};
  try { out = await res.json(); } catch(e) {}
  if (res.status === 401 && session && !path.startsWith('/api/login') && !path.startsWith('/api/register')) {
    logout(true);
  }
  if (!res.ok) { const e = new Error(out.error || 'Erreur ' + res.status); e.status = res.status; throw e; }
  return out;
};

function setSession(s){
  session = s; ls.set('jarvis.session', s);
  ls.set('jarvis.lastUser', s.user.username);
}
function logout(expired){
  if (session) J.api('POST', '/api/logout').catch(() => {});
  session = null; ls.del('jarvis.session');
  stores.clear();
  closeSheet();
  showAuth();
  if (expired) J.toast('Session expirée, reconnectez-vous');
}
J.logout = () => logout(false);

/* ============================================================
   Stockage synchronisé
   Chaque module a un document JSON, mis en cache sur le téléphone
   (utilisable hors ligne) et envoyé au serveur après chaque modif.
   ============================================================ */
const stores = new Map();
const cacheKey = id => 'jarvis.u.' + session.user.username.toLowerCase() + '.' + id;
let syncState = 'ok';   // ok | pending | offline

J.store = (id, defaults) => {
  if (stores.has(id)) return stores.get(id);
  const fresh = () => JSON.parse(JSON.stringify(defaults));
  const cached = ls.get(cacheKey(id));
  const st = {
    id,
    data: cached ? Object.assign(fresh(), cached.data) : fresh(),
    updatedAt: cached ? cached.updatedAt : 0,
    dirty: cached ? !!cached.dirty : false,
    listeners: [],
    save(){ st.updatedAt = Date.now(); st.dirty = true; st.persist(); schedulePush(); },
    persist(){ ls.set(cacheKey(id), {data:st.data, updatedAt:st.updatedAt, dirty:st.dirty}); },
    replace(data, updatedAt){ st.data = Object.assign(fresh(), data); st.updatedAt = updatedAt; st.dirty = false; st.persist(); st.listeners.forEach(f => f(st.data)); },
    onChange(f){ st.listeners.push(f); },
  };
  stores.set(id, st);
  return st;
};

let pushTimer = null;
function schedulePush(){ setSync('pending'); clearTimeout(pushTimer); pushTimer = setTimeout(pushAll, 700); }
async function pushAll(){
  if (!session) return;
  const dirty = [...stores.values()].filter(s => s.dirty);
  try {
    for (const st of dirty) {
      const sentAt = st.updatedAt;
      await J.api('PUT', '/api/data/' + st.id, {data:st.data, updatedAt:sentAt});
      if (st.updatedAt === sentAt) { st.dirty = false; st.persist(); }   // pas de modif entre-temps
    }
    setSync([...stores.values()].some(s => s.dirty) ? 'pending' : 'ok');
  } catch(e) {
    if (e.status !== 401) setSync('offline');
  }
}
let syncing = null;
J.sync = () => syncing || (syncing = (async () => {
  if (!session) return;
  try {
    const {modules} = await J.api('GET', '/api/data');
    migrateLegacy(modules);
    for (const [id, remote] of Object.entries(modules)) {
      const st = stores.get(id);
      if (!st) { ls.set(cacheKey(id), {data:remote.data, updatedAt:remote.updatedAt, dirty:false}); continue; }
      if (!st.dirty && remote.updatedAt > st.updatedAt) st.replace(remote.data, remote.updatedAt);
    }
    await pushAll();
  } catch(e) {
    if (e.status !== 401) setSync('offline');
  } finally { syncing = null; }
})());

/* Données créées avant les comptes (stockées seulement sur le téléphone) : envoyées une fois sur le compte */
function migrateLegacy(remote){
  const legacy = ls.get('jarvis.finances.v1');
  if (!legacy || remote.finances) return;
  const st = stores.get('finances');
  if (!st) return;
  st.data.tx = legacy.tx || []; st.data.rec = legacy.rec || [];
  st.save(); st.listeners.forEach(f => f(st.data));
  const core = stores.get('core');
  if (core && legacy.settings && legacy.settings.name) { core.data.name = legacy.settings.name; core.data.voice = legacy.settings.voice !== false; core.save(); }
  ls.set('jarvis.finances.v1.migrated', legacy); ls.del('jarvis.finances.v1');
  J.toast('Vos données existantes ont été transférées sur votre compte');
}

function setSync(s){
  syncState = s;
  const el = $('#syncState'); if (!el) return;
  el.innerHTML = s === 'ok' ? 'SYNC <b>OK</b>' : s === 'pending' ? 'SYNC <b style="color:var(--gold)">…</b>' : 'SYNC <b style="color:var(--red)">HORS LIGNE</b>';
}

/* ============================================================
   Réglages utilisateur (synchronisés)
   ============================================================ */
let prefs;
J.prefs = () => prefs.data;
J.greeting = () => {
  const h = new Date().getHours();
  return (h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour') + ' ' + (prefs ? prefs.data.name : 'Monsieur') + '.';
};

/* ============================================================
   Voix & messages
   ============================================================ */
let typeTimer;
J.say = (text) => {
  const el = $('.view.active .msg'); if (!el) return;
  clearInterval(typeTimer);
  let i = 0;
  el.innerHTML = '<span class="cursor"></span>';
  typeTimer = setInterval(() => {
    i += 2;
    el.innerHTML = esc(text.slice(0, i)) + '<span class="cursor"></span>';
    if (i >= text.length) clearInterval(typeTimer);
  }, 22);
};
J.speak = (text) => {
  if (!prefs || !prefs.data.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = 1.02; u.pitch = 0.9;
  const v = speechSynthesis.getVoices().filter(v => v.lang.startsWith('fr'));
  const pick = v.find(v => /Thomas|Daniel|Nicolas|male/i.test(v.name)) || v[0];
  if (pick) u.voice = pick;
  speechSynthesis.speak(u);
};
let toastT;
J.toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200); };

/* ============================================================
   Feuilles (panneaux qui montent du bas)
   ============================================================ */
let openSheetEl = null;
const veil = $('#veil');
function openSheet(el){ J.haptic && J.haptic(); openSheetEl = el; veil.classList.add('show'); el.classList.add('show'); }
function closeSheet(){ if (!openSheetEl) return; openSheetEl.classList.remove('show'); veil.classList.remove('show'); openSheetEl = null; document.activeElement && document.activeElement.blur(); }
J.openSheet = openSheet; J.closeSheet = closeSheet; J.sheetOpen = () => !!openSheetEl;
veil.addEventListener('click', closeSheet);

/* glisser une feuille vers le bas pour la fermer (comme sur iOS) */
let drag = null;
document.addEventListener('touchstart', e => {
  const sh = e.target.closest('.sheet.show');
  if (!sh || sh.scrollTop > 0 || e.target.closest('input,select,textarea')) return;
  drag = {sh, y:e.touches[0].clientY, dy:0, t:Date.now()};
}, {passive:true});
document.addEventListener('touchmove', e => {
  if (!drag) return;
  drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
  if (drag.dy > 6) { drag.sh.classList.add('dragging'); drag.sh.style.transform = `translateY(${drag.dy}px)`; }
}, {passive:true});
document.addEventListener('touchend', () => {
  if (!drag) return;
  const {sh, dy, t} = drag; drag = null;
  sh.classList.remove('dragging'); sh.style.transform = '';
  if (dy > 110 || (dy > 40 && dy / (Date.now() - t) > .6)) { J.haptic(); closeSheet(); }
});

/* ============================================================
   Réflexes natifs
   ============================================================ */
/* Vibration légère. iOS n'a pas navigator.vibrate : depuis iOS 18, activer un interrupteur
   natif (<input switch>) déclenche le retour haptique du système. */
const hapticEl = (() => {
  const l = document.createElement('label'), i = document.createElement('input');
  i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
  l.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none';
  l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l);
  return l;
})();
J.haptic = () => { if (navigator.vibrate) navigator.vibrate(8); else hapticEl.click(); };
document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
document.addEventListener('gesturestart', e => e.preventDefault());   // pas de zoom à deux doigts
document.addEventListener('dblclick', e => e.preventDefault(), {passive:false});

/* ============================================================
   Réacteur (SVG réutilisable)
   ============================================================ */
J.reactorSVG = (p) => `
<svg viewBox="0 0 240 240" aria-hidden="true">
  <defs>
    <radialGradient id="${p}glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3fe0ff" stop-opacity=".28"/><stop offset="70%" stop-color="#3fe0ff" stop-opacity=".04"/><stop offset="100%" stop-color="#3fe0ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="${p}blur"><feGaussianBlur stdDeviation="2.2"/></filter>
  </defs>
  <circle cx="120" cy="120" r="118" fill="url(#${p}glow)"/>
  <g class="spin"><circle cx="120" cy="120" r="114" fill="none" stroke="#3fe0ff" stroke-opacity=".35" stroke-width="1" stroke-dasharray="1.5 5"/></g>
  <g class="spin rev"><circle cx="120" cy="120" r="104" fill="none" stroke="#3fe0ff" stroke-opacity=".55" stroke-width="3" stroke-dasharray="60 12 8 12"/></g>
  <circle cx="120" cy="120" r="92" fill="none" stroke="#3fe0ff" stroke-opacity=".12" stroke-width="8"/>
  <circle class="arc-glow" cx="120" cy="120" r="92" fill="none" stroke="#3fe0ff" stroke-width="8" stroke-linecap="round" transform="rotate(-90 120 120)" filter="url(#${p}blur)" opacity=".8" stroke-dasharray="0 999"/>
  <circle class="arc" cx="120" cy="120" r="92" fill="none" stroke="#3fe0ff" stroke-width="5" stroke-linecap="round" transform="rotate(-90 120 120)" stroke-dasharray="0 999"/>
  <g class="spin fast"><circle cx="120" cy="120" r="80" fill="none" stroke="#3fe0ff" stroke-opacity=".4" stroke-width="1" stroke-dasharray="20 6 2 6"/></g>
  <circle cx="120" cy="120" r="74" fill="#02101a" fill-opacity=".85" stroke="#3fe0ff" stroke-opacity=".25"/>
</svg>`;
/* ratio de 0 à 1 ; la couleur passe à l'orange puis au rouge */
J.setArc = (root, ratio, color) => {
  const C = 2 * Math.PI * 92;
  const col = color || (ratio >= 1 ? '#ff4d3d' : ratio > .8 ? '#ffb347' : '#3fe0ff');
  $$('.arc,.arc-glow', root).forEach(a => {
    a.setAttribute('stroke', col);
    a.setAttribute('stroke-dasharray', `${Math.max(0.001, Math.min(ratio, 1)) * C} ${C}`);
  });
};

/* ============================================================
   Modules & navigation
   ============================================================ */
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';

/* Déclare un module. Voir modules/README.md pour le détail des champs. */
J.module = (def) => { J.modules.push(Object.assign({soon:false, accent:'#3fe0ff'}, def)); };
J.soon = (def) => J.module(Object.assign({soon:true}, def));

let current = null;   // module ouvert, ou null pour le hub
function showView(el, back){
  $$('.view').forEach(v => v.classList.remove('active', 'back'));
  el.classList.toggle('back', !!back);
  el.classList.add('active');
  window.scrollTo(0, 0);
}
J.go = (id) => {
  closeSheet();
  const mod = id && J.modules.find(m => m.id === id && !m.soon);
  if (current && current.unmount) current.unmount();
  if (!mod) {
    current = null;
    history.replaceState(null, '', '#/');
    showView($('#hub'), true);
    renderHub();
    J.say(hubMessage());
    return;
  }
  current = mod;
  history.replaceState(null, '', '#/' + mod.id);
  const view = $('#modview');
  view.className = 'view ' + (mod.cls || '');
  view.innerHTML = `
    <div class="wrap">
      <header class="top">
        <button class="back-btn" data-back>${ICON_BACK}JARVIS</button>
        <div class="mod-title">${esc(mod.name.toUpperCase())}<small>MODULE ${esc(mod.code)}</small></div>
      </header>
      <div class="msg"></div>
      <div class="mod-body"></div>
    </div>
    <div class="mod-fixed"></div>`;
  showView(view);
  mod.mount($('.mod-body', view), $('.mod-fixed', view));
};
$('#modview').addEventListener('click', e => { if (e.target.closest('[data-back]')) { J.haptic(); J.go(null); } });

/* glisser depuis le bord gauche = retour au hub */
let edge = null;
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  edge = current && !openSheetEl && t.clientX < 28 ? {x:t.clientX, y:t.clientY} : null;
}, {passive:true});
document.addEventListener('touchend', e => {
  if (!edge) return;
  const t = e.changedTouches[0];
  if (t.clientX - edge.x > 70 && Math.abs(t.clientY - edge.y) < 60) { J.haptic(); J.go(null); }
  edge = null;
}, {passive:true});
J.fromEdge = () => !!edge;

/* ============================================================
   Hub
   ============================================================ */
function hubMessage(){
  const briefs = J.modules.filter(m => !m.soon && m.brief).map(m => { try { return m.brief(); } catch(e) { return ''; } }).filter(Boolean);
  return J.greeting() + ' ' + (briefs.length ? briefs.join(' ') : 'Tous les systèmes sont opérationnels.') + ' Où souhaitez-vous aller ?';
}
function renderHub(){
  const d = new Date();
  $('#hubTime').textContent = d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  $('#hubDate').textContent = d.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  $('#hubUser').textContent = session ? session.user.username.toUpperCase() : '';
  const active = J.modules.filter(m => !m.soon), soon = J.modules.filter(m => m.soon);
  $('#tiles').innerHTML = [...active, ...soon].map(m => {
    let s = '';
    try { s = m.soon ? 'EN DÉVELOPPEMENT' : (m.summary ? m.summary() : esc(m.tagline || '')); } catch(e) {}
    return `<button class="tile ${m.soon ? 'soon' : ''}" data-mod="${m.id}" style="--accent:${m.accent}">
      <span class="ic">${m.icon || ''}</span><span class="code">${esc(m.code)}</span>
      <span class="n">${esc(m.name.toUpperCase())}</span><span class="s">${s}</span></button>`;
  }).join('');
  J.setArc($('#hubReactor'), d.getSeconds() / 60, '#3fe0ff');
  setSync(syncState);
}
$('#tiles').addEventListener('click', e => {
  const b = e.target.closest('[data-mod]'); if (!b) return;
  const m = J.modules.find(x => x.id === b.dataset.mod);
  J.haptic();
  if (m.soon) { J.say(`Le module ${m.name} est en cours de développement, ${prefs.data.name}. ${m.tagline ? m.tagline + '.' : ''}`); return; }
  J.go(m.id);
});
$('#hubReactor').addEventListener('click', () => {
  const reports = J.modules.filter(m => !m.soon && m.report).map(m => { try { return m.report(); } catch(e) { return ''; } }).filter(Boolean);
  const d = new Date();
  const txt = `${J.greeting()} Il est ${d.getHours()} heures ${d.getMinutes() || ''}. ${reports.join(' ')}`;
  J.say(txt); J.speak(txt);
});
setInterval(() => { if (!current && document.visibilityState === 'visible' && session) { const d = new Date(); $('#hubTime').textContent = d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}); J.setArc($('#hubReactor'), d.getSeconds() / 60, '#3fe0ff'); } }, 1000);

/* ============================================================
   Réglages
   ============================================================ */
const S$ = s => $(s, $('#settings'));
$('#openSettings').addEventListener('click', openSettings);
function openSettings(){
  S$('#sName').value = prefs.data.name;
  S$('#sVoice').checked = prefs.data.voice;
  S$('#sAccount').textContent = session.user.username + (session.user.isAdmin ? ' · administrateur' : '');
  S$('#adminBox').hidden = !session.user.isAdmin;
  S$('#inviteOut').hidden = true;
  if (session.user.isAdmin) loadAdmin();
  openSheet($('#settings'));
}
S$('#sName').addEventListener('change', e => { prefs.data.name = e.target.value.trim() || 'Monsieur'; prefs.save(); J.say(J.greeting() + ' Bien noté.'); });
S$('#sVoice').addEventListener('change', e => { prefs.data.voice = e.target.checked; prefs.save(); });
S$('#closeSettings').addEventListener('click', closeSheet);
S$('#logout').addEventListener('click', () => logout(false));

/* sauvegarde manuelle (en plus du serveur) */
S$('#exp').addEventListener('click', async () => {
  const out = {app:'jarvis', v:2, date:new Date().toISOString(), user:session.user.username, modules:{}};
  stores.forEach((st, id) => out.modules[id] = st.data);
  const name = 'jarvis-' + session.user.username + '-' + out.date.slice(0, 10) + '.json';
  const file = new File([JSON.stringify(out, null, 2)], name, {type:'application/json'});
  try {
    if (navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file], title:'Sauvegarde Jarvis'});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    J.toast('Sauvegarde exportée');
  } catch(e) { if (e.name !== 'AbortError') J.toast('Export impossible'); }
});
S$('#impBtn').addEventListener('click', () => S$('#imp').click());
S$('#imp').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const mods = d.modules || (Array.isArray(d.tx) ? {finances:{tx:d.tx, rec:d.rec || []}} : null);   // ancien format
    if (!mods) throw 0;
    for (const [id, data] of Object.entries(mods)) { const st = J.store(id, {}); st.replace(data, Date.now()); st.save(); }
    closeSheet(); J.toast('Sauvegarde restaurée'); J.go(current && current.id);
  } catch(err) { J.toast('Fichier de sauvegarde invalide'); }
});

/* administration : invitations et comptes */
async function loadAdmin(){
  const box = S$('#adminList');
  box.innerHTML = '<p class="note">Chargement…</p>';
  try {
    const [{users}, {invites}] = await Promise.all([J.api('GET', '/api/users'), J.api('GET', '/api/invites')]);
    const open = invites.filter(i => !i.usedBy && i.expiresAt > Date.now());
    box.innerHTML =
      `<p class="note"><b>Comptes (${users.length})</b></p>` +
      users.map(u => `<div class="arow"><span>${esc(u.username)}${u.isAdmin ? ' <span class="tag">ADMIN</span>' : ''}</span>
        ${u.isAdmin ? '' : `<span><button class="mini" data-reset="${esc(u.username)}">RÉINIT.</button><button class="mini red" data-deluser="${esc(u.username)}">SUPPR.</button></span>`}</div>`).join('') +
      (open.length ? `<p class="note" style="margin-top:12px"><b>Invitations en cours</b></p>` + open.map(i =>
        `<div class="arow"><span><code>${esc(i.code)}</code> ${i.resetUser ? '· réinit. ' + esc(i.resetUser) : ''}</span><button class="mini red" data-delinv="${esc(i.code)}">ANNULER</button></div>`).join('') : '');
  } catch(e) { box.innerHTML = '<p class="note">Impossible de charger (hors ligne ?)</p>'; }
}
async function makeInvite(resetUser){
  try {
    const inv = await J.api('POST', '/api/invites', resetUser ? {resetUser} : {});
    const out = S$('#inviteOut');
    out.hidden = false;
    const text = resetUser
      ? `Réinitialisation de ton accès Jarvis : ouvre ${APP_URL} → « J'ai un code d'invitation », utilise ton identifiant « ${resetUser} » et le code ${inv.code} (valable 7 jours).`
      : `Je t'invite sur Jarvis : ouvre ${APP_URL} dans Safari → « J'ai un code d'invitation » et entre le code ${inv.code} (valable 7 jours).`;
    out.innerHTML = `<p class="note">${resetUser ? 'Code de réinitialisation pour ' + esc(resetUser) : 'Nouveau code d\'invitation'} :</p>
      <div class="invite-code">${esc(inv.code)}</div><button class="btn" id="shareInv">PARTAGER</button>`;
    $('#shareInv').onclick = async () => {
      try { if (navigator.share) await navigator.share({text}); else { await navigator.clipboard.writeText(text); J.toast('Copié'); } } catch(e) {}
    };
    loadAdmin();
  } catch(e) { J.toast(e.message); }
}
S$('#newInvite').addEventListener('click', () => makeInvite(null));
let confirmDel = null;
S$('#adminList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.reset) makeInvite(b.dataset.reset);
    if (b.dataset.delinv) { await J.api('DELETE', '/api/invites/' + encodeURIComponent(b.dataset.delinv)); loadAdmin(); }
    if (b.dataset.deluser) {
      if (confirmDel !== b.dataset.deluser) { confirmDel = b.dataset.deluser; b.textContent = 'CONFIRMER ?'; return; }
      confirmDel = null;
      await J.api('DELETE', '/api/users/' + encodeURIComponent(b.dataset.deluser));
      J.toast('Compte supprimé'); loadAdmin();
    }
  } catch(err) { J.toast(err.message); }
});

/* ============================================================
   Connexion / inscription
   ============================================================ */
const A$ = s => $(s, $('#auth'));
let regUser = null;
function authStep(name){ $$('#auth [data-step]').forEach(s => s.hidden = s.dataset.step !== name); A$('.auth-err').textContent = ''; }
function authErr(t){ A$('.auth-err').textContent = t; }
async function showAuth(){
  showView($('#auth'));
  A$('#lUser').value = ls.get('jarvis.lastUser') || '';
  A$('#lCode').value = '';
  authStep('login');
  J.say('Identification requise.');
  try {
    const {needsSetup} = await J.api('GET', '/api/status');
    if (needsSetup) { authStep('register'); A$('#rInviteField').hidden = true; A$('#regForm [data-tologin]').hidden = true; A$('#regTitle').textContent = 'INITIALISATION'; J.say('Premier démarrage. Créez le compte administrateur.'); }
  } catch(e) { J.say('Serveur injoignable. Vérifiez votre connexion.'); }
}
function busy(btn, on){ btn.disabled = on; btn.style.opacity = on ? .5 : 1; }

A$('#toRegister').addEventListener('click', () => { authStep('register'); A$('#rInviteField').hidden = false; A$('#regForm [data-tologin]').hidden = false; A$('#regTitle').textContent = 'NOUVEL UTILISATEUR'; A$('#rInvite').focus(); });
$$('#auth [data-tologin]').forEach(b => b.addEventListener('click', () => authStep('login')));

A$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = A$('#loginForm button[type=submit]'); busy(btn, true);
  try {
    const r = await J.api('POST', '/api/login', {username:A$('#lUser').value.trim(), code:A$('#lCode').value.replace(/\s/g, '')});
    setSession(r); await enter();
  } catch(err) { authErr(err.message); A$('#lCode').value = ''; }
  busy(btn, false);
});
/* code à 6 chiffres saisi (ou rempli automatiquement par iOS) : on valide tout seul */
A$('#lCode').addEventListener('input', e => { if (/^\d{6}$/.test(e.target.value) && A$('#lUser').value.trim()) A$('#loginForm').requestSubmit(); });

A$('#regForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = A$('#regForm button[type=submit]'); busy(btn, true);
  try {
    regUser = A$('#rUser').value.trim();
    const r = await J.api('POST', '/api/register/start', {username:regUser, invite:A$('#rInvite').value.trim()});
    A$('#otpLink').href = r.otpauth;
    A$('#otpSecret').textContent = r.secret.match(/.{1,4}/g).join(' ');
    A$('#qr').innerHTML = '';
    authStep('enroll');
    loadQR().then(() => {
      const q = qrcode(0, 'M'); q.addData(r.otpauth); q.make();
      A$('#qr').innerHTML = q.createSvgTag({cellSize:4, margin:2, scalable:true});
    }).catch(() => { A$('#qr').hidden = true; });
  } catch(err) { authErr(err.message); }
  busy(btn, false);
});
A$('#copySecret').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(A$('#otpSecret').textContent.replace(/\s/g, '')); J.toast('Clé copiée'); } catch(e) {}
});
A$('#enrollForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = A$('#enrollForm button[type=submit]'); busy(btn, true);
  try {
    const r = await J.api('POST', '/api/register/confirm', {username:regUser, code:A$('#eCode').value.replace(/\s/g, '')});
    setSession(r); await enter(true);
  } catch(err) { authErr(err.message); A$('#eCode').value = ''; }
  busy(btn, false);
});
A$('#eCode').addEventListener('input', e => { if (/^\d{6}$/.test(e.target.value)) A$('#enrollForm').requestSubmit(); });

function loadQR(){
  if (window.qrcode) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = ok; s.onerror = ko; document.head.appendChild(s);
  });
}

/* ============================================================
   Démarrage
   ============================================================ */
async function enter(isNew){
  prefs = J.store('core', {name:'Monsieur', voice:true});
  J.modules.forEach(m => { if (!m.soon && m.init) m.init(); });
  J.go(null);
  if (isNew) J.say(`Bienvenue ${session.user.username}. Compte activé${session.user.isAdmin ? ' avec les droits administrateur' : ''}. Où souhaitez-vous aller ?`);
  await J.sync();
  if (!current) { renderHub(); if (!isNew) J.say(hubMessage()); }
}

J.start = () => {
  const steps = ['INITIALISATION…', 'CHARGEMENT DES MODULES…', 'SYSTÈMES EN LIGNE'];
  steps.forEach((s, i) => setTimeout(() => $('#bootTxt').textContent = s, i * 380));
  setTimeout(() => {
    $('#boot').classList.add('done');
    if (session) {
      enter();
      J.api('GET', '/api/me').then(u => { session.user = u; ls.set('jarvis.session', session); }).catch(() => {});
    } else showAuth();
  }, 1250);
  checkUpdate();
};

/* ============================================================
   Mises à jour automatiques & resynchronisation
   ============================================================ */
let swReg = null;
async function checkUpdate(){
  if (!location.protocol.startsWith('http')) return;
  if (swReg) swReg.update().catch(() => {});
  try {
    const r = await fetch('version.json?t=' + Date.now(), {cache:'no-store'});
    const {v} = await r.json();
    if (v && v !== APP_VERSION) applyUpdate();
  } catch(e) {}
}
let updatePending = false;
function applyUpdate(){
  if (openSheetEl) { updatePending = true; return; }   // on n'interrompt pas une saisie
  const last = +sessionStorage.getItem('jarvis.reloadAt') || 0;
  if (Date.now() - last < 30000) return;               // évite une boucle si GitHub sert encore l'ancienne version
  sessionStorage.setItem('jarvis.reloadAt', Date.now());
  location.reload();
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => { swReg = r; }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkUpdate();
  if (session) J.sync().then(() => { if (!current) renderHub(); });
});
window.addEventListener('pageshow', e => { if (e.persisted) checkUpdate(); });
window.addEventListener('online', () => { if (session) J.sync(); });
veil.addEventListener('transitionend', () => { if (updatePending && !openSheetEl) { updatePending = false; applyUpdate(); } });
try {
  const prev = localStorage.getItem('jarvis.version');
  if (prev && prev !== APP_VERSION) setTimeout(() => J.toast('Jarvis mis à jour'), 1600);
  localStorage.setItem('jarvis.version', APP_VERSION);
} catch(e) {}
})();
