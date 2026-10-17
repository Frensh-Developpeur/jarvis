/* ============================================================
   Module 04 — Musculation
   Bibliothèque d'exercices (sélection française + base wger),
   séances en direct (kg × reps, série précédente, minuteur de repos),
   routines, historique, progression (1RM estimé) et records.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, uid} = J;

/* ---------- exercices courants (noms français) ---------- */
const POP = [
  ['Développé couché', 'Pectoraux', ['Pectoraux', 'Triceps', 'Épaules'], ['Barre', 'Banc']],
  ['Développé couché haltères', 'Pectoraux', ['Pectoraux', 'Triceps'], ['Haltères', 'Banc']],
  ['Développé incliné haltères', 'Pectoraux', ['Pectoraux', 'Épaules'], ['Haltères', 'Banc incliné']],
  ['Développé incliné barre', 'Pectoraux', ['Pectoraux', 'Épaules'], ['Barre', 'Banc incliné']],
  ['Écarté haltères', 'Pectoraux', ['Pectoraux'], ['Haltères', 'Banc']],
  ['Écarté à la poulie', 'Pectoraux', ['Pectoraux'], ['Poulie']],
  ['Pompes', 'Pectoraux', ['Pectoraux', 'Triceps'], ['Poids du corps']],
  ['Dips', 'Pectoraux', ['Pectoraux', 'Triceps'], ['Poids du corps']],
  ['Pull-over', 'Pectoraux', ['Pectoraux', 'Dorsaux'], ['Haltères']],
  ['Squat', 'Jambes', ['Quadriceps', 'Fessiers'], ['Barre']],
  ['Squat bulgare', 'Jambes', ['Quadriceps', 'Fessiers'], ['Haltères']],
  ['Hack squat', 'Jambes', ['Quadriceps'], ['Machine']],
  ['Presse à cuisses', 'Jambes', ['Quadriceps', 'Fessiers'], ['Machine']],
  ['Fentes', 'Jambes', ['Quadriceps', 'Fessiers'], ['Haltères']],
  ['Leg extension', 'Jambes', ['Quadriceps'], ['Machine']],
  ['Leg curl', 'Jambes', ['Ischios'], ['Machine']],
  ['Soulevé de terre roumain', 'Jambes', ['Ischios', 'Fessiers'], ['Barre']],
  ['Hip thrust', 'Jambes', ['Fessiers'], ['Barre', 'Banc']],
  ['Mollets debout', 'Mollets', ['Mollets'], ['Machine']],
  ['Soulevé de terre', 'Dos', ['Dorsaux', 'Ischios', 'Fessiers'], ['Barre']],
  ['Tractions', 'Dos', ['Dorsaux', 'Biceps'], ['Barre de traction']],
  ['Tirage vertical', 'Dos', ['Dorsaux', 'Biceps'], ['Poulie']],
  ['Tirage horizontal', 'Dos', ['Dorsaux', 'Trapèzes'], ['Poulie']],
  ['Rowing barre', 'Dos', ['Dorsaux', 'Trapèzes'], ['Barre']],
  ['Rowing haltère', 'Dos', ['Dorsaux'], ['Haltères', 'Banc']],
  ['Shrug', 'Dos', ['Trapèzes'], ['Haltères']],
  ['Développé militaire', 'Épaules', ['Épaules', 'Triceps'], ['Barre']],
  ['Développé haltères assis', 'Épaules', ['Épaules', 'Triceps'], ['Haltères', 'Banc']],
  ['Élévations latérales', 'Épaules', ['Épaules'], ['Haltères']],
  ['Oiseau (élévations arrière)', 'Épaules', ['Épaules', 'Trapèzes'], ['Haltères']],
  ['Face pull', 'Épaules', ['Épaules', 'Trapèzes'], ['Poulie']],
  ['Curl biceps barre', 'Bras', ['Biceps'], ['Barre']],
  ['Curl haltères', 'Bras', ['Biceps'], ['Haltères']],
  ['Curl marteau', 'Bras', ['Brachial', 'Biceps'], ['Haltères']],
  ['Extension triceps poulie', 'Bras', ['Triceps'], ['Poulie']],
  ['Barre au front', 'Bras', ['Triceps'], ['Barre EZ', 'Banc']],
  ['Extension triceps au-dessus de la tête', 'Bras', ['Triceps'], ['Haltères']],
  ['Crunch', 'Abdos', ['Abdominaux'], ['Tapis']],
  ['Relevé de jambes', 'Abdos', ['Abdominaux'], ['Barre de traction']],
  ['Gainage (secondes)', 'Abdos', ['Abdominaux'], ['Tapis']],
  ['Russian twist', 'Abdos', ['Obliques'], ['Tapis']],
  ['Roue abdominale', 'Abdos', ['Abdominaux'], []],
].map((r, i) => ({i:'p' + (i + 1), n:r[0], c:r[1], m:r[2], q:r[3], pop:true}));
const CATS = ['Pectoraux', 'Dos', 'Jambes', 'Épaules', 'Bras', 'Abdos', 'Mollets', 'Cardio'];
const CAT_ICON = {
  Pectoraux:'<path d="M4 7c3-2 5-2 8 0 3-2 5-2 8 0v5c0 3-3 5-8 5s-8-2-8-5z"/>',
  Dos:'<path d="M12 3v18M7 6c-2 3-2 9 0 13M17 6c2 3 2 9 0 13"/>',
  Jambes:'<path d="M9 3l-1 8 2 10M15 3l1 8-2 10"/>',
  Épaules:'<circle cx="12" cy="6" r="2.5"/><path d="M4 14c1-4 4-5 8-5s7 1 8 5"/>',
  Bras:'<path d="M5 18c3 0 4-2 5-5l2-6c1-2 4-2 4 1l-1 5c2 0 4 2 4 4"/>',
  Abdos:'<rect x="7" y="4" width="10" height="16" rx="3"/><path d="M12 4v16M7 9h10M7 14h10"/>',
  Mollets:'<path d="M10 3c-2 5 2 8 0 13l-1 5M14 3c2 5-2 8 0 13l1 5"/>',
  Cardio:'<path d="M3 12h4l2-4 3 8 2-4h7"/>',
};
const catSvg = c => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${CAT_ICON[c] || CAT_ICON.Cardio}</svg>`;

let wger = null, lib = null;
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function loadLib(){
  if (lib) return Promise.resolve(lib);
  return fetch('modules/muscu/wger.json').then(r => r.json()).then(d => { wger = d.rows; buildLib(); return lib; }).catch(() => { wger = []; buildLib(); return lib; });
}
function buildLib(){
  const popNames = new Set(POP.map(p => norm(p.n)));
  lib = [...S().custom.map(c => Object.assign({custom:true}, c)), ...POP, ...(wger || []).filter(w => !popNames.has(norm(w.n)))];
  lib.forEach(e => e.s = norm(e.n + ' ' + (e.e || '') + ' ' + (e.m || []).join(' ')));
}
const exById = id => (lib || []).find(e => e.i === id) || POP.find(e => e.i === id) || S().custom.find(e => e.i === id);

/* ---------- état ---------- */
let st = null, root = null, fixed = null, tab = 'seance', tick = null;
const S = () => st.data;
const save = () => st.save();
const DEFAULTS = {sessions:[], routines:[], custom:[], active:null, rest:90, weekGoal:3};

/* ---------- calculs ---------- */
const n = v => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : 0; };
const e1rm = (kg, reps) => reps <= 1 ? kg : kg * (1 + reps / 30);          // formule d'Epley
const fmt = v => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
const doneSets = ex => ex.sets.filter(s => s.done && n(s.reps) > 0);
const volume = sess => sess.ex.reduce((a, ex) => a + doneSets(ex).reduce((b, s) => b + n(s.kg) * n(s.reps), 0), 0);
const dur = sess => Math.max(1, Math.round(((sess.end || Date.now()) - sess.start) / 60000));
const hms = ms => { const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const ago = ts => { const d = Math.floor((new Date().setHours(0,0,0,0) - new Date(ts).setHours(0,0,0,0)) / 864e5); return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} jours`; };
const weekStart = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const thisWeek = () => S().sessions.filter(s => s.start >= weekStart());
function prevFor(exId, before = Infinity){
  const s = [...S().sessions].sort((a, b) => b.start - a.start).find(x => x.start < before && x.ex.some(e => e.id === exId && doneSets(e).length));
  return s ? doneSets(s.ex.find(e => e.id === exId)) : [];
}
function bestE1(exId, before = Infinity){
  let best = 0;
  S().sessions.forEach(s => { if (s.start >= before) return; s.ex.forEach(e => { if (e.id === exId) doneSets(e).forEach(x => { best = Math.max(best, e1rm(n(x.kg), n(x.reps))); }); }); });
  return best;
}

/* ---------- coach : surcharge progressive (double progression) ----------
   - toutes les séries de travail en haut de la fourchette de répétitions → on monte la charge d'un palier (et on repart 2 reps plus bas, sauf en force)
   - sinon même charge, une répétition de plus par série
   - 3 séances sans battre son record estimé → on allège de 10 % pour repartir (décharge) */
const BIG = /squat|soulev|terre|presse|hip thrust|fente|leg press/i;
function incOf(exId, name){
  const e = exById(exId) || {}, q = (e.q || []).join(' ');
  if (/Haltères|Kettlebell/.test(q)) return 2;
  if (e.c === 'Jambes' || BIG.test(name || e.n || '')) return 5;
  return 2.5;
}
const repRange = r => r <= 5 ? [3, 5] : r <= 8 ? [6, 8] : r <= 12 ? [8, 12] : [12, 20];
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : 0; };
function histFor(exId, before = Infinity){
  return [...S().sessions].filter(s => s.start < before).sort((a, b) => b.start - a.start)
    .map(s => s.ex.find(e => e.id === exId)).filter(e => e && doneSets(e).length).map(doneSets);
}
const bestOf = sets => Math.max(...sets.map(x => e1rm(n(x.kg), n(x.reps))));
function coach(exId, name, before = Infinity){
  const hist = histFor(exId, before);
  if (!hist.length) return null;
  const last = hist[0], inc = incOf(exId, name), round = v => Math.max(inc, Math.round(v / inc) * inc);
  const work = Math.max(...last.map(x => n(x.kg)));
  const ws = last.filter(x => n(x.kg) === work), reps = ws.map(x => n(x.reps));
  const [lo, hi] = repRange(median(reps)), sets = ws.length;
  if (!work) {   // poids du corps : on progresse en répétitions
    const r = Math.min(...reps) + 1;
    return {kg:0, reps:r, sets, why:`une répétition de plus que la dernière fois`, kind:'reps'};
  }
  const e1s = hist.map(bestOf), recent = Math.max(...e1s.slice(0, 3)), before3 = e1s.length > 3 ? Math.max(...e1s.slice(3)) : Infinity;
  if (e1s.length >= 4 && recent <= before3 + .01)
    return {kg:round(work * .9), reps:hi, sets, why:`3 séances sans progrès : on allège de 10 % pour repartir plus fort`, kind:'deload', stalled:true};
  if (reps.every(r => r >= hi))
    return {kg:work + inc, reps:hi <= 5 ? hi : Math.max(lo, hi - 2), sets, why:`toutes vos séries à ${hi} répétitions la dernière fois : +${fmt(inc)} kg`, kind:'up'};
  const r = Math.min(Math.min(...reps) + 1, hi);
  return {kg:work, reps:r, sets, why:`même charge, visez ${r} répétitions sur chaque série`, kind:'reps'};
}
/* disques par côté pour une barre de 20 kg */
/* objectifs de tous les exercices pratiqués récemment */
function coachAll(){
  const seen = new Map();
  [...S().sessions].sort((a, b) => b.start - a.start).slice(0, 12).forEach(s => s.ex.forEach(e => { if (!seen.has(e.id)) seen.set(e.id, e.name); }));
  return [...seen].map(([id, name]) => ({id, name, c:coach(id, name)})).filter(x => x.c);
}
function plates(total, bar = 20){
  let side = (total - bar) / 2; if (side < 0) return null;
  const out = [];
  for (const p of [25, 20, 15, 10, 5, 2.5, 1.25]) while (side >= p - 1e-9) { out.push(p); side -= p; }
  return {list:out, rest:Math.round(side * 2 * 100) / 100};
}
const isBarbell = exId => /Barre(?! de traction)/.test(((exById(exId) || {}).q || []).join(' '));
/* prochaine routine conseillée : celle qu'on n'a pas faite depuis le plus longtemps */
function nextRoutine(){
  if (S().routines.length < 2) return null;
  const lastOf = r => Math.max(0, ...S().sessions.filter(s => s.name === r.name).map(s => s.start));
  return [...S().routines].sort((a, b) => lastOf(a) - lastOf(b)).map(r => ({r, last:lastOf(r)}))[0];
}

/* ---------- messages ---------- */
function status(){
  const a = S().active;
  if (a) return `Séance en cours depuis ${dur(a)} minutes. Courage.`;
  const last = [...S().sessions].sort((x, y) => y.start - x.start)[0], w = thisWeek().length;
  if (!last) return 'Aucune séance enregistrée. Démarrez votre première séance quand vous êtes prêt.';
  return `Dernière séance : ${last.name}, ${ago(last.start)}. ${w} séance${w > 1 ? 's' : ''} cette semaine sur ${S().weekGoal} visées.`;
}

/* ============================================================
   Interface
   ============================================================ */
const q = s => $(s, root);
const fq = s => $(s, fixed);
const TEMPLATE = `
  <div class="utabs" id="mTabs"><button data-tab="seance">SÉANCE</button><button data-tab="hist">HISTORIQUE</button><button data-tab="prog">PROGRÈS</button></div>
  <div id="mTab"></div>`;

function exThumb(e){
  return e && e.img ? `<img src="${esc(e.img)}" alt="" loading="lazy">` : `<span class="xi">${catSvg(e ? e.c : '')}</span>`;
}

/* ---------- onglet SÉANCE ---------- */
function renderIdle(){
  const w = thisWeek(), vol = w.reduce((a, s) => a + volume(s), 0);
  const last = [...S().sessions].sort((a, b) => b.start - a.start)[0];
  q('#mTab').innerHTML = `
    <div class="mhero">
      <div class="mh-top"><span>Cette semaine</span><button class="wgoal" data-a="weekgoal">objectif ${S().weekGoal} séances</button></div>
      <div class="mh-dots">${Array.from({length:Math.max(S().weekGoal, w.length)}, (_, i) => `<i class="${i < w.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="mh-stats"><div><b>${w.length}</b><small>séance${w.length > 1 ? 's' : ''}</small></div><div><b>${fmt(vol / 1000)}</b><small>tonnes soulevées</small></div><div><b>${w.reduce((a, s) => a + dur(s), 0)}</b><small>minutes</small></div></div>
      <button class="btn primary" data-a="start">DÉMARRER UNE SÉANCE</button>
    </div>
    ${(() => { const nr = nextRoutine(); return nr ? `<div class="slabel"><span>CONSEILLÉE AUJOURD'HUI</span></div>
      <div class="rcard next" data-r="${nr.r.id}"><div class="ri"><b>${esc(nr.r.name)}</b><small>${nr.last ? 'Dernière fois ' + ago(nr.last) : 'Pas encore faite'} · ${nr.r.ex.length} exercices</small></div><button class="rgo" data-a="startr">GO</button></div>` : ''; })()}
    <div class="slabel"><span>MES ROUTINES</span><button class="lnk" data-a="newroutine">+ Nouvelle</button></div>
    ${S().routines.length ? S().routines.map(r => `
      <div class="rcard" data-r="${r.id}">
        <div class="ri"><b>${esc(r.name)}</b><small>${r.ex.map(e => esc(e.name)).join(' · ')}</small></div>
        <button class="rgo" data-a="startr">GO</button><button class="rmore" data-a="rmenu" aria-label="Options">⋯</button>
      </div>`).join('') : '<p class="note muted-box">Enregistrez vos séances types (Push, Pull, Jambes…) pour les relancer en un geste.</p>'}
    ${last ? `<div class="slabel"><span>DERNIÈRE SÉANCE</span></div>${sessCard(last)}` : ''}`;
}
function sessCard(s){
  const nb = s.ex.reduce((a, e) => a + doneSets(e).length, 0);
  return `<button class="scard" data-sess="${s.id}">
    <div class="sc-top"><b>${esc(s.name)}</b><span>${new Date(s.start).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'})}</span></div>
    <div class="sc-ex">${s.ex.map(e => esc(e.name)).join(' · ')}</div>
    <div class="sc-st"><span>⏱ ${dur(s)} min</span><span>${nb} séries</span><span>${fmt(volume(s))} kg</span>${s.prs ? `<span class="pr">🏆 ${s.prs}</span>` : ''}</div></button>`;
}
function setRow(ex, s, i, prev, c){
  const p = prev[i], t = c ? {kg:c.kg, reps:c.reps} : p ? {kg:n(p.kg), reps:n(p.reps)} : null;   // valeur proposée : l'objectif du coach, sinon la dernière fois
  return `<div class="set ${s.done ? 'done' : ''}" data-s="${i}">
    <span class="sn">${i + 1}</span>
    <span class="pv">${p ? fmt(n(p.kg)) + '×' + n(p.reps) : '—'}</span>
    <input class="kg" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="${t ? fmt(t.kg) : 'kg'}" value="${esc(s.kg)}">
    <input class="rp" inputmode="numeric" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${t ? t.reps : 'reps'}" value="${esc(s.reps)}">
    <button class="sck" data-a="check" aria-label="Série terminée"></button></div>`;
}
function renderActive(){
  const a = S().active;
  q('#mTab').innerHTML = `
    <div class="live">
      <input class="lname" id="mName" value="${esc(a.name)}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Nom de la séance">
      <div class="lrow"><span class="ltime" id="mElapsed">${hms(Date.now() - a.start)}</span><span class="lvol" id="mVol">${fmt(volume(a))} kg</span><button class="btn primary lfin" data-a="finish">TERMINER</button></div>
    </div>
    ${a.ex.map(ex => { const e = exById(ex.id), prev = prevFor(ex.id, a.start), c = coach(ex.id, ex.name, a.start);
      return `<div class="exc" data-x="${ex.uid}">
        <div class="exh">${exThumb(e)}<div class="exn"><b>${esc(ex.name)}</b><small>${e ? esc([(e.m || []).slice(0, 2).join(', '), (e.q || [])[0]].filter(Boolean).join(' · ')) : ''}</small></div>
          <button class="rmore" data-a="exmenu" aria-label="Options">⋯</button></div>
        ${c ? `<button class="coach ${c.kind}" data-a="coach" data-kg="${c.kg}"><span class="ct">🎯 ${c.sets} × ${c.reps}${c.kg ? ` à <b>${fmt(c.kg)} kg</b>` : ' reps'}${c.kind === 'up' ? ' <em>↑</em>' : c.kind === 'deload' ? ' <em>↓</em>' : ''}</span><small>${esc(c.why)}${c.kg && isBarbell(ex.id) ? ' · toucher pour les disques' : ''}</small></button>` : ''}
        <div class="sets"><div class="sh"><span>SÉRIE</span><span>PRÉC.</span><span>KG</span><span>REPS</span><span></span></div>
          ${ex.sets.map((s, i) => setRow(ex, s, i, prev, c)).join('')}</div>
        <button class="addset" data-a="addset">+ AJOUTER UNE SÉRIE</button>
      </div>`; }).join('')}
    <button class="btn" data-a="addex">+ AJOUTER UN EXERCICE</button>
    <button class="cancel" data-a="cancel">Abandonner la séance</button>`;
}

/* ---------- onglet HISTORIQUE ---------- */
function renderHist(){
  const list = [...S().sessions].sort((a, b) => b.start - a.start);
  if (!list.length) { q('#mTab').innerHTML = '<div class="empty" style="margin-top:30px">Aucune séance terminée pour le moment.</div>'; return; }
  let html = '', month = '';
  list.forEach(s => {
    const m = new Date(s.start).toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
    if (m !== month) { month = m; const ms = list.filter(x => new Date(x.start).toLocaleDateString('fr-FR', {month:'long', year:'numeric'}) === m); html += `<div class="slabel"><span>${m.toUpperCase()}</span><span>${ms.length} séance${ms.length > 1 ? 's' : ''}</span></div>`; }
    html += sessCard(s);
  });
  q('#mTab').innerHTML = html;
}

/* ---------- onglet PROGRÈS ---------- */
let progEx = null;
function exStats(){
  const map = new Map();
  [...S().sessions].sort((a, b) => a.start - b.start).forEach(s => s.ex.forEach(e => {
    const ds = doneSets(e); if (!ds.length) return;
    const best = Math.max(...ds.map(x => e1rm(n(x.kg), n(x.reps))));
    const top = ds.reduce((a, x) => n(x.kg) > n(a.kg) || (n(x.kg) === n(a.kg) && n(x.reps) > n(a.reps)) ? x : a, ds[0]);
    const vol = ds.reduce((a, x) => a + n(x.kg) * n(x.reps), 0);
    const o = map.get(e.id) || {id:e.id, name:e.name, points:[]};
    o.points.push({t:s.start, e1:best, top, vol, sets:ds});
    map.set(e.id, o);
  }));
  return [...map.values()].sort((a, b) => b.points.length - a.points.length);
}
function renderProg(){
  const all = exStats();
  if (!all.length) { q('#mTab').innerHTML = '<div class="empty" style="margin-top:30px">Terminez quelques séances pour voir votre progression.</div>'; return; }
  if (progEx && !all.some(x => x.id === progEx)) progEx = null;
  if (!progEx) {
    const stalled = coachAll().filter(x => x.c.stalled);
    q('#mTab').innerHTML = (stalled.length ? `<div class="stall"><b>⚠ ${stalled.length === 1 ? 'Un exercice stagne' : stalled.length + ' exercices stagnent'}</b><span>${stalled.map(x => esc(x.name)).join(', ')} : 3 séances sans battre votre record. Le coach propose d'alléger de 10 % à la prochaine séance, puis de remonter : c'est souvent ce qui débloque.</span></div>` : '') +
      `<div class="slabel"><span>VOS EXERCICES</span><span>1RM estimé</span></div><div class="plist">${all.map(x => {
      const lastE = x.points[x.points.length - 1].e1, ref = x.points.find(p => p.t >= Date.now() - 30 * 864e5) || x.points[0], diff = lastE - ref.e1;
      return `<button class="prow" data-prog="${x.id}">${exThumb(exById(x.id))}<span class="pn"><b>${esc(x.name)}</b><small>${x.points.length} séance${x.points.length > 1 ? 's' : ''}</small></span>
        <span class="pe"><b>${fmt(lastE)} kg</b><small class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '▲ +' + fmt(diff) : diff < 0 ? '▼ ' + fmt(diff) : '='} sur 30 j</small></span></button>`; }).join('')}</div>`;
    return;
  }
  const x = all.find(a => a.id === progEx), pts = x.points;
  const best = pts.reduce((a, p) => p.e1 > a.e1 ? p : a), heavy = pts.reduce((a, p) => n(p.top.kg) > n(a.top.kg) ? p : a), bigVol = pts.reduce((a, p) => p.vol > a.vol ? p : a);
  const W = 320, H = 150, min = Math.min(...pts.map(p => p.e1)) * .95, max = Math.max(...pts.map(p => p.e1)) * 1.03 || 1;
  const X = i => pts.length === 1 ? W / 2 : 16 + i / (pts.length - 1) * (W - 32), Y = v => H - 22 - (v - min) / (max - min || 1) * (H - 40);
  const line = pts.map((p, i) => `${X(i)},${Y(p.e1)}`).join(' ');
  q('#mTab').innerHTML = `
    <button class="lnk back" data-prog="">‹ Tous les exercices</button>
    <div class="ptitle">${exThumb(exById(x.id))}<b>${esc(x.name)}</b></div>
    ${(() => { const c = coach(x.id, x.name); return c ? `<div class="coach ${c.kind} static"><span class="ct">🎯 Prochaine séance : ${c.sets} × ${c.reps}${c.kg ? ` à <b>${fmt(c.kg)} kg</b>` : ' reps'}</span><small>${esc(c.why)}</small></div>` : ''; })()}
    <div class="kpis3">
      <div><small>1RM ESTIMÉ</small><b>${fmt(best.e1)} kg</b></div>
      <div><small>CHARGE MAX</small><b>${fmt(n(heavy.top.kg))} kg</b><span>× ${n(heavy.top.reps)}</span></div>
      <div><small>SÉANCES</small><b>${pts.length}</b></div>
    </div>
    <section class="panel"><div class="ph"><span>1RM ESTIMÉ</span><span>formule d'Epley</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="pchart">
        <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe0ff" stop-opacity=".35"/><stop offset="1" stop-color="#3fe0ff" stop-opacity="0"/></linearGradient></defs>
        ${pts.length > 1 ? `<polygon points="${X(0)},${H - 22} ${line} ${X(pts.length - 1)},${H - 22}" fill="url(#pg)"/>` : ''}
        <polyline points="${line}" fill="none" stroke="#3fe0ff" stroke-width="2.2" style="filter:drop-shadow(0 0 4px #3fe0ff)"/>
        ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.e1)}" r="${p === best ? 4.5 : 2.8}" fill="${p === best ? '#ffb347' : '#3fe0ff'}"/>`).join('')}
        <text x="${X(0)}" y="${H - 6}" class="ax">${new Date(pts[0].t).toLocaleDateString('fr-FR', {day:'numeric', month:'short'})}</text>
        <text x="${X(pts.length - 1)}" y="${H - 6}" text-anchor="end" class="ax">${new Date(pts[pts.length - 1].t).toLocaleDateString('fr-FR', {day:'numeric', month:'short'})}</text>
      </svg>
    </section>
    <section class="panel"><div class="ph"><span>RECORDS</span><span></span></div>
      <div class="rec"><span>Meilleur 1RM estimé</span><b>${fmt(best.e1)} kg</b><small>${new Date(best.t).toLocaleDateString('fr-FR')}</small></div>
      <div class="rec"><span>Charge la plus lourde</span><b>${fmt(n(heavy.top.kg))} kg × ${n(heavy.top.reps)}</b><small>${new Date(heavy.t).toLocaleDateString('fr-FR')}</small></div>
      <div class="rec"><span>Plus gros volume</span><b>${fmt(bigVol.vol)} kg</b><small>${new Date(bigVol.t).toLocaleDateString('fr-FR')}</small></div>
    </section>
    <section class="panel"><div class="ph"><span>DERNIÈRES SÉANCES</span><span></span></div>
      ${[...pts].reverse().slice(0, 8).map(p => `<div class="rec"><span class="cap">${new Date(p.t).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'})}</span><b class="sm">${p.sets.map(s => fmt(n(s.kg)) + '×' + n(s.reps)).join('  ')}</b></div>`).join('')}
    </section>`;
}

function render(){
  if (!root) return;
  $$('#mTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'seance') (S().active ? renderActive : renderIdle)();
  else if (tab === 'hist') renderHist();
  else renderProg();
  fq('#mStart').hidden = !(tab === 'seance' && !S().active);
}

/* ============================================================
   Séance en direct
   ============================================================ */
function startSession(fromEx, name){
  S().active = {id:uid(), name:name || defaultName(), start:Date.now(), ex:(fromEx || []).map(e => ({uid:uid(), id:e.id, name:e.name, sets:Array.from({length:Math.max(1, e.sets || 3)}, () => ({kg:'', reps:'', done:false}))}))};
  save(); tab = 'seance'; J.haptic(); render(); startTick();
  J.say(fromEx && fromEx.length ? `Séance ${S().active.name} lancée. ${fromEx.length} exercice${fromEx.length > 1 ? "s" : ""} au programme.` : 'Séance lancée. Ajoutez votre premier exercice.');
  if (!fromEx || !fromEx.length) setTimeout(() => openPicker('session'), 350);
}
function defaultName(){ const h = new Date().getHours(); return 'Séance du ' + (h < 12 ? 'matin' : h < 18 ? 'midi' : 'soir'); }
function startTick(){
  clearInterval(tick);
  tick = setInterval(() => {
    const a = S().active, el = root && q('#mElapsed');
    if (a && el) el.textContent = hms(Date.now() - a.start);
  }, 1000);
}
const activeEx = uidv => S().active.ex.find(e => e.uid === uidv);

/* minuteur de repos */
let restEnd = 0, restTotal = 0, restTimer = null;
function startRest(sec){
  restTotal = sec || S().rest; restEnd = Date.now() + restTotal * 1000;
  fq('#mRest').hidden = false;
  clearInterval(restTimer);
  const upd = () => {
    const left = Math.max(0, restEnd - Date.now());
    fq('#rTime').textContent = hms(left);
    fq('#rBar').style.width = (left / (restTotal * 1000) * 100) + '%';
    if (left <= 0) { clearInterval(restTimer); fq('#mRest').hidden = true; beep(); J.haptic(); J.toast('Repos terminé · série suivante'); }
  };
  upd(); restTimer = setInterval(upd, 250);
}
function stopRest(){ clearInterval(restTimer); if (fixed) fq('#mRest').hidden = true; }
let actx = null;
function beep(){
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [0, .22].forEach(t => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.0001, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(.25, actx.currentTime + t + .02); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + t + .18); o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .2); });
  } catch(e) {}
}

/* fin de séance */
function finishSession(){
  const a = S().active;
  a.ex.forEach(e => e.sets = e.sets.filter(s => s.done));
  a.ex = a.ex.filter(e => e.sets.length);
  if (!a.ex.length) { J.toast('Aucune série validée : cochez vos séries avant de terminer'); render(); return; }
  a.end = Date.now();
  const prs = [];
  a.ex.forEach(e => { const before = bestE1(e.id, a.start), now = Math.max(...doneSets(e).map(s => e1rm(n(s.kg), n(s.reps)))); if (before > 0 && now > before + .01) prs.push({name:e.name, from:before, to:now}); });
  a.prs = prs.length || 0;
  fq('#mFSum').innerHTML = `
    <div class="fs-big"><div><b>${dur(a)}</b><small>MINUTES</small></div><div><b>${a.ex.reduce((x, e) => x + e.sets.length, 0)}</b><small>SÉRIES</small></div><div><b>${fmt(volume(a))}</b><small>KG SOULEVÉS</small></div></div>
    ${prs.length ? `<div class="fs-pr"><b>🏆 ${prs.length} nouveau${prs.length > 1 ? 'x' : ''} record${prs.length > 1 ? 's' : ''}</b>${prs.map(p => `<span>${esc(p.name)} : ${fmt(p.from)} → <b>${fmt(p.to)} kg</b> (1RM estimé)</span>`).join('')}</div>` : ''}`;
  fq('#mFRoutine').checked = false; fq('#mFRoutineF').hidden = true;
  fq('#mFRoutineName').value = a.name;
  pendingFinish = a;
  J.openSheet(fq('#mFinish'));
}
let pendingFinish = null;
function confirmFinish(){
  const a = pendingFinish; if (!a) return;
  if (fq('#mFRoutine').checked) S().routines.push({id:uid(), name:fq('#mFRoutineName').value.trim() || a.name, ex:a.ex.map(e => ({id:e.id, name:e.name, sets:e.sets.length}))});
  S().sessions.push(a); S().active = null; pendingFinish = null;
  stopRest(); clearInterval(tick);
  save(); J.closeSheet(); J.haptic(); render();
  J.say(`Séance terminée : ${fmt(volume(a))} kilos soulevés en ${dur(a)} minutes.` + (a.prs ? ` ${a.prs} nouveau${a.prs > 1 ? 'x' : ''} record${a.prs > 1 ? 's' : ''}. Remarquable.` : ' Bon travail.'));
}

/* ============================================================
   Sélecteur d'exercices
   ============================================================ */
let pickMode = 'session', picked = [], pickCat = '';
function openPicker(mode){
  pickMode = mode; picked = []; pickCat = '';
  fq('#pQ').value = '';
  fq('#pTitle').textContent = mode === 'routine' ? 'NOUVELLE ROUTINE' : 'AJOUTER DES EXERCICES';
  fq('#pRNameF').hidden = mode !== 'routine'; fq('#pRName').value = '';
  renderPickCats(); updatePickBtn();
  fq('#pList').innerHTML = '<p class="note center">Chargement…</p>';
  J.openSheet(fq('#mPick'));
  loadLib().then(renderPick);
}
function renderPickCats(){
  fq('#pCats').innerHTML = ['', ...CATS].map(c => `<button data-c="${c}" class="${c === pickCat ? 'on' : ''}">${c || 'Tous'}</button>`).join('');
}
function renderPick(){
  if (!lib) return;
  const qv = norm(fq('#pQ').value.trim()), toks = qv.split(/\s+/).filter(Boolean);
  let list = lib.filter(e => (!pickCat || e.c === pickCat) && toks.every(t => e.s.includes(t)));
  // les exercices déjà faits remontent en premier
  const used = new Set(S().sessions.flatMap(s => s.ex.map(e => e.id)));
  list.sort((a, b) => (used.has(b.i) - used.has(a.i)) || ((b.pop || b.custom ? 1 : 0) - (a.pop || a.custom ? 1 : 0)) || (!!b.img - !!a.img));
  const total = list.length;
  list = list.slice(0, 80);
  fq('#pList').innerHTML = (list.map(e => `<button class="pex ${picked.includes(e.i) ? 'on' : ''}" data-ex="${e.i}">${exThumb(e)}
      <span class="pn"><b>${esc(e.n)}</b><small>${esc([(e.m || []).length ? e.m.slice(0, 2).join(', ') : e.c, (e.q || [])[0]].filter(Boolean).join(' · '))}${used.has(e.i) ? ' · <i>déjà fait</i>' : ''}</small></span><span class="pc"></span></button>`).join('')
    || '<p class="note center">Aucun exercice trouvé.</p>') + (total > 80 ? `<p class="note center">${total - 80} autres résultats : précisez la recherche.</p>` : '');
}
function updatePickBtn(){
  const b = fq('#pAdd');
  b.textContent = pickMode === 'routine' ? `CRÉER LA ROUTINE${picked.length ? ' (' + picked.length + ')' : ''}` : picked.length ? `AJOUTER ${picked.length} EXERCICE${picked.length > 1 ? 'S' : ''}` : 'SÉLECTIONNEZ DES EXERCICES';
  b.disabled = !picked.length;
}
function confirmPick(){
  const chosen = picked.map(id => exById(id)).filter(Boolean);
  if (pickMode === 'routine') {
    const name = fq('#pRName').value.trim();
    if (!name) { J.toast('Donnez un nom à la routine'); fq('#pRName').focus(); return; }
    S().routines.push({id:uid(), name, ex:chosen.map(e => ({id:e.i, name:e.n, sets:3}))});
    save(); J.closeSheet(); render(); J.toast(`Routine « ${name} » créée`); return;
  }
  const a = S().active;
  chosen.forEach(e => {
    const prev = prevFor(e.i, a.start);
    a.ex.push({uid:uid(), id:e.i, name:e.n, sets:Array.from({length:Math.max(prev.length, 3)}, () => ({kg:'', reps:'', done:false}))});
  });
  save(); J.closeSheet(); render();
  setTimeout(() => { const last = root && $$('.exc', root).pop(); if (last) last.scrollIntoView({behavior:'smooth', block:'start'}); }, 350);
}

/* ---------- petites feuilles d'actions ---------- */
function openPlates(kg){
  const p = plates(kg);
  menuCtx = null;
  fq('#mMenuT').textContent = `DISQUES · ${fmt(kg)} KG`;
  fq('#mMenuB').innerHTML = !p ? '<p class="note">Moins lourd que la barre seule (20 kg).</p>' : `
    <div class="plates"><span class="pbar">BARRE<br>20</span>${p.list.map(x => `<i class="pl p${String(x).replace('.', '_')}">${fmt(x)}</i>`).join('')}</div>
    <p class="note">De chaque côté : <b>${p.list.length ? p.list.map(fmt).join(' + ') + ' kg' : 'rien, la barre seule'}</b>${p.rest ? `<br>Il manque ${fmt(p.rest)} kg (pas de disque assez petit).` : ''}</p>`;
  J.openSheet(fq('#mMenu'));
}
let menuCtx = null;
function openMenu(title, actions, ctx){
  menuCtx = ctx;
  fq('#mMenuT').textContent = title;
  fq('#mMenuB').innerHTML = actions.map(([id, label, cls]) => `<button class="btn ${cls || 'ghost'}" data-m="${id}">${label}</button>`).join('');
  J.openSheet(fq('#mMenu'));
}

const FIXED = `
  <button class="fab" id="mStart" aria-label="Démarrer une séance">+</button>
  <div class="restbar" id="mRest" hidden>
    <div class="rb-bar"><i id="rBar"></i></div>
    <div class="rb-row"><span class="rb-l">REPOS</span><b id="rTime">1:30</b>
      <button data-r="-15">−15</button><button data-r="15">+15</button><button data-r="x" aria-label="Passer">✕</button></div>
  </div>

  <div class="sheet mus" id="mPick" role="dialog" aria-label="Exercices">
    <div class="grab"></div>
    <h2 id="pTitle">AJOUTER DES EXERCICES</h2>
    <div class="field" id="pRNameF"><input id="pRName" placeholder="Nom de la routine (ex : Push)" maxlength="30" autocomplete="off" autocorrect="off"></div>
    <div class="psearch"><input id="pQ" placeholder="Rechercher : développé, squat, curl…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></div>
    <div class="pcats hscroll" id="pCats"></div>
    <div id="pList"></div>
    <button class="btn ghost" id="pCustom">+ CRÉER UN EXERCICE</button>
    <div class="pfoot"><button class="btn primary" id="pAdd" disabled>SÉLECTIONNEZ DES EXERCICES</button></div>
  </div>

  <div class="sheet mus" id="mCustom" role="dialog" aria-label="Nouvel exercice">
    <div class="grab"></div>
    <h2>NOUVEL EXERCICE</h2>
    <div class="field"><label>NOM</label><input id="cxName" maxlength="50" autocomplete="off" placeholder="Ex : Rowing T-bar"></div>
    <div class="field"><label>GROUPE MUSCULAIRE</label><div class="pcats wrap" id="cxCat"></div></div>
    <button class="btn primary" id="cxSave">CRÉER</button>
  </div>

  <div class="sheet mus" id="mFinish" role="dialog" aria-label="Fin de séance">
    <div class="grab"></div>
    <h2>SÉANCE TERMINÉE</h2>
    <div id="mFSum"></div>
    <div class="toggle"><span>Enregistrer comme routine<small>Pour la relancer en un geste</small></span><label class="sw"><input type="checkbox" id="mFRoutine"><i></i></label></div>
    <div class="field" id="mFRoutineF"><input id="mFRoutineName" maxlength="30" autocomplete="off" placeholder="Nom de la routine"></div>
    <button class="btn primary" id="mFSave">ENREGISTRER LA SÉANCE</button>
    <button class="btn ghost" id="mFBack">CONTINUER LA SÉANCE</button>
  </div>

  <div class="sheet mus" id="mMenu" role="dialog" aria-label="Options">
    <div class="grab"></div>
    <h2 id="mMenuT"></h2>
    <div id="mMenuB"></div>
  </div>

  <div class="sheet mus" id="mSess" role="dialog" aria-label="Détail de la séance">
    <div class="grab"></div>
    <div id="mSessB"></div>
  </div>`;

function openSession(s){
  fq('#mSessB').innerHTML = `
    <h2>${esc(s.name.toUpperCase())}</h2>
    <p class="note">${new Date(s.start).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'})} · ${dur(s)} min · ${fmt(volume(s))} kg</p>
    ${s.ex.map(e => `<div class="sx"><b>${esc(e.name)}</b><div>${doneSets(e).map(x => `<span>${fmt(n(x.kg))} kg × ${n(x.reps)}</span>`).join('')}</div></div>`).join('')}
    <button class="btn primary" data-sa="redo" data-id="${s.id}">REFAIRE CETTE SÉANCE</button>
    <div class="two"><button class="btn ghost" data-sa="routine" data-id="${s.id}">EN FAIRE UNE ROUTINE</button><button class="btn danger" data-sa="del" data-id="${s.id}">SUPPRIMER</button></div>`;
  J.openSheet(fq('#mSess'));
}

/* ============================================================
   Branchements
   ============================================================ */
function bind(){
  root.addEventListener('click', e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { J.haptic(); tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const a = e.target.closest('[data-a]'), act = a && a.dataset.a;
    if (act === 'start') return startSession();
    if (act === 'newroutine') return openPicker('routine');
    if (act === 'weekgoal') return openMenu('OBJECTIF HEBDOMADAIRE', [2, 3, 4, 5, 6].map(v => ['wg' + v, `${v} séances par semaine`, v === S().weekGoal ? '' : 'ghost']), {});
    if (act === 'startr') { const r = S().routines.find(x => x.id === a.closest('[data-r]').dataset.r); if (S().active) { J.toast('Une séance est déjà en cours'); return; } return startSession(r.ex, r.name); }
    if (act === 'rmenu') { const r = S().routines.find(x => x.id === a.closest('[data-r]').dataset.r); return openMenu(r.name.toUpperCase(), [['rdel', 'SUPPRIMER LA ROUTINE', 'danger']], {r}); }
    if (act === 'coach') { const ex = activeEx(a.closest('[data-x]').dataset.x); if (isBarbell(ex.id) && +a.dataset.kg) openPlates(+a.dataset.kg); return; }
    if (act === 'finish') return finishSession();
    if (act === 'addex') return openPicker('session');
    if (act === 'cancel') {
      if (a.dataset.armed) { S().active = null; save(); stopRest(); clearInterval(tick); render(); J.toast('Séance abandonnée'); return; }
      a.dataset.armed = '1'; a.textContent = 'Toucher encore pour confirmer'; setTimeout(() => { if (a.isConnected) { delete a.dataset.armed; a.textContent = 'Abandonner la séance'; } }, 3000); return;
    }
    if (act === 'addset') { const ex = activeEx(a.closest('[data-x]').dataset.x); const last = ex.sets[ex.sets.length - 1]; ex.sets.push({kg:last ? last.kg : '', reps:last ? last.reps : '', done:false}); save(); J.haptic(); render(); return; }
    if (act === 'exmenu') { const ex = activeEx(a.closest('[data-x]').dataset.x); return openMenu(ex.name.toUpperCase(), [['lastset', 'SUPPRIMER LA DERNIÈRE SÉRIE'], ['up', 'MONTER L\'EXERCICE'], ...(isBarbell(ex.id) ? [['plates', 'CALCUL DES DISQUES']] : []), ['prog', 'VOIR LA PROGRESSION'], ['rmex', 'RETIRER L\'EXERCICE', 'danger']], {ex}); }
    if (act === 'check') {
      const row = a.closest('.set'), ex = activeEx(a.closest('[data-x]').dataset.x), s = ex.sets[+row.dataset.s];
      const kgI = row.querySelector('.kg'), rpI = row.querySelector('.rp');
      if (!s.done) {
        if (!kgI.value && kgI.placeholder !== 'kg') kgI.value = kgI.placeholder;
        if (!rpI.value && rpI.placeholder !== 'reps') rpI.value = rpI.placeholder;
        if (!rpI.value) { J.toast('Indiquez le nombre de répétitions'); rpI.focus(); return; }
        s.kg = kgI.value; s.reps = rpI.value;
      }
      s.done = !s.done; row.classList.toggle('done', s.done);
      save(); J.haptic();
      const v = q('#mVol'); if (v) v.textContent = fmt(volume(S().active)) + ' kg';
      if (s.done) {
        const prev = bestE1(ex.id, S().active.start), now = e1rm(n(s.kg), n(s.reps));
        if (prev > 0 && now > prev + .01) J.toast(`🏆 Record : ${fmt(now)} kg en 1RM estimé (${ex.name})`);
        startRest();
      }
      return;
    }
    const sc = e.target.closest('[data-sess]'); if (sc) { const s = S().sessions.find(x => x.id === sc.dataset.sess); if (s) openSession(s); return; }
    const pg = e.target.closest('[data-prog]'); if (pg) { progEx = pg.dataset.prog || null; render(); window.scrollTo(0, 0); return; }
  });
  /* saisie kg / reps : enregistrée sans redessiner (le clavier reste ouvert) */
  root.addEventListener('input', e => {
    if (e.target.id === 'mName') { S().active.name = e.target.value; save(); return; }
    const row = e.target.closest('.set'); if (!row) return;
    const ex = activeEx(e.target.closest('[data-x]').dataset.x), s = ex.sets[+row.dataset.s];
    if (e.target.classList.contains('kg')) s.kg = e.target.value; else s.reps = e.target.value;
    save();
  });
  root.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('.kg,.rp')) return;
    e.preventDefault();
    const inputs = $$('.set input', root), i = inputs.indexOf(e.target);
    if (inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
  });

  fq('#mStart').addEventListener('click', () => startSession());
  fq('#mRest').addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'x') return stopRest();
    restEnd += +b.dataset.r * 1000; restTotal = Math.max(restTotal + +b.dataset.r, 15);
    S().rest = Math.max(15, Math.min(600, S().rest + +b.dataset.r)); save();
  });

  /* sélecteur */
  fq('#pQ').addEventListener('input', renderPick);
  fq('#pCats').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; pickCat = b.dataset.c; renderPickCats(); renderPick(); });
  fq('#pList').addEventListener('click', e => {
    const b = e.target.closest('[data-ex]'); if (!b) return;
    const id = b.dataset.ex; picked = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
    b.classList.toggle('on'); J.haptic(); updatePickBtn();
  });
  fq('#pAdd').addEventListener('click', confirmPick);
  fq('#pCustom').addEventListener('click', () => {
    fq('#cxName').value = fq('#pQ').value.trim();
    fq('#cxCat').innerHTML = CATS.map((c, i) => `<button data-c="${c}" class="${i === 0 ? 'on' : ''}">${c}</button>`).join('');
    J.closeSheet(); setTimeout(() => J.openSheet(fq('#mCustom')), 320);
  });
  fq('#cxCat').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) $$('#cxCat button', fixed).forEach(x => x.classList.toggle('on', x === b)); });
  fq('#cxSave').addEventListener('click', () => {
    const name = fq('#cxName').value.trim(); if (!name) { J.toast('Nom requis'); return; }
    const c = $('#cxCat button.on', fixed).dataset.c, ex = {i:'c' + uid(), n:name, c, m:[], q:[]};
    S().custom.push(ex); save(); buildLib();
    J.closeSheet();
    setTimeout(() => { const keep = picked; openPicker(pickMode); picked = [...keep, ex.i]; updatePickBtn(); fq('#pQ').value = name; renderPick(); }, 320);
  });

  /* fin de séance */
  fq('#mFRoutine').addEventListener('change', e => { fq('#mFRoutineF').hidden = !e.target.checked; });
  fq('#mFSave').addEventListener('click', confirmFinish);
  fq('#mFBack').addEventListener('click', () => { pendingFinish = null; J.closeSheet(); });

  /* menus */
  fq('#mMenuB').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m, c = menuCtx || {};
    J.closeSheet();
    if (m.startsWith('wg')) { S().weekGoal = +m.slice(2); save(); render(); return; }
    if (m === 'rdel') { const snap = JSON.stringify(S().routines); S().routines = S().routines.filter(r => r !== c.r); save(); render(); J.toast('Routine supprimée', {action:'ANNULER', onAction:() => { S().routines = JSON.parse(snap); save(); render(); }}); return; }
    const a = S().active; if (!a || !c.ex) return;
    if (m === 'lastset') { if (c.ex.sets.length > 1) c.ex.sets.pop(); }
    if (m === 'up') { const i = a.ex.indexOf(c.ex); if (i > 0) { a.ex.splice(i, 1); a.ex.splice(i - 1, 0, c.ex); } }
    if (m === 'rmex') a.ex = a.ex.filter(x => x !== c.ex);
    if (m === 'prog') { progEx = c.ex.id; tab = 'prog'; }
    if (m === 'plates') { const done = c.ex.sets.filter(x => n(x.kg)), kg = done.length ? n(done[done.length - 1].kg) : (coach(c.ex.id, c.ex.name, a.start) || {}).kg; setTimeout(() => openPlates(kg || 20), 320); return; }
    save(); render();
  });

  /* détail de séance */
  fq('#mSessB').addEventListener('click', e => {
    const b = e.target.closest('[data-sa]'); if (!b) return;
    const s = S().sessions.find(x => x.id === b.dataset.id); J.closeSheet();
    if (b.dataset.sa === 'redo') { if (S().active) { J.toast('Une séance est déjà en cours'); return; } startSession(s.ex.map(x => ({id:x.id, name:x.name, sets:x.sets.length})), s.name); }
    if (b.dataset.sa === 'routine') { S().routines.push({id:uid(), name:s.name, ex:s.ex.map(x => ({id:x.id, name:x.name, sets:x.sets.length}))}); save(); tab = 'seance'; render(); J.toast(`Routine « ${s.name} » créée`); }
    if (b.dataset.sa === 'del') { const snap = JSON.stringify(S().sessions); S().sessions = S().sessions.filter(x => x !== s); save(); render(); J.toast('Séance supprimée', {action:'ANNULER', onAction:() => { S().sessions = JSON.parse(snap); save(); render(); }}); }
  });
}

/* ---------- déclaration du module ---------- */
J.module({
  id: 'muscu',
  code: '04',
  order: 18,
  name: 'Musculation',
  short: 'Muscu',
  tagline: 'Séances, charges et progression',
  accent: '#ffb347',
  cls: 'mus',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',

  init(){
    st = J.store('muscu', DEFAULTS);
    st.onChange(() => { if (lib) buildLib(); if (!S().active || !root || !root.querySelector('.set input:focus')) render(); });
    loadLib();
  },
  summary(){ const last = [...S().sessions].sort((a, b) => b.start - a.start)[0]; return last ? `Dernière : ${esc(last.name)}` : 'Aucune séance'; },
  widget(){ return {week:thisWeek().length, weekGoal:S().weekGoal}; },
  /* observations : groupe musculaire délaissé, stagnation, objectif de la semaine en danger, records */
  insights(){
    const out = [], now = Date.now(), D = 864e5, last = {};
    S().sessions.forEach(s => s.ex.forEach(e => { const c = (exById(e.id) || {}).c; if (c && (!last[c] || s.start > last[c])) last[c] = s.start; }));
    ['Jambes', 'Dos', 'Pectoraux', 'Épaules'].forEach(c => {
      const days = last[c] ? Math.floor((now - last[c]) / D) : null;
      if (days !== null && days >= 8 && days <= 60) out.push({level:'info', score:48 + Math.min(14, days - 8), text:`${c} : pas travaillé${c === 'Jambes' || c === 'Épaules' ? 'es' : 's'} depuis ${days} jours.`, go:'muscu'});
    });
    const st = coachAll().filter(x => x.c.stalled);
    if (st.length) out.push({level:'info', score:46, text:`${st.map(x => x.name).slice(0, 2).join(' et ')} ${st.length > 1 ? 'stagnent' : 'stagne'} : le coach propose d'alléger de 10 % pour repartir.`, go:'muscu'});
    const dow = (new Date().getDay() + 6) % 7, left = 7 - dow, need = S().weekGoal - thisWeek().length;
    if (S().sessions.length && dow >= 3 && need > 0) out.push({level:need > left ? 'info' : 'warn', score:need >= left ? 66 : 50, text:need > left ? `Objectif de ${S().weekGoal} séances hors de portée cette semaine (${thisWeek().length} faites).` : `Encore ${need} séance${need > 1 ? 's' : ''} à caser d'ici dimanche pour tenir l'objectif.`, go:'muscu'});
    const prs = thisWeek().reduce((a, s) => a + (s.prs || 0), 0);
    if (prs) out.push({level:'good', score:40, text:`${prs} record${prs > 1 ? 's' : ''} battu${prs > 1 ? 's' : ''} cette semaine. Remarquable.`, go:'muscu'});
    return out;
  },
  stat(){
    const a = S().active, w = thisWeek().length;
    if (a) return {label:'MUSCU', value:'En cours', sub:`${a.name} · ${dur(a)} min`, ratio:w / S().weekGoal};
    const last = [...S().sessions].sort((x, y) => y.start - x.start)[0];
    return {label:'MUSCU', value:last ? ago(last.start).replace(/^./, c => c.toUpperCase()) : '<small>Démarrer</small>', sub:`${w} / ${S().weekGoal} séances cette semaine`, ratio:w / S().weekGoal};
  },
  brief(){ return S().active ? 'Une séance de musculation est en cours.' : ''; },
  report(){ return status(); },
  chat(){ const ses = [...S().sessions].sort((a, b) => b.start - a.start).slice(0, 4); return `MUSCULATION : ${thisWeek().length}/${S().weekGoal} séances cette semaine. ${S().active ? 'Séance en cours : ' + S().active.name + '. ' : ''}Dernières séances : ${ses.map(x => `${x.name} ${ago(x.start)} (${x.ex.map(e => e.name).join(', ')})`).join(' ; ') || 'aucune'}. Routines : ${S().routines.map(r => r.name).join(', ') || 'aucune'}.${(() => { const nr = nextRoutine(), st = coachAll().filter(x => x.c.stalled).map(x => x.name); return (nr ? ` Routine conseillée aujourd'hui : ${nr.r.name}.` : '') + (st.length ? ` En stagnation : ${st.join(', ')}.` : ''); })()}`; },
  briefingSpeech(){
    const last = [...S().sessions].sort((x, y) => y.start - x.start)[0];
    if (!last) return '';
    const w = thisWeek().length;
    return `Dernière séance de musculation ${ago(last.start)}, ${w} cette semaine sur ${S().weekGoal}.`;
  },

  mount(body, fx){
    root = body; fixed = fx;
    root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED;
    tab = 'seance'; progEx = null;
    bind(); render();
    if (S().active) startTick();
    J.say(status());
    loadLib();
  },
  onShow(){ render(); if (S().active) startTick(); J.say(status()); },
  unmount(){ clearInterval(tick); stopRest(); root = null; fixed = null; },
});
})();
