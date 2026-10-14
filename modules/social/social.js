/* ============================================================
   Module — Défis entre amis
   Chacun choisit ce qu'il partage (séances de muscu, pas). Le téléphone calcule
   un résumé (jours, dernières séances) et l'envoie ; jamais les données brutes.
   - FIL : les séances des amis, avec réactions 🔥
   - CLASSEMENT : séances, tonnage et pas de la semaine
   - DÉFIS : objectifs communs avec date de fin (« 4 séances cette semaine »)
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc} = J;
let st = null, root = null, fixed = null, tab = 'fil', data = null, loadT = 0, pushT = 0, lastSig = '';
const S = () => st.data;
const DEFAULTS = {share:null};
const fmt = v => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
const fmt0 = v => Math.round(v).toLocaleString('fr-FR');
const dk = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); return dk(new Date(y, m - 1, d + n)); };
const today = () => dk(new Date());
const weekStartK = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dk(d); };
const me = () => ((J.user() || {}).username || '');
const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : 0; };
const agoT = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `il y a ${Math.max(1, m)} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : m < 2880 ? 'hier' : `il y a ${Math.round(m / 1440)} jours`; };
const dayLabel = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('fr-FR', {day:'numeric', month:'short'}); };
const COLORS = ['#3fe0ff', '#ffb347', '#b98cff', '#4dffc3', '#ff7eb6', '#ffe066'];
const colorOf = name => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const avatar = name => `<span class="sav" style="--c:${colorOf(name)}">${esc(name.slice(0, 1).toUpperCase())}</span>`;
const METRICS = {
  sessions: {n:'Séances', unit:v => `${fmt0(v)} séance${v >= 2 ? 's' : ''}`, of:x => x.s || 0, share:'muscu'},
  volume:   {n:'Tonnage', unit:v => `${fmt(v)} t`, of:x => (x.v || 0) / 1000, share:'muscu'},
  steps:    {n:'Pas', unit:v => `${fmt0(v)} pas`, of:x => x.st || 0, share:'steps'},
};

/* ---------- résumé partagé (calculé ici) ---------- */
function summary(){
  const sh = S().share || {}, out = {days:{}};
  const k0 = addDays(today(), -34);
  if (sh.muscu) {
    const mu = J.store('muscu', {sessions:[], weekGoal:3}).data;
    const done = ex => ex.sets.filter(s => s.done !== false && num(s.reps) > 0);
    const vol = s => s.ex.reduce((a, e) => a + done(e).reduce((b, x) => b + num(x.kg) * num(x.reps), 0), 0);
    (mu.sessions || []).forEach(s => { const k = dk(new Date(s.start)); if (k < k0) return; const d = out.days[k] = out.days[k] || {}; d.s = (d.s || 0) + 1; d.v = Math.round((d.v || 0) + vol(s)); });
    out.sessions = [...(mu.sessions || [])].sort((a, b) => b.start - a.start).slice(0, 8).map(s => ({
      id:String(s.id).slice(0, 30), name:String(s.name).slice(0, 40), start:s.start, dur:Math.max(1, Math.round(((s.end || s.start) - s.start) / 60000)), vol:Math.round(vol(s)), prs:s.prs || 0,
      ex:s.ex.slice(0, 8).map(e => { const top = done(e).reduce((a, x) => (num(x.kg) * (1 + num(x.reps) / 30)) > (num(a.kg) * (1 + num(a.reps) / 30)) ? x : a, done(e)[0] || {}); return {n:String(e.name).slice(0, 40), t:top.reps ? `${fmt(num(top.kg))}×${num(top.reps)}` : ''}; }),
    }));
    out.weekGoal = mu.weekGoal || 3;
  }
  if (sh.steps) {
    const days = (J.appleDoc && J.appleDoc().days) || {};
    Object.entries(days).forEach(([k, v]) => { if (k >= k0 && v && v.steps) { const d = out.days[k] = out.days[k] || {}; d.st = Math.round(v.steps); } });
  }
  return out;
}
async function push(){
  if (!S().share || !J.user()) return;
  const body = {share:S().share, summary:summary()}, sig = JSON.stringify(body);
  if (sig === lastSig) return;
  try { await J.api('PUT', '/api/social/me', body); lastSig = sig; } catch(e) {}
}
const schedulePush = () => { clearTimeout(pushT); pushT = setTimeout(push, 4000); };

async function load(){
  if (!J.user()) return;
  try { data = await J.api('GET', '/api/social'); } catch(e) { if (!data) data = {friends:[], kudos:[], challenges:[], error:e.message}; }
  if (root) { render(); J.say(message()); }
}

/* ---------- calculs ---------- */
const shared = (f, metric) => f.share && f.share[METRICS[metric].share];
const total = (f, metric, from, to) => Object.entries((f.summary || {}).days || {}).reduce((a, [k, d]) => k >= from && k <= to ? a + METRICS[metric].of(d) : a, 0);
function board(metric, from = weekStartK(), to = today()){
  return (data ? data.friends : []).filter(f => shared(f, metric)).map(f => ({u:f.username, v:total(f, metric, from, to), goal:(f.summary || {}).weekGoal}))
    .sort((a, b) => b.v - a.v);
}
const friendOf = u => (data ? data.friends : []).find(f => f.username === u);
const kudosFor = (u, item) => (data ? data.kudos : []).filter(k => k.target === u && k.item === item).map(k => k.from);

/* ---------- rendu ---------- */
const TEMPLATE = `
  <div id="soConsent"></div>
  <div class="utabs" id="soTabs"><button data-tab="fil">FIL</button><button data-tab="rank">CLASSEMENT</button><button data-tab="defis">DÉFIS</button></div>
  <div id="soTab"></div>
  <button class="lnk soshare" data-a="share" id="soShareL"></button>`;

function render(){
  if (!root) return;
  $$('#soTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const sh = S().share;
  $('#soConsent', root).innerHTML = sh ? '' : `
    <div class="soconsent">
      <b>Partagez avec vos amis Jarvis</b>
      <span>Vos amis verront ce que vous choisissez : vos séances (nom, exercices, tonnage) et vos pas. Rien d'autre, ni finances, ni repas, ni notes.</span>
      <label class="sochk"><input type="checkbox" id="soCM" checked> Mes séances de musculation</label>
      <label class="sochk"><input type="checkbox" id="soCS" checked> Mes pas (Apple Santé)</label>
      <div class="two"><button class="btn ghost" data-a="noshare">PAS MAINTENANT</button><button class="btn primary" data-a="doshare">PARTAGER</button></div>
    </div>`;
  $('#soShareL', root).textContent = sh ? `Partage : ${[sh.muscu && 'séances', sh.steps && 'pas'].filter(Boolean).join(' et ') || 'rien'} · modifier` : '';
  const box = $('#soTab', root);
  if (!data) { box.innerHTML = '<div class="empty" style="margin-top:30px">Connexion avec vos amis…</div>'; return; }
  if (data.error && !data.friends.length) { box.innerHTML = `<div class="empty" style="margin-top:30px">Impossible de charger : ${esc(data.error)}</div>`; return; }
  box.innerHTML = tab === 'fil' ? renderFeed() : tab === 'rank' ? renderRank() : renderChallenges();
}

function renderFeed(){
  const items = [];
  data.friends.forEach(f => ((f.summary || {}).sessions || []).forEach(s => items.push({u:f.username, s})));
  items.sort((a, b) => b.s.start - a.s.start);
  if (!items.length) return `<div class="empty" style="margin-top:30px">Aucune séance partagée pour l'instant.<br><small>Les séances de chacun apparaîtront ici dès qu'elles sont terminées.</small></div>`;
  return items.slice(0, 30).map(({u, s}) => {
    const k = kudosFor(u, s.id), mine = k.includes(me()), self = u === me();
    return `<div class="sopost">
      <div class="sp-h">${avatar(u)}<div><b>${self ? 'Vous' : esc(u)}</b> · ${esc(s.name)}<small>${agoT(s.start)}</small></div></div>
      <div class="sp-st"><span>⏱ ${s.dur} min</span><span>${fmt(s.vol / 1000)} t</span><span>${s.ex.length} exercice${s.ex.length > 1 ? 's' : ''}</span>${s.prs ? `<span class="pr">🏆 ${s.prs} record${s.prs > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="sp-ex">${s.ex.map(e => `<span>${esc(e.n)}${e.t ? ` <b>${esc(e.t)}</b>` : ''}</span>`).join('')}</div>
      ${self && !k.length ? '' : `<button class="sofire ${mine ? 'on' : ''}" data-a="kudos" data-u="${esc(u)}" data-i="${esc(s.id)}" ${self ? 'disabled' : ''}>🔥 ${k.length || ''}<small>${k.length ? esc(k.map(x => x === me() ? 'vous' : x).join(', ')) : 'Bravo !'}</small></button>`}
    </div>`;
  }).join('');
}

function renderRank(){
  const from = weekStartK(), section = (metric, extra) => {
    const b = board(metric, from), max = Math.max(1, ...b.map(x => x.v));
    if (!b.length) return '';
    return `<section class="panel"><div class="ph"><span>${METRICS[metric].n.toUpperCase()}</span><span>cette semaine</span></div>
      ${b.map((x, i) => `<div class="sorow ${x.u === me() ? 'me' : ''}"><span class="sr-r">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatar(x.u)}<span class="sr-n">${x.u === me() ? 'Vous' : esc(x.u)}</span>
        <span class="sr-b"><i style="width:${x.v / max * 100}%;background:${colorOf(x.u)}"></i></span><b>${METRICS[metric].unit(x.v)}${extra && x.goal ? `<small> / ${x.goal}</small>` : ''}</b></div>`).join('')}
    </section>`;
  };
  const html = section('sessions', true) + section('volume') + section('steps');
  return html ? `<p class="note somuted">Du lundi ${dayLabel(from)} à aujourd'hui. Seuls ceux qui partagent apparaissent.</p>` + html
    : '<div class="empty" style="margin-top:30px">Personne ne partage encore. Activez le partage pour lancer le classement.</div>';
}

function chProgress(c){
  const to = c.end < today() ? c.end : today();
  return c.members.map(u => { const f = friendOf(u); return {u, v:f && shared(f, c.metric) ? total(f, c.metric, c.start, to) : null}; }).sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
}
function renderChallenges(){
  const list = data.challenges || [];
  const active = list.filter(c => c.end >= today()), ended = list.filter(c => c.end < today());
  const card = c => {
    const pr = chProgress(c), joined = c.members.includes(me()), over = c.end < today();
    const left = Math.round((Date.parse(c.end) - Date.parse(today())) / 864e5);
    const winners = pr.filter(x => x.v !== null && x.v >= c.target).map(x => x.u === me() ? 'vous' : x.u);
    return `<div class="sochal ${over ? 'over' : ''}" data-c="${c.id}">
      <div class="sc-h"><div><b>${esc(c.title)}</b><small>${METRICS[c.metric].n} · objectif ${METRICS[c.metric].unit(c.target)} · ${over ? 'terminé le ' + dayLabel(c.end) : c.start > today() ? 'commence le ' + dayLabel(c.start) : left === 0 ? 'dernier jour' : `encore ${left} jour${left > 1 ? 's' : ''}`}</small></div>
        ${c.creator === me() ? '<button class="rmore" data-a="chmenu" aria-label="Options">⋯</button>' : ''}</div>
      ${pr.map(x => `<div class="sc-m">${avatar(x.u)}<span class="sc-n">${x.u === me() ? 'Vous' : esc(x.u)}</span>
        <span class="sr-b"><i style="width:${x.v === null ? 0 : Math.min(100, x.v / c.target * 100)}%;background:${x.v !== null && x.v >= c.target ? '#4dffc3' : colorOf(x.u)}"></i></span>
        <b>${x.v === null ? '<small>ne partage pas</small>' : x.v >= c.target ? '✓' : METRICS[c.metric].unit(x.v)}</b></div>`).join('')}
      ${over ? `<p class="sc-w">${winners.length ? '🏆 Réussi par ' + esc(winners.join(', ')) : 'Personne n\'a atteint l\'objectif'}</p>`
        : `<button class="btn ${joined ? 'ghost' : 'primary'} sm" data-a="${joined ? 'leave' : 'join'}">${joined ? 'QUITTER' : 'REJOINDRE'}</button>`}
    </div>`;
  };
  return `<div class="sotpl">${[['sessions', 4, 'week', '4 séances cette semaine'], ['steps', 70000, '7', '70 000 pas en 7 jours'], ['volume', 20, 'month', '20 tonnes ce mois-ci']]
      .map(([m, t, p, l]) => `<button data-a="tpl" data-m="${m}" data-t="${t}" data-p="${p}" data-l="${l}">+ ${l}</button>`).join('')}</div>
    ${active.length ? active.map(card).join('') : '<p class="note somuted">Aucun défi en cours. Lancez-en un : vos amis pourront le rejoindre.</p>'}
    ${ended.length ? `<div class="slabel"><span>TERMINÉS</span></div>${ended.map(card).join('')}` : ''}`;
}

/* ---------- périodes des défis ---------- */
function period(p){
  const t = today();
  if (p === 'week') return [weekStartK(), addDays(weekStartK(), 6)];   // du lundi au dimanche : ce qui est déjà fait cette semaine compte
  if (p === 'month') { const d = new Date(); return [dk(new Date(d.getFullYear(), d.getMonth(), 1)), dk(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; }
  return [t, addDays(t, (+p || 7) - 1)];
}

const FIXED = `
  <button class="fab" id="soAdd" aria-label="Nouveau défi">+</button>
  <div class="sheet so" id="soNew" role="dialog" aria-label="Nouveau défi">
    <div class="grab"></div>
    <h2>NOUVEAU DÉFI</h2>
    <div class="field"><label>NOM</label><input id="soT" maxlength="50" autocomplete="off" placeholder="Ex : 4 séances cette semaine"></div>
    <div class="field"><label>MESURE</label><div class="seg" id="soM"><button data-m="sessions" class="on">SÉANCES</button><button data-m="volume">TONNAGE</button><button data-m="steps">PAS</button></div></div>
    <div class="field"><label id="soVL">OBJECTIF (SÉANCES)</label><input id="soV" inputmode="decimal" autocomplete="off" placeholder="4"></div>
    <div class="field"><label>DURÉE</label><div class="seg" id="soP"><button data-p="week" class="on">CETTE SEMAINE</button><button data-p="7">7 JOURS</button><button data-p="30">30 JOURS</button><button data-p="month">CE MOIS</button></div></div>
    <button class="btn primary" id="soCreate">LANCER LE DÉFI</button>
  </div>
  <div class="sheet so" id="soShare" role="dialog" aria-label="Partage">
    <div class="grab"></div>
    <h2>CE QUE JE PARTAGE</h2>
    <p class="note">Visible par les autres comptes Jarvis (vos amis invités). Jamais vos finances, repas ou notes.</p>
    <div class="toggle"><span>Séances de musculation<small>Nom, exercices, meilleure série, tonnage</small></span><label class="sw"><input type="checkbox" id="soSM"><i></i></label></div>
    <div class="toggle"><span>Pas<small>Total par jour (Apple Santé)</small></span><label class="sw"><input type="checkbox" id="soSS"><i></i></label></div>
    <button class="btn primary" id="soShareSave">ENREGISTRER</button>
  </div>
  <div class="sheet so" id="soMenu" role="dialog" aria-label="Options du défi">
    <div class="grab"></div>
    <h2>OPTIONS DU DÉFI</h2>
    <button class="btn danger" id="soDel">SUPPRIMER LE DÉFI</button>
  </div>`;

let newM = 'sessions', newP = 'week', menuC = null;
function openNew(pre){
  newM = pre ? pre.m : 'sessions'; newP = pre ? pre.p : 'week';
  $('#soT', fixed).value = pre ? pre.l : '';
  $('#soV', fixed).value = pre ? pre.t : '';
  syncNew();
  J.openSheet($('#soNew', fixed));
}
function syncNew(){
  $$('#soM button', fixed).forEach(b => b.classList.toggle('on', b.dataset.m === newM));
  $$('#soP button', fixed).forEach(b => b.classList.toggle('on', b.dataset.p === newP));
  $('#soVL', fixed).textContent = `OBJECTIF (${{sessions:'SÉANCES', volume:'TONNES', steps:'PAS'}[newM]})`;
  $('#soV', fixed).placeholder = {sessions:'4', volume:'20', steps:'70000'}[newM];
}
async function setShare(sh){
  S().share = sh; st.save(); lastSig = '';
  if (sh.muscu || sh.steps) J.notifPrompt && J.notifPrompt('Soyez prévenu quand un ami vous dépasse ou vous 🔥.');
  try { await J.api('PUT', '/api/social/me', {share:sh, summary:summary()}); lastSig = JSON.stringify({share:sh, summary:summary()}); } catch(e) { J.toast('Partage non envoyé : ' + e.message); }
  load();
}

function bind(){
  root.addEventListener('click', async e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { J.haptic(); tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const a = e.target.closest('[data-a]'), act = a && a.dataset.a; if (!act) return;
    J.haptic();
    if (act === 'doshare') return setShare({muscu:$('#soCM', root).checked, steps:$('#soCS', root).checked});
    if (act === 'noshare') return setShare({muscu:false, steps:false});
    if (act === 'share') { const sh = S().share || {}; $('#soSM', fixed).checked = !!sh.muscu; $('#soSS', fixed).checked = !!sh.steps; return J.openSheet($('#soShare', fixed)); }
    if (act === 'kudos') {
      const u = a.dataset.u, item = a.dataset.i, had = data.kudos.some(k => k.from === me() && k.target === u && k.item === item);
      data.kudos = had ? data.kudos.filter(k => !(k.from === me() && k.target === u && k.item === item)) : [...data.kudos, {from:me(), target:u, item}];
      render();
      try { await J.api('POST', '/api/social/kudos', {target:u, item}); } catch(err) { J.toast(err.message); load(); }
      return;
    }
    if (act === 'tpl') return openNew({m:a.dataset.m, t:a.dataset.t, p:a.dataset.p, l:a.dataset.l});
    const c = a.closest('[data-c]') && data.challenges.find(x => x.id === a.closest('[data-c]').dataset.c);
    if (!c) return;
    if (act === 'join' || act === 'leave') {
      try { await J.api('POST', `/api/challenges/${c.id}/${act}`); J.toast(act === 'join' ? `Défi rejoint : ${c.title}` : 'Vous avez quitté le défi'); if (act === 'join') J.notifPrompt && J.notifPrompt('Soyez prévenu quand un ami vous dépasse ou vous 🔥.'); } catch(err) { J.toast(err.message); }
      if (act === 'join' && !(S().share || {})[METRICS[c.metric].share]) J.toast('Activez le partage ' + (c.metric === 'steps' ? 'des pas' : 'des séances') + ' pour que votre progression compte');
      return load();
    }
    if (act === 'chmenu') { menuC = c; J.openSheet($('#soMenu', fixed)); }
  });
  $('#soAdd', fixed).addEventListener('click', () => { J.haptic(); openNew(); });
  $('#soM', fixed).addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { newM = b.dataset.m; syncNew(); } });
  $('#soP', fixed).addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { newP = b.dataset.p; syncNew(); } });
  $('#soCreate', fixed).addEventListener('click', async () => {
    const target = num($('#soV', fixed).value), [start, end] = period(newP);
    const title = $('#soT', fixed).value.trim() || `${METRICS[newM].unit(target)} ${{week:'cette semaine', month:'ce mois-ci'}[newP] || 'en ' + newP + ' jours'}`;
    if (!(target > 0)) { J.toast('Indiquez un objectif'); return; }
    try { await J.api('POST', '/api/challenges', {title, metric:newM, target, start, end}); J.closeSheet(); J.toast('Défi lancé : vos amis peuvent le rejoindre'); tab = 'defis'; load(); J.notifPrompt && J.notifPrompt('Soyez prévenu quand un ami vous dépasse ou vous 🔥.'); }
    catch(err) { J.toast(err.message); }
  });
  $('#soShareSave', fixed).addEventListener('click', () => { J.closeSheet(); setShare({muscu:$('#soSM', fixed).checked, steps:$('#soSS', fixed).checked}); J.toast('Partage mis à jour'); });
  $('#soDel', fixed).addEventListener('click', async () => {
    if (!menuC) return; J.closeSheet();
    try { await J.api('DELETE', '/api/challenges/' + menuC.id); J.toast('Défi supprimé'); } catch(err) { J.toast(err.message); }
    menuC = null; load();
  });
}

function message(){
  if (!S().share) return 'Partagez vos séances et vos pas pour vous mesurer à vos amis.';
  const b = board('sessions'), i = b.findIndex(x => x.u === me());
  const act = (data && data.challenges || []).filter(c => c.end >= today() && c.members.includes(me()));
  if (i >= 0 && b.length > 1) return `${i === 0 ? 'En tête' : (i + 1) + 'e'} du classement des séances cette semaine.${act.length ? ` ${act.length} défi${act.length > 1 ? 's' : ''} en cours.` : ''}`;
  return act.length ? `${act.length} défi${act.length > 1 ? 's' : ''} en cours.` : 'Lancez un défi à vos amis.';
}

/* ---------- déclaration du module ---------- */
J.module({
  id: 'social',
  code: '08',
  order: 19,
  name: 'Défis',
  short: 'Défis',
  tagline: 'Séances des amis, classement et défis',
  accent: '#ffd23f',
  cls: 'so',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',

  init(){
    st = J.store('social', DEFAULTS);
    // le résumé suit les séances et les pas
    J.store('muscu', {sessions:[]}).onChange(schedulePush);
    J.store('apple', {days:{}}).onChange(schedulePush);
    clearTimeout(loadT); loadT = setTimeout(() => { push(); load(); }, 3000);
  },
  summary(){ return S().share ? esc(message()) : 'Partager pour se mesurer'; },
  stat(){
    if (!S().share) return {label:'DÉFIS', value:'<small>Activer</small>', sub:'se mesurer aux amis'};
    const b = board('sessions'), i = b.findIndex(x => x.u === me());
    const act = (data && data.challenges || []).filter(c => c.end >= today() && c.members.includes(me()));
    return {label:'DÉFIS', value:i >= 0 && b.length > 1 ? (i === 0 ? '1er' : (i + 1) + 'e') : act.length ? act.length + '' : '—', sub:i >= 0 && b.length > 1 ? `sur ${b.length} · séances de la semaine` : act.length ? 'défis en cours' : 'aucun défi'};
  },
  report(){ return message(); },
  chat(){
    if (!data) return '';
    const lines = ['sessions', 'volume', 'steps'].map(m => { const b = board(m); return b.length ? `${METRICS[m].n} : ` + b.map(x => `${x.u === me() ? 'moi' : x.u} ${METRICS[m].unit(x.v)}`).join(', ') : ''; }).filter(Boolean);
    const ch = (data.challenges || []).filter(c => c.end >= today()).map(c => `« ${c.title} » jusqu'au ${c.end} (${chProgress(c).map(x => `${x.u === me() ? 'moi' : x.u} ${x.v === null ? '?' : METRICS[c.metric].unit(x.v)}`).join(', ')})`);
    return `DÉFIS ENTRE AMIS (semaine) : ${lines.join(' ; ') || 'personne ne partage'}.${ch.length ? ' Défis en cours : ' + ch.join(' ; ') + '.' : ''}`;
  },

  mount(body, fx){
    root = body; fixed = fx;
    root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED;
    bind(); render(); load(); push();
    J.say(message());
  },
  onShow(){ render(); load(); push(); J.say(message()); },
  unmount(){ root = null; fixed = null; },
});
})();
