/* ============================================================
   J.A.R.V.I.S. — socle de l'application
   - comptes (authenticator) et synchronisation avec le serveur
   - hub d'accueil + navigation entre modules
   - services partagés : voix, messages, feuilles, notifications

   Ajouter un module : voir modules/README.md
   ============================================================ */
'use strict';
(() => {
const APP_VERSION = '49';
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

/* diagnostic : les erreurs JavaScript sont envoyées au serveur (table logs) */
const sentErr = new Set();
function report(msg){
  try {
    const m = String(msg).slice(0, 1500);
    if (sentErr.has(m) || sentErr.size > 20) return; sentErr.add(m);
    const s = JSON.parse(localStorage.getItem('jarvis.session') || 'null');
    if (!s) return;
    fetch((location.hostname === 'localhost' ? 'http://localhost:8787' : 'https://jarvis-api.frensh-developpeur.workers.dev') + '/api/log', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + s.token},
      body:JSON.stringify({msg:`v${APP_VERSION} · ${navigator.userAgent.replace(/.*(iPhone OS [\d_]+|Mac OS X [\d_]+|Android [\d.]+).*/, '$1')} · ${location.hash} · ${m}`})}).catch(() => {});
  } catch(e) {}
}
window.addEventListener('error', e => report((e.message || 'erreur') + ' @' + String(e.filename || '').split('/').slice(-2).join('/') + ':' + e.lineno + ':' + e.colno + (e.error && e.error.stack ? ' | ' + e.error.stack.split('\n').slice(0, 4).join(' | ') : '')));
window.addEventListener('unhandledrejection', e => report('promesse : ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

const J = window.J = {
  $, $$, esc, ls, APP_URL, report,
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
J.token = () => session && session.token;
J.API = API;

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
  resetViews();
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
    save(){ st.updatedAt = Date.now(); st.dirty = true; st.persist(); schedulePush(); if (J.scheduleNotifs) J.scheduleNotifs(); },
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
/* J.say(text) : machine à écrire ; J.say(text, true) : texte qui arrive en direct (IA) ; J.say(text, 'final') : fin du direct */
let sayLive = false;
J.say = (text, mode) => {
  const el = $('.view.active .msg'); if (!el) return;
  clearInterval(typeTimer);
  if (mode === true) { sayLive = true; el.innerHTML = esc(text) + '<span class="cursor"></span>'; return; }
  if (mode === 'final' && sayLive) { sayLive = false; el.innerHTML = esc(text); return; }
  sayLive = false;
  let i = 0;
  el.innerHTML = '<span class="cursor"></span>';
  typeTimer = setInterval(() => {
    i += 2;
    el.innerHTML = esc(text.slice(0, i)) + '<span class="cursor"></span>';
    if (i >= text.length) clearInterval(typeTimer);
  }, 22);
};
/* J.speak est fourni par core/voice.js */
let toastT;
/* J.toast('Texte') ou J.toast('Supprimé', {action:'ANNULER', onAction(){…}}) */
J.toast = (t, opts = {}) => {
  const el = $('#toast');
  el.innerHTML = esc(t) + (opts.action ? ` <button class="toast-act">${esc(opts.action)}</button>` : '');
  if (opts.action) $('.toast-act', el).onclick = () => { el.classList.remove('show'); J.haptic(); opts.onAction(); };
  el.classList.toggle('has-act', !!opts.action);
  el.classList.add('show'); clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), opts.action ? 4500 : 2200);
};

/* ============================================================
   Feuilles (panneaux qui montent du bas)
   ============================================================ */
let openSheetEl = null;
const veil = $('#veil');
/* Feuille ouverte : la page derrière ne doit pas défiler.
   On NE passe PAS le body en position fixe : en mode écran d'accueil, iOS décale alors tout l'affichage
   (feuille surélevée, barre d'onglets restée en l'air à la fermeture). On bloque plutôt les gestes sur le voile,
   et on remet exactement la position de défilement à la fermeture. */
let lockY = 0;
function lockScroll(){ lockY = window.scrollY; }
function unlockScroll(){
  requestAnimationFrame(() => {
    window.scrollTo(0, lockY);
    document.documentElement.style.setProperty('--kb', '0px');
  });
}
veil.addEventListener('touchmove', e => e.preventDefault(), {passive:false});
/* feuille ouverte : iOS fait défiler la page derrière pour « montrer » le champ touché ; on la remet aussitôt en place
   (sinon la page reste décalée et la feuille se retrouve au mauvais endroit) */
window.addEventListener('scroll', () => {
  if (openSheetEl && Math.abs(window.scrollY - lockY) > 1) { window.scrollTo(0, lockY); onViewport(); }
}, {passive:true});
/* J.focusAfterOpen(input) : met le curseur dans le champ une fois la feuille arrivée (le clavier ne monte pas pendant l'animation) */
J.focusAfterOpen = (input) => {
  const sh = input.closest('.sheet');
  if (!sh) { input.focus(); return; }
  // pendant le geste de l'utilisateur (toucher le +) : l'iPhone n'ouvre le clavier que si le curseur est placé tout de suite.
  // Le clavier monte alors en même temps que la feuille, comme dans une app native.
  if (navigator.userActivation && navigator.userActivation.isActive && sh.classList.contains('show')) { kbExpected = true; input.focus({preventScroll:true}); kbExpected = false; return; }
  let done = false;
  const go = () => { if (done) return; done = true; sh.removeEventListener('transitionend', onEnd); if (sh.classList.contains('show')) input.focus({preventScroll:true}); };
  const onEnd = e => { if (e.target === sh && e.propertyName === 'transform') go(); };
  sh.addEventListener('transitionend', onEnd);
  setTimeout(go, 450);
};
function openSheet(el){
  J.haptic && J.haptic();
  if (openSheetEl && openSheetEl !== el) openSheetEl.classList.remove('show');
  openSheetEl = el; el.scrollTop = 0;
  lockScroll(); document.body.classList.add('sheet-open'); veil.classList.add('show'); el.classList.add('show');
}
function closeSheet(){
  if (!openSheetEl) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  openSheetEl.classList.remove('show'); veil.classList.remove('show'); openSheetEl = null;
  document.body.classList.remove('sheet-open');
  unlockScroll();
}
J.openSheet = openSheet; J.closeSheet = closeSheet; J.sheetOpen = () => !!openSheetEl;
veil.addEventListener('click', closeSheet);

/* clavier iOS : la feuille se pose juste au-dessus du clavier (sans animation parasite) */
const vv = window.visualViewport;
let vvRaf = 0;
function onViewport(){
  cancelAnimationFrame(vvRaf);
  vvRaf = requestAnimationFrame(() => {
    const typing = typeof isTextField === 'function' && isTextField(document.activeElement);
    const kb = typing ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;   // pas de clavier = pas de décalage
    if (kb > 150) ls.set('jarvis.kbh', kb);   // hauteur du clavier retenue : la prochaine fois, la feuille bouge en même temps que lui
    const root = document.documentElement.style;
    root.setProperty('--kb', kb + 'px');
    root.setProperty('--vvh', Math.round(vv.height) + 'px');
    const was = document.body.classList.contains('kb-open');
    document.body.classList.toggle('kb-open', kb > 80);
    if (was && kb <= 80 && !openSheetEl) window.scrollTo(window.scrollX, window.scrollY);
  });
}
if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', onViewport); onViewport(); }
if (vv) vv.addEventListener('scroll', () => { if (Math.abs(vv.offsetLeft) > 0.5 || window.scrollX) window.scrollTo(0, window.scrollY); });   // jamais de décalage horizontal

/* champs de saisie : pas de suggestions iOS là où elles ne servent à rien (montants, quantités, recherches…).
   La barre de suggestions qui apparaît / disparaît change la hauteur du clavier et fait bouger l'écran. */
function tameInput(el){
  if (el.dataset.tamed) return; el.dataset.tamed = '1';
  const num = /decimal|numeric/.test(el.getAttribute('inputmode') || '') || el.type === 'number' || el.type === 'date' || el.type === 'month';
  if (!el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
  if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'off');
  if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false');
  if (num || el.type === 'search' || /search|recherch/i.test(el.placeholder || '')) el.setAttribute('autocapitalize', 'off');
}
const tameAll = root => { if (root.querySelectorAll) root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea').forEach(tameInput); };
tameAll(document);
new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input,textarea')) tameInput(n); else tameAll(n); } })))
  .observe(document.body, {childList:true, subtree:true});

/* saisie de texte : la barre d'onglets et le bouton + s'effacent (sinon iOS les fait flotter au-dessus du clavier),
   et à la fermeture du clavier on remet l'écran d'aplomb (iOS laisse parfois la vue décalée) */
const isTextField = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),textarea,select');
let typingT = 0, focusY = null;
/* iOS n'annonce la nouvelle hauteur visible qu'à la fin de l'animation du clavier : sans anticipation,
   la feuille reste trop haute (champ caché) puis saute. On applique tout de suite la hauteur connue du clavier. */
let predictT = 0;
function predictKeyboard(open){
  if (!openSheetEl) return;
  const root = document.documentElement.style;
  if (open) {
    const kbh = ls.get('jarvis.kbh'); if (!kbh || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb')) > 50) return;
    root.setProperty('--kb', kbh + 'px'); root.setProperty('--vvh', (window.innerHeight - kbh) + 'px');
    // un curseur placé automatiquement n'ouvre pas toujours le clavier (iPhone) : sans clavier réel, la feuille redescend
    clearTimeout(predictT);
    predictT = setTimeout(() => { if (vv && window.innerHeight - vv.height - vv.offsetTop < 100) onViewport(); }, 700);
  } else { root.setProperty('--kb', '0px'); root.setProperty('--vvh', window.innerHeight + 'px'); }
}
/* le clavier ne s'ouvre que si le champ est touché, ou reçoit le curseur pendant un geste : sinon (curseur placé par le code),
   l'iPhone n'ouvre pas de clavier et anticiper sa hauteur laisserait la feuille suspendue au-dessus du vide */
let touchT = 0, touchEl = null, kbExpected = false;
document.addEventListener('touchstart', e => { touchT = Date.now(); touchEl = e.target; }, {passive:true, capture:true});
document.addEventListener('focusin', e => {
  if (!isTextField(e.target)) return;
  const direct = kbExpected || (Date.now() - touchT < 1000 && touchEl && (touchEl === e.target || e.target.contains(touchEl) || (touchEl.closest && touchEl.closest('label') && touchEl.closest('label').contains(e.target))));
  if (e.target.closest('.sheet') && direct) predictKeyboard(true);
  clearTimeout(typingT); document.body.classList.add('typing');
  // champ dans la page (pas dans une feuille) : on retient où était la page avant qu'iOS la fasse remonter
  if (!e.target.closest('.sheet') && focusY === null) focusY = window.scrollY;
});
document.addEventListener('focusout', () => {
  clearTimeout(typingT);
  setTimeout(() => { if (!isTextField(document.activeElement)) predictKeyboard(false); }, 30);
  typingT = setTimeout(() => {
    if (isTextField(document.activeElement)) return;
    document.body.classList.remove('typing');
    onViewport();
    if (!openSheetEl) {
      // clavier fermé : la page revient exactement où elle était (iOS la laisse sinon décalée)
      const y = focusY !== null ? focusY : window.scrollY; focusY = null;
      window.scrollTo(0, y);
      setTimeout(() => {   // une 2e fois, après l'animation du clavier ; en mode écran d'accueil iOS peut décaler la zone visible
        window.scrollTo(0, y);
        if (vv && vv.offsetTop > 0) { window.scrollTo(0, y + 1); window.scrollTo(0, y); }
      }, 350);
    } else focusY = null;
  }, 120);
});
/* dans une feuille, le champ actif est ramené dans la zone visible (le reste de l'app : iOS s'en charge seul) */
document.addEventListener('focusin', e => {
  const el = e.target, sh = el.closest && el.closest('.sheet');
  if (!sh || !el.matches('input,textarea,select')) return;
  setTimeout(() => {
    const r = el.getBoundingClientRect(), sr = sh.getBoundingClientRect();
    if (r.bottom > sr.bottom - 16) sh.scrollTop += r.bottom - sr.bottom + 24;
    else if (r.top < sr.top + 16) sh.scrollTop -= sr.top - r.top + 24;
  }, 350);
});

/* ============================================================
   Lignes à glisser, façon iOS
   - glisser ← : révèle « Supprimer » (toucher pour confirmer) ; glissement long : supprime
   - glisser → : action secondaire (ex. pointer)
   Pendant le geste, la page ne défile pas ; un geste n'ouvre jamais la ligne par erreur.
   ============================================================ */
J.swipeRows = (container, {left = null, right = null, rightLabel = ''} = {}) => {
  const ACT = 92;
  let s = null, opened = null, blockClick = false;
  const fgOf = row => row.querySelector('.row');
  const close = (row, anim = true) => {
    if (!row) return;
    const f = fgOf(row); f.style.transition = anim ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : ''; f.style.transform = '';
    row.classList.remove('open', 'arm-r', 'arm-full');
    if (opened === row) opened = null;
  };
  /* une ligne ouverte : le premier toucher ailleurs se contente de la refermer (comme iOS) */
  document.addEventListener('touchstart', e => {
    if (opened && !opened.isConnected) opened = null;               // la ligne a disparu (liste redessinée)
    if (opened && !opened.contains(e.target)) { close(opened); blockClick = true; s = null; setTimeout(() => { blockClick = false; }, 450); }
  }, {passive:true, capture:true});
  container.addEventListener('touchstart', e => {
    if (blockClick) { s = null; return; }
    const row = e.target.closest('.srow');
    if (!row || J.fromEdge() || e.target.closest('.sact')) { s = null; return; }
    const t = e.touches[0];
    s = {row, x:t.clientX, y:t.clientY, dx:0, mode:null, base:row === opened ? -ACT : 0, w:row.offsetWidth, armed:false};
  }, {passive:true});
  container.addEventListener('touchmove', e => {
    if (!s) return;
    const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) s.mode = 'h';
      else if (Math.abs(dy) > 8) { s = null; return; }
      else return;
    }
    e.preventDefault();
    let x = s.base + dx;
    if (x > 0 && !right) x = x / 5;
    if (x < 0 && !left) x = x / 5;
    s.dx = x;
    const f = fgOf(s.row); f.style.transition = ''; f.style.transform = `translateX(${x}px)`;
    const armR = !!right && x > 90, full = !!left && x < -s.w * 0.55;
    s.row.classList.toggle('arm-r', armR); s.row.classList.toggle('arm-full', full);
    if ((armR || full) !== s.armed) { s.armed = armR || full; if (s.armed) J.haptic(); }
  }, {passive:false});
  const end = () => {
    if (!s) return;
    const st = s; s = null;
    if (st.mode !== 'h') return;
    blockClick = true; setTimeout(() => { blockClick = false; }, 400);
    const {row, dx, w} = st, f = fgOf(row);
    f.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)';
    if (right && dx > 90) { close(row); right(row); return; }
    if (left && dx < -w * 0.55) { if (opened === row) opened = null; f.style.transform = `translateX(${-w}px)`; row.classList.remove('arm-full'); setTimeout(() => left(row), 200); return; }
    if (left && dx < -45) { f.style.transform = `translateX(${-ACT}px)`; row.classList.add('open'); opened = row; return; }
    close(row);
  };
  container.addEventListener('touchend', end);
  container.addEventListener('touchcancel', end);
  document.addEventListener('click', e => { if (blockClick && !container.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } }, true);
  container.addEventListener('click', e => {
    const b = e.target.closest('.sact');
    if (b) { e.stopPropagation(); e.preventDefault(); const row = b.closest('.srow'); opened = null; J.haptic(); left(row); return; }
    if (blockClick) { e.stopPropagation(); e.preventDefault(); return; }
    if (opened) { e.stopPropagation(); e.preventDefault(); close(opened); }
  }, true);
  return {closeAll(){ if (opened) close(opened, false); }};
};

/* glisser une feuille vers le bas pour la fermer (comme sur iOS) */
let drag = null;
document.addEventListener('touchstart', e => {
  const sh = e.target.closest('.sheet.show');
  if (!sh || sh.scrollTop > 0 || e.target.closest('input,select,textarea,.hscroll')) return;   // pas sur les barres qui défilent horizontalement
  // feuilles « à poignée » (conversation) : on ne les tire que par l'en-tête, comme dans Messages
  if (sh.dataset.drag === 'head' && !e.target.closest('.grab,[data-drag-handle]')) return;
  // zone qui défile à l'intérieur (ex. messages) : on ne tire la feuille que si cette zone est tout en haut
  for (let el = e.target; el && el !== sh; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY)) { if (el.scrollTop > 0) return; break; }
  }
  drag = {sh, x:e.touches[0].clientX, y:e.touches[0].clientY, dy:0, t:Date.now()};
}, {passive:true});
document.addEventListener('touchmove', e => {
  if (!drag) return;
  const dy = e.touches[0].clientY - drag.y, dx = e.touches[0].clientX - drag.x;
  if (!drag.active && (dy < 0 || Math.abs(dx) > Math.abs(dy))) { drag = null; return; }   // défilement vers le haut ou geste horizontal
  drag.dy = Math.max(0, dy);
  if (drag.dy > 6) { drag.active = true; e.preventDefault(); drag.sh.classList.add('dragging'); drag.sh.style.transform = `translateY(${drag.dy}px)`; }
}, {passive:false});
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
  l.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;clip-path:inset(50%)';   // dans l'écran : un élément hors écran laisse iOS (mode app) faire glisser la vue sur le côté
  l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l);
  return l;
})();
J.haptic = () => { if (navigator.vibrate) navigator.vibrate(8); else hapticEl.click(); };
document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
document.addEventListener('gesturestart', e => e.preventDefault());
try { screen.orientation.lock('portrait').catch(() => {}); } catch(e) {}   // Android ; ignoré par iOS (écran « tournez le téléphone » à la place)   // pas de zoom à deux doigts
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
const scrollMem = {};  // position de défilement mémorisée par écran (comme les onglets iOS)
function showView(el){
  $$('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
}
const ICON_MORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
const favTabs = () => {
  const mods = J.modules.filter(m => !m.soon), want = (prefs && prefs.data.tabs) || ['finances', 'nutrition', 'muscu', 'taches'];
  return want.map(id => mods.find(m => m.id === id)).filter(Boolean).slice(0, 4);
};
function renderTabbar(){
  const favs = favTabs(), tab = m => `<button data-go="${m.id}" style="--acc:${m.accent}">${m.icon}<span>${esc(m.short || m.name)}</span></button>`;
  const half = Math.ceil(favs.length / 2);
  // le réacteur au centre : accueil, et sur l'accueil « parler à Jarvis » (appui long : la conversation)
  const core = `<button class="dock-core" data-core aria-label="Jarvis"><span class="dc-r"><svg viewBox="0 0 66 66" aria-hidden="true">
      <g class="spin"><circle cx="33" cy="33" r="29" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="2" stroke-dasharray="14 5 3 5"/></g>
      <g class="spin rev"><circle cx="33" cy="33" r="23" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="2 4"/></g>
      <circle cx="33" cy="33" r="15" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="33" cy="33" r="7" fill="#c8f6ff"/></svg></span><span>JARVIS</span></button>`;
  $('#tabbar').innerHTML = favs.slice(0, half).map(tab).join('') + core + favs.slice(half).map(tab).join('');
  setTabbar(current ? current.id : '');
}
function setTabbar(id){
  const favIds = favTabs().map(m => m.id);
  $$('#tabbar [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === (id || '')));
  const core = $('#tabbar .dock-core'); if (core) core.classList.toggle('on', !id);
}
/* onglet « Plus » : tous les modules */
function openMore(){
  const mods = J.modules.filter(m => !m.soon).sort((a, b) => a.code.localeCompare(b.code));
  $('#moreGrid').innerHTML = mods.map(m => { let sub = ''; try { sub = m.stat ? (m.stat() || {}).label ? '' : '' : ''; } catch(e) {}
    return `<button data-mgo="${m.id}" style="--acc:${m.accent}"><span class="mi">${m.icon}</span><b>${esc(m.name)}</b><small>${esc(m.tagline || '')}</small></button>`; }).join('');
  openSheet($('#moreSheet'));
}
$('#moreGrid').addEventListener('click', e => { const b = e.target.closest('[data-mgo]'); if (!b) return; J.haptic(); closeSheet(); setTimeout(() => J.go(b.dataset.mgo), 120); });

/* Navigation : chaque module garde son écran (état, onglet, défilement) d'une visite à l'autre */
J.go = (id) => {
  closeSheet();
  const mod = id && J.modules.find(m => m.id === id && !m.soon) || null;
  const from = current ? current.id : 'hub';
  scrollMem[from] = window.scrollY;
  if (mod === current && id) { window.scrollTo({top:0, behavior:'smooth'}); return; }   // toucher l'onglet actif = remonter en haut
  current = mod;
  history.replaceState(null, '', '#/' + (mod ? mod.id : ''));
  setTabbar(mod ? mod.id : '');
  $('#navTitle').textContent = mod ? mod.name.toUpperCase() : 'J.A.R.V.I.S.'; $('#navbar').style.setProperty('--acc', mod ? mod.accent : '#3fe0ff');
  if (!mod) {
    showView($('#hub'));
    renderHub();
    J.say(hubMessage());
    window.scrollTo(0, scrollMem.hub || 0);
    if (updatePending) applyUpdate();
    return;
  }
  let view = $('#mv-' + mod.id);
  if (!view) {
    view = document.createElement('section');
    view.className = 'view ' + (mod.cls || '');
    view.id = 'mv-' + mod.id;
    view.style.setProperty('--acc', mod.accent);
    view.innerHTML = `
      <div class="wrap">
        <header class="mhead"><span class="mh-ic" style="--acc:${mod.accent}">${mod.icon || ''}</span><div><h1>${esc(mod.name)}</h1><small>${esc(mod.tagline || '')}</small></div></header>
        <div class="msg"></div>
        <div class="mod-body"></div>
      </div>
      <div class="mod-fixed"></div>`;
    $('#modviews').appendChild(view);
    showView(view);
    try { mod.mount($('.mod-body', view), $('.mod-fixed', view)); } catch(e) { report(mod.id + '.mount : ' + (e.stack || e)); }
    window.scrollTo(0, 0);
  } else {
    showView(view);
    try { if (mod.onShow) mod.onShow(); } catch(e) { report(mod.id + '.onShow : ' + (e.stack || e)); }
    window.scrollTo(0, scrollMem[mod.id] || 0);
  }
};
/* barre de titre façon iOS : apparaît, floutée, quand le grand titre sort de l'écran */
let navRaf = 0;
const onNavScroll = () => { cancelAnimationFrame(navRaf); navRaf = requestAnimationFrame(() => document.body.classList.toggle('scrolled', window.scrollY > 70)); };
window.addEventListener('scroll', onNavScroll, {passive:true});

/* tirer vers le bas pour actualiser (données, Santé, météo), comme dans les apps natives */
let ptr = null, ptrBusy = false;
const ptrEl = $('#ptr'), PTR_GO = 64;
document.addEventListener('touchstart', e => {
  ptr = null;
  if (ptrBusy || !document.body.classList.contains('in-app') || openSheetEl || window.scrollY > 0 || e.touches.length > 1) return;
  const t = e.touches[0];
  if (t.clientX < 28 || e.target.closest('input,textarea,select,.hscroll,.srow,.sheet,#tabbar,.scanner')) return;
  ptr = {x:t.clientX, y:t.clientY, d:0, on:false, armed:false};
}, {passive:true});
document.addEventListener('touchmove', e => {
  if (!ptr) return;
  const t = e.touches[0], dy = t.clientY - ptr.y, dx = t.clientX - ptr.x;
  if (!ptr.on) {
    if (dy < -4 || Math.abs(dx) > Math.abs(dy) + 4 || window.scrollY > 0) { ptr = null; return; }
    if (dy < 8) return;
    ptr.on = true; ptrEl.classList.add('pull');
  }
  ptr.d = Math.max(0, Math.min(110, (dy - 8) * .5));
  ptrEl.style.transform = `translateY(${ptr.d}px) rotate(${ptr.d * 4}deg)`;
  ptrEl.style.opacity = Math.min(1, ptr.d / 40);
  if (ptr.d >= PTR_GO !== ptr.armed) { ptr.armed = ptr.d >= PTR_GO; if (ptr.armed) J.haptic('select'); }
}, {passive:true});
document.addEventListener('touchend', () => {
  const p = ptr; ptr = null;
  if (!p || !p.on) return;
  if (p.armed) refreshAll(); else ptrReset();
}, {passive:true});
function ptrReset(){ ptrEl.classList.remove('pull', 'spin'); ptrEl.style.transform = ''; ptrEl.style.opacity = ''; }
async function refreshAll(){
  ptrBusy = true; J.haptic('medium');
  ptrEl.classList.add('spin'); ptrEl.style.transform = `translateY(${PTR_GO}px)`; ptrEl.style.opacity = 1;
  await Promise.allSettled([J.sync(), J.syncHealth ? J.syncHealth(false) : null, J.refreshWeather && ((J.prefs() || {}).city || ls.get('jarvis.geo')) ? J.refreshWeather() : null, new Promise(r => setTimeout(r, 700))]);
  try { if (current) { if (current.onShow) current.onShow(); } else { renderHub(); if (J.renderBriefing) J.renderBriefing(); } } catch(e) {}
  J.haptic('success'); ptrReset(); ptrBusy = false;
}

function resetViews(){
  J.modules.forEach(m => { if (m.unmount && $('#mv-' + m.id)) { try { m.unmount(); } catch(e) {} } });
  $('#modviews').innerHTML = '';
  current = null;
}
$('#tabbar').addEventListener('click', e => {
  if (e.target.closest('[data-core]')) {
    if (coreLong) { coreLong = false; return; }
    J.haptic('medium');
    if (current) J.go(null); else { const r = $('#hubReactor'); if (r) r.click(); }   // déjà sur l'accueil : on parle à Jarvis
    return;
  }
  const b = e.target.closest('[data-go]'); if (!b) return; J.haptic(); if (b.dataset.go === '@more') return openMore(); J.go(b.dataset.go || null);
});
/* appui long sur le réacteur : la conversation, depuis n'importe quel écran */
let coreT = 0, coreLong = false;
$('#tabbar').addEventListener('pointerdown', e => { if (!e.target.closest('[data-core]')) return; coreLong = false; clearTimeout(coreT); coreT = setTimeout(() => { coreLong = true; J.haptic('heavy'); if (J.openChat) J.openChat(); }, 480); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('#tabbar').addEventListener(ev, () => clearTimeout(coreT)));
$('#tabbar').addEventListener('contextmenu', e => e.preventDefault());

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
/* message du hub : court, il ne répète pas les tuiles — seulement ce qui mérite l'attention */
function hubMessage(){
  const briefs = J.modules.filter(m => !m.soon && m.brief).map(m => { try { return m.brief(); } catch(e) { return ''; } }).filter(Boolean);
  const urgent = briefs.find(b => /attention|alerte|découvert|dépassé|en cours/i.test(b));
  const h = new Date().getHours();
  return J.greeting() + ' ' + (urgent || (h < 11 ? 'Voici votre journée.' : h < 18 ? 'Tout est sous contrôle.' : 'Voici le point de la journée.'));
}
function renderHub(){
  try { renderHubInner(); } catch(e) { report('renderHub : ' + (e.stack || e)); }
}
function renderHubInner(){
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
  if (J.onHubShow) J.onHubShow();
}
$('#tiles').addEventListener('click', e => {
  const b = e.target.closest('[data-mod]'); if (!b) return;
  const m = J.modules.find(x => x.id === b.dataset.mod);
  J.haptic();
  if (m.soon) { J.say(`Le module ${m.name} est en cours de développement, ${prefs.data.name}. ${m.tagline ? m.tagline + '.' : ''}`); return; }
  J.go(m.id);
});
/* toucher le réacteur = parler à Jarvis, appui long = briefing (voir core/chat.js) */
setInterval(() => { if (!current && document.visibilityState === 'visible' && session && !$('#hubReactor').classList.contains('listening')) { const d = new Date(); $('#hubTime').textContent = d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}); J.setArc($('#hubReactor'), d.getSeconds() / 60, '#3fe0ff'); } }, 1000);

/* ============================================================
   Réglages
   ============================================================ */
const S$ = s => $(s, $('#settings'));
$('#openSettings').addEventListener('click', openSettings);
function openSettings(){
  S$('#sName').value = prefs.data.name;
  S$('#sVoice').checked = prefs.data.voice;
  $$('#sVoiceMode button').forEach(b => b.classList.toggle('on', b.dataset.v === (prefs.data.voiceMode || 'jarvis')));
  $$('#sVoiceName button').forEach(b => b.classList.toggle('on', b.dataset.v === (prefs.data.voiceName || 'franck')));
  S$('#sVoiceNameField').hidden = prefs.data.voiceMode === 'iphone';
  S$('#sCity').value = prefs.data.city || '';
  if (J.renderNotifSettings) J.renderNotifSettings();
  if (J.renderMemory) J.renderMemory();
  renderTabPrefs();
  S$('#sUsage').textContent = '';
  J.api('GET', '/api/tts/usage').then(u => {
    if (u.premium) S$('#sUsage').textContent = `Voix premium : ${Math.min(100, Math.round(u.chars / u.budget * 100))} % du quota du mois utilisé (partagé par tous les comptes). Au-delà, voix de secours jusqu'au mois suivant.`;
  }).catch(() => {});
  S$('#sAccount').textContent = session.user.username + (session.user.isAdmin ? ' · administrateur' : '');
  S$('#adminBox').hidden = !session.user.isAdmin;
  S$('#inviteOut').hidden = true;
  if (session.user.isAdmin) loadAdmin();
  openSheet($('#settings'));
}
S$('#sName').addEventListener('change', e => { prefs.data.name = e.target.value.trim() || 'Monsieur'; prefs.save(); J.say(J.greeting() + ' Bien noté.'); });
S$('#sVoice').addEventListener('change', e => { prefs.data.voice = e.target.checked; prefs.save(); });
S$('#sVoiceMode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  prefs.data.voiceMode = b.dataset.v; prefs.save();
  $$('#sVoiceMode button').forEach(x => x.classList.toggle('on', x === b));
  S$('#sVoiceNameField').hidden = b.dataset.v === 'iphone';
  J.speak(b.dataset.v === 'jarvis' ? `À votre service, ${prefs.data.name}.` : `Voix de l'iPhone activée, ${prefs.data.name}.`);
});
S$('#sVoiceName').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  prefs.data.voiceName = b.dataset.v; prefs.save();
  $$('#sVoiceName button').forEach(x => x.classList.toggle('on', x === b));
  J.speak(`Bonjour ${prefs.data.name}. Tous les systèmes sont opérationnels. Je suis à votre service.`);
});
S$('#sCity').addEventListener('change', e => { prefs.data.city = e.target.value.trim(); prefs.save(); ls.del('jarvis.weather'); J.refreshWeather && J.refreshWeather(); });
S$('#openGuide').addEventListener('click', () => J.openGuide());
function renderTabPrefs(){
  const sel = favTabs().map(m => m.id);
  S$('#sTabs').innerHTML = J.modules.filter(m => !m.soon).map(m => `<button data-tab="${m.id}" class="${sel.includes(m.id) ? 'on' : ''}" style="--acc:${m.accent}">${esc(m.short || m.name)}</button>`).join('');
}
S$('#sTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  let sel = favTabs().map(m => m.id); const id = b.dataset.tab;
  if (sel.includes(id)) sel = sel.filter(x => x !== id);
  else { if (sel.length >= 4) { J.toast('4 onglets maximum : retirez-en un d\'abord'); return; } sel.push(id); }
  prefs.data.tabs = sel; prefs.save(); renderTabPrefs(); renderTabbar(); J.haptic();
});
S$('#closeSettings').addEventListener('click', closeSheet);

/* ---------- guide : raccourci iPhone (Santé, Calendrier, Rappels) ---------- */
const G$ = s => $(s, $('#guide'));
J.openGuide = () => { const was = !!openSheetEl; closeSheet(); setTimeout(() => openSheet($('#guide')), was ? 320 : 0); };
G$('#gGen').addEventListener('click', async () => {
  try {
    const {url} = await J.api('POST', '/api/ingest-token');
    G$('#gUrl').textContent = url; G$('#gUrlBox').hidden = false;
    G$('#gGen').textContent = 'RÉGÉNÉRER (INVALIDE L\'ANCIEN LIEN)';
  } catch(e) { J.toast(e.message); }
});
G$('#gCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(G$('#gUrl').textContent); J.toast('Lien copié'); J.haptic(); } catch(e) { J.toast('Copie impossible'); }
});
G$('#gCheck').addEventListener('click', async () => {
  const out = G$('#gCheckOut'); out.hidden = false; out.innerHTML = '<p class="note">Vérification…</p>';
  await J.sync();
  const doc = J.store('apple', {days:{}}).data, t = (doc.days || {})[J.todayKey()];
  if (!doc.syncedAt) { out.innerHTML = '<p class="ko">✗ Rien reçu pour l\'instant. Vérifiez l\'URL et la méthode POST de l\'étape C, puis relancez le raccourci.</p>'; return; }
  const fresh = Date.now() - doc.syncedAt < 10 * 60e3;
  const row = (ok, label, val) => `<div class="gc ${ok ? 'ok' : 'ko'}"><span>${ok ? '✓' : '✗'}</span><span>${label}</span><b>${val}</b></div>`;
  out.innerHTML = `<p class="note">${fresh ? '✓ Données reçues ' : '⚠ Dernière réception '}${J.ago(doc.syncedAt)}.</p>` +
    row(t && t.steps != null, 'steps', t && t.steps != null ? Math.round(t.steps).toLocaleString('fr-FR') + ' pas' : 'manquant') +
    row(t && t.energy != null, 'energy', t && t.energy != null ? Math.round(t.energy) + ' kcal' : 'manquant') +
    (t && t.weight ? row(true, 'weight', String(t.weight).replace('.', ',') + ' kg') : '') +
    (() => { const y = new Date(); y.setDate(y.getDate() - 1); const yk = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0'); const b = ((doc.days || {})[yk] || {}).basal; return b ? row(true, 'basal', b + ' kcal (hier)') : ''; })() +
    '<p class="note">Une ligne ✗ ? Vérifiez l\'orthographe de la clé (minuscules) et que la valeur est bien une variable (bulle bleue). Une valeur à 0 est normale s\'il n\'y a rien aujourd\'hui.</p>';
});
G$('#gClose').addEventListener('click', closeSheet);
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
  document.body.classList.remove('in-app');
  showView($('#auth'));
  A$('#lUser').value = ls.get('jarvis.lastUser') || '';
  A$('#lCode').value = '';
  authStep('login');
  J.say('Identification requise.');
  try {
    const {needsSetup} = await J.api('GET', '/api/status');
    if (needsSetup) { authStep('register'); A$('#rInviteField').hidden = true; A$('#regForm [data-tologin]').hidden = true; A$('#regTitle').textContent = 'INITIALISATION'; J.say('Premier démarrage. Créez le compte administrateur.'); }
  } catch(e) { J.say('Serveur injoignable. Vérifiez votre connexion.'); }
  loadUserSuggestions();
}
/* identifiants proposés : ceux déjà utilisés sur cet appareil d'abord, puis les autres comptes */
async function loadUserSuggestions(){
  const known = ls.get('jarvis.knownUsers') || [];
  let all = [];
  try { all = (await J.api('GET', '/api/login/users')).users || []; } catch(e) {}
  const list = [...known.filter(u => all.includes(u) || !all.length), ...all.filter(u => !known.includes(u))];
  const cur = () => A$('#lUser').value.trim().toLowerCase();
  A$('#lUsers').innerHTML = list.map(u => `<button type="button" data-u="${esc(u)}" class="${u.toLowerCase() === cur() ? 'on' : ''}">${esc(u)}</button>`).join('');
}
A$('#lUsers').addEventListener('click', e => {
  const b = e.target.closest('[data-u]'); if (!b) return;
  J.haptic(); A$('#lUser').value = b.dataset.u;
  $$('#lUsers button').forEach(x => x.classList.toggle('on', x === b));
  A$('#lCode').focus();   // pendant le toucher : le clavier numérique s'ouvre pour le code
});
A$('#lUser').addEventListener('input', () => { const v = A$('#lUser').value.trim().toLowerCase(); $$('#lUsers button').forEach(x => x.classList.toggle('on', x.dataset.u.toLowerCase() === v)); });
function busy(btn, on){ btn.disabled = on; btn.style.opacity = on ? .5 : 1; }

A$('#toRegister').addEventListener('click', () => { authStep('register'); A$('#rInviteField').hidden = false; A$('#regForm [data-tologin]').hidden = false; A$('#regTitle').textContent = 'NOUVEL UTILISATEUR'; A$('#rInvite').focus(); });
$$('#auth [data-tologin]').forEach(b => b.addEventListener('click', () => authStep('login')));

A$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = A$('#loginForm button[type=submit]'); busy(btn, true);
  try {
    const r = await J.api('POST', '/api/login', {username:A$('#lUser').value.trim(), code:A$('#lCode').value.replace(/\s/g, '')});
    setSession(r);
    const known = (ls.get('jarvis.knownUsers') || []).filter(u => u !== r.user.username); ls.set('jarvis.knownUsers', [r.user.username, ...known].slice(0, 8));
    await enter();
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
  prefs = J.store('core', {name:'Monsieur', voice:true, voiceMode:'jarvis', voiceName:'franck'});
  J.modules.forEach(m => { if (!m.soon && m.init) { try { m.init(); } catch(e) { report(m.id + '.init : ' + (e.stack || e)); } } });
  renderTabbar();
  document.body.classList.add('in-app');
  J.go(null);
  if (isNew) J.say(`Bienvenue ${session.user.username}. Compte activé${session.user.isAdmin ? ' avec les droits administrateur' : ''}. Où souhaitez-vous aller ?`);
  await J.sync();
  if (!current) { renderHub(); if (!isNew) J.say(hubMessage()); }
  if (J.scheduleNotifs) J.scheduleNotifs();
}

J.start = () => {
  const steps = ['INITIALISATION…', 'CHARGEMENT DES MODULES…', 'SYSTÈMES EN LIGNE'];
  steps.forEach((s, i) => setTimeout(() => $('#bootTxt').textContent = s, i * 380));
  // journal d'allumage, ligne par ligne
  const log = [['NOYAU', 'OK'], [`MODULES · ${J.modules.filter(m => !m.soon).length}`, 'OK'], ['LIAISON SERVEUR', session ? 'OK' : '—'], [J.native ? 'CAPTEURS SANTÉ' : 'INTERFACE WEB', 'OK'], ['SYNTHÈSE VOCALE', 'OK']];
  log.forEach(([t, v], i) => setTimeout(() => { const el = $('#bootLog'); if (el) el.insertAdjacentHTML('beforeend', `<div>${t}<b>${v}</b></div>`); }, 120 + i * 190));
  setTimeout(() => {
    $('#boot').classList.add('done');
    if (session) {
      const startRoute = (location.hash.match(/^#\/([a-z]+)/) || [])[1];
      enter().then(() => { if (startRoute && J.modules.some(m => m.id === startRoute && !m.soon)) J.go(startRoute); });
      // test local uniquement : scénario automatique (jamais actif sur le site publié)
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') { const ds = sessionStorage.getItem('jarvis.dev'); if (ds) setTimeout(() => { try { new Function(ds)(); } catch(e) { console.error(e); } }, 2500); }
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
let updatePending = false, hiddenAt = 0;
/* une nouvelle version ne recharge l'app qu'à un moment neutre : sur l'accueil, sans feuille ouverte */
function applyUpdate(){
  updatePending = true;
  if (openSheetEl || current || document.querySelector('input:focus,textarea:focus')) return;
  const last = +sessionStorage.getItem('jarvis.reloadAt') || 0;
  if (Date.now() - last < 30000) return;               // évite une boucle si GitHub sert encore l'ancienne version
  sessionStorage.setItem('jarvis.reloadAt', Date.now());
  location.reload();
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => { swReg = r; }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
  // après une longue absence, on revient sur l'accueil (comme une app qui a été fermée)
  if (session && current && hiddenAt && Date.now() - hiddenAt > 30 * 60e3 && !openSheetEl) J.go(null);
  checkUpdate();
  if (session) J.sync().then(() => { if (!current) renderHub(); });
});
window.addEventListener('pageshow', e => { if (e.persisted) checkUpdate(); });
window.addEventListener('online', () => { if (session) J.sync(); });
veil.addEventListener('transitionend', () => { if (updatePending && !openSheetEl && !current) applyUpdate(); });
try {
  const prev = localStorage.getItem('jarvis.version');
  if (prev && prev !== APP_VERSION) setTimeout(() => J.toast('Jarvis mis à jour'), 1600);
  localStorage.setItem('jarvis.version', APP_VERSION);
} catch(e) {}
})();
