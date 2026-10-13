/* ============================================================
   J.A.R.V.I.S. — socle de l'application
   - comptes (authenticator) et synchronisation avec le serveur
   - hub d'accueil + navigation entre modules
   - services partagés : voix, messages, feuilles, notifications

   Ajouter un module : voir modules/README.md
   ============================================================ */
'use strict';
(() => {
const APP_VERSION = '21';
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
/* pendant qu'une feuille est ouverte, la page derrière est figée : pas de défilement parasite,
   et iOS ne fait plus « sauter » l'écran à l'ouverture du clavier */
let lockY = 0;
function lockScroll(){
  if (document.body.classList.contains('locked')) return;
  lockY = window.scrollY;
  document.body.style.top = -lockY + 'px';
  document.body.classList.add('locked');
}
function unlockScroll(){
  if (!document.body.classList.contains('locked')) return;
  document.body.classList.remove('locked');
  document.body.style.top = '';
  window.scrollTo(0, lockY);
}
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
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const root = document.documentElement.style;
    root.setProperty('--kb', kb + 'px');
    root.setProperty('--vvh', Math.round(vv.height) + 'px');
    const was = document.body.classList.contains('kb-open');
    document.body.classList.toggle('kb-open', kb > 80);
    if (was && kb <= 80 && !document.body.classList.contains('locked')) window.scrollTo(window.scrollX, window.scrollY);
  });
}
if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', onViewport); onViewport(); }

/* saisie de texte : la barre d'onglets et le bouton + s'effacent (sinon iOS les fait flotter au-dessus du clavier),
   et à la fermeture du clavier on remet l'écran d'aplomb (iOS laisse parfois la vue décalée) */
const isTextField = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),textarea,select');
let typingT = 0;
document.addEventListener('focusin', e => { if (isTextField(e.target)) { clearTimeout(typingT); document.body.classList.add('typing'); } });
document.addEventListener('focusout', () => {
  clearTimeout(typingT);
  typingT = setTimeout(() => {
    if (isTextField(document.activeElement)) return;
    document.body.classList.remove('typing');
    if (!document.body.classList.contains('locked')) window.scrollTo(window.scrollX, window.scrollY);
  }, 150);
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
  if (!sh || sh.scrollTop > 0 || e.target.closest('input,select,textarea')) return;
  drag = {sh, y:e.touches[0].clientY, dy:0, t:Date.now()};
}, {passive:true});
document.addEventListener('touchmove', e => {
  if (!drag) return;
  const dy = e.touches[0].clientY - drag.y;
  if (dy < 0 && !drag.active) { drag = null; return; }      // l'utilisateur fait défiler le contenu vers le haut
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
  l.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none';
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
function setTabbar(id){
  $$('#tabbar [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === (id || '')));
}
function renderTabbar(){
  const mods = J.modules.filter(m => !m.soon).sort((a, b) => a.code.localeCompare(b.code));
  $('#tabbar').innerHTML = `<button data-go="" style="--acc:#3fe0ff"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/></svg><span>Accueil</span></button>` +
    mods.map(m => `<button data-go="${m.id}" style="--acc:${m.accent}">${m.icon}<span>${esc(m.short || m.name)}</span></button>`).join('');
  setTabbar(current ? current.id : '');
}
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
function resetViews(){
  J.modules.forEach(m => { if (m.unmount && $('#mv-' + m.id)) { try { m.unmount(); } catch(e) {} } });
  $('#modviews').innerHTML = '';
  current = null;
}
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (!b) return; J.haptic(); J.go(b.dataset.go || null); });

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
$('#hubReactor').addEventListener('click', () => {
  const txt = J.briefingSpeech();
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
  $$('#sVoiceMode button').forEach(b => b.classList.toggle('on', b.dataset.v === (prefs.data.voiceMode || 'jarvis')));
  $$('#sVoiceName button').forEach(b => b.classList.toggle('on', b.dataset.v === (prefs.data.voiceName || 'george')));
  S$('#sVoiceNameField').hidden = prefs.data.voiceMode === 'iphone';
  S$('#sCity').value = prefs.data.city || '';
  S$('#sUsage').textContent = '';
  J.api('GET', '/api/tts/usage').then(u => {
    if (u.premium) S$('#sUsage').textContent = `Voix premium : ${u.chars.toLocaleString('fr-FR')} / ${u.budget.toLocaleString('fr-FR')} caractères ce mois-ci (partagés par tous les comptes). Au-delà, voix de secours jusqu'au mois suivant.`;
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
  J.speak(`Bonjour ${prefs.data.name}. Je suis Jarvis, à votre service.`);
});
S$('#sCity').addEventListener('change', e => { prefs.data.city = e.target.value.trim(); prefs.save(); ls.del('jarvis.weather'); J.refreshWeather && J.refreshWeather(); });
S$('#openGuide').addEventListener('click', () => J.openGuide());
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
  prefs = J.store('core', {name:'Monsieur', voice:true, voiceMode:'jarvis', voiceName:'george'});
  J.modules.forEach(m => { if (!m.soon && m.init) { try { m.init(); } catch(e) { report(m.id + '.init : ' + (e.stack || e)); } } });
  renderTabbar();
  document.body.classList.add('in-app');
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
