/* ============================================================
   Module 06 — Habitudes
   Habitudes quotidiennes ou hebdomadaires, avec objectif chiffré
   (ex. 8 verres d'eau), séries, calendrier, statistiques.
   Certaines se valident toutes seules grâce aux autres modules :
   pas (Apple Santé), séance de muscu, repas saisis, tâches du jour.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, uid} = J;

const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const parseDk = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (k, n) => { const d = parseDk(k); d.setDate(d.getDate() + n); return dk(d); };
const today = () => dk(new Date());
const wdOf = k => (parseDk(k).getDay() + 6) % 7;            // 0 = lundi
const WDS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/* icônes (emoji : lisibles, sans ressources externes) */
const ICONS = ['💧', '📖', '🧘', '🚶', '🏋️', '🥗', '😴', '🦷', '💊', '🚭', '☕', '📵', '✍️', '🎸', '🌿', '🧠', '🙏', '💰', '🧹', '❄️'];
const COLORS = ['#3fe0ff', '#4dffc3', '#ffb347', '#ff5f8f', '#b98cff', '#ffe066', '#5c9dff'];
/* modèles prêts à l'emploi ; auto = validation automatique depuis un autre module */
const PRESETS = [
  {name:'Boire de l\'eau', icon:'💧', target:8, unit:'verres', color:'#3fe0ff'},
  {name:'Marcher', icon:'🚶', target:1, unit:'', color:'#4dffc3', auto:'steps', autoLabel:'objectif de pas atteint (Apple Santé)'},
  {name:'Séance de sport', icon:'🏋️', target:1, unit:'', color:'#ffb347', auto:'muscu', autoLabel:'séance terminée dans Musculation', days:[0, 2, 4]},
  {name:'Noter mes repas', icon:'🥗', target:1, unit:'', color:'#4dffc3', auto:'meals', autoLabel:'3 repas saisis dans Nutrition'},
  {name:'Lire', icon:'📖', target:20, unit:'min', color:'#b98cff'},
  {name:'Méditer', icon:'🧘', target:10, unit:'min', color:'#5c9dff'},
  {name:'Toutes mes tâches', icon:'✅', target:1, unit:'', color:'#b98cff', auto:'tasks', autoLabel:'tâches du jour toutes faites'},
  {name:'Coucher avant 23 h', icon:'😴', target:1, unit:'', color:'#5c9dff'},
  {name:'Pas de sucre', icon:'🚭', target:1, unit:'', color:'#ff5f8f'},
  {name:'Vitamines', icon:'💊', target:1, unit:'', color:'#ffe066'},
];

/* ---------- état ---------- */
let st = null, root = null, fixed = null, tab = 'today', detail = null;
const S = () => st.data;
const save = () => st.save();
const DEFAULTS = {habits:[], log:{}};
const habits = () => S().habits.filter(h => !h.archived);
const scheduled = (h, k) => !h.days || !h.days.length || h.days.includes(wdOf(k));
const manual = (h, k) => ((S().log[k] || {})[h.id] || 0);

/* validation automatique depuis les autres modules */
function autoValue(h, k){
  try {
    if (h.auto === 'steps') {
      const d = (J.appleDoc().days || {})[k], goal = (J.store('sante', {stepGoal:8000}).data.stepGoal) || 8000;
      return d && d.steps >= goal ? 1 : 0;
    }
    if (h.auto === 'muscu') return J.store('muscu', {sessions:[]}).data.sessions.some(s => dk(new Date(s.start)) === k) ? 1 : 0;
    if (h.auto === 'meals') { const d = J.store('nutrition', {days:{}}).data.days[k]; return d && new Set((d.items || []).map(i => i.meal)).size >= 3 ? 1 : 0; }
    if (h.auto === 'tasks') {
      const tasks = J.store('taches', {tasks:[]}).data.tasks.filter(t => t.due === k);
      return tasks.length && tasks.every(t => t.done) ? 1 : 0;
    }
  } catch(e) {}
  return 0;
}
const value = (h, k) => Math.max(manual(h, k), h.auto ? autoValue(h, k) * h.target : 0);
const isDone = (h, k) => value(h, k) >= h.target;
function streak(h){
  let n = 0, k = today();
  if (!isDone(h, k)) k = addDays(k, -1);                      // la journée en cours ne casse pas la série
  for (let i = 0; i < 1000; i++, k = addDays(k, -1)) {
    if (!scheduled(h, k)) continue;
    if (isDone(h, k)) n++; else break;
    if (k < dk(new Date(h.created))) break;
  }
  return n;
}
function bestStreak(h){
  let best = 0, cur = 0, k = dk(new Date(h.created));
  for (let i = 0; i < 1000 && k <= today(); i++, k = addDays(k, 1)) {
    if (!scheduled(h, k)) continue;
    if (isDone(h, k)) { cur++; best = Math.max(best, cur); } else if (k < today()) cur = 0;
  }
  return best;
}
function rate(h, days = 30){
  let s = 0, d = 0, k = today();
  for (let i = 0; i < days; i++, k = addDays(k, -1)) { if (k < dk(new Date(h.created))) break; if (!scheduled(h, k)) continue; d++; if (isDone(h, k)) s++; }
  return d ? s / d : 0;
}
function setValue(h, k, v){
  S().log[k] = S().log[k] || {};
  if (v <= 0) delete S().log[k][h.id]; else S().log[k][h.id] = v;
  // ménage : on garde 400 jours d'historique
  const keys = Object.keys(S().log).sort(); if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(x => delete S().log[x]);
  save();
}

/* ============================================================
   Interface
   ============================================================ */
const q = s => $(s, root);
const fq = s => $(s, fixed);
const TEMPLATE = `
  <div class="utabs" id="hTabs"><button data-tab="today">AUJOURD'HUI</button><button data-tab="stats">STATISTIQUES</button></div>
  <div id="hTab"></div>`;

function ring(ratio, color, inner){
  const r = 23, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, ratio));
  return `<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" fill="none" stroke="color-mix(in srgb, ${color} 18%, transparent)" stroke-width="5"/>
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${v * C} ${C}" transform="rotate(-90 28 28)" style="filter:drop-shadow(0 0 4px ${color});transition:stroke-dasharray .35s"/></svg><span class="hi">${inner}</span>`;
}
function weekDots(h){
  const k0 = today(), mon = addDays(k0, -wdOf(k0));
  return `<div class="wdots">${WDS.map((w, i) => { const k = addDays(mon, i), sch = scheduled(h, k), done = isDone(h, k), fut = k > k0;
    return `<span class="${!sch ? 'off' : done ? 'on' : fut ? 'fut' : k === k0 ? 'now' : 'miss'}" style="--hc:${h.color}">${w}</span>`; }).join('')}</div>`;
}
function habitCard(h){
  const k = today(), v = value(h, k), done = v >= h.target, sch = scheduled(h, k), s = streak(h);
  const inner = done ? '✓' : h.target > 1 ? `<b>${v}</b><small>/${h.target}</small>` : h.icon;
  return `<div class="hcard ${done ? 'done' : ''} ${sch ? '' : 'rest'}" data-h="${h.id}" style="--hc:${h.color}">
    <button class="hring" data-a="tap" aria-label="Valider">${ring(v / h.target, h.color, inner)}</button>
    <div class="hinfo" data-a="open"><div class="hn">${h.target > 1 || done ? h.icon + ' ' : ''}${esc(h.name)}</div>
      <div class="hm">${!sch ? 'Repos aujourd\'hui' : h.auto ? (done ? 'Validée automatiquement' : esc(h.autoLabel || 'automatique')) : h.target > 1 ? `${v} / ${h.target} ${esc(h.unit)}` : done ? 'Fait' : 'À faire'}${s ? ` · <span class="fl">🔥 ${s}</span>` : ''}</div>
      ${weekDots(h)}</div>
    ${h.target > 1 && !h.auto ? `<button class="hminus" data-a="minus" aria-label="Retirer">−</button>` : ''}
  </div>`;
}
function renderToday(){
  const hs = habits(), k = today();
  const due = hs.filter(h => scheduled(h, k)), done = due.filter(h => isDone(h, k));
  if (!hs.length) {
    q('#hTab').innerHTML = `<div class="hempty"><p>Construisez de bonnes habitudes, une journée à la fois.</p>
      <div class="presets">${PRESETS.slice(0, 8).map((p, i) => `<button data-preset="${i}" style="--hc:${p.color}"><span>${p.icon}</span>${esc(p.name)}${p.auto ? '<i>auto</i>' : ''}</button>`).join('')}</div>
      <button class="btn primary" data-a="new">CRÉER UNE HABITUDE</button></div>`;
    return;
  }
  const ratio = due.length ? done.length / due.length : 0;
  q('#hTab').innerHTML = `
    <div class="hhero"><div class="hbig">${ring(ratio, '#ffe066', `<b>${done.length}</b><small>/${due.length}</small>`)}</div>
      <div><b>${ratio === 1 ? 'Journée parfaite' : done.length ? 'Continuez comme ça' : 'C\'est parti'}</b><small>${done.length} habitude${done.length > 1 ? 's' : ''} sur ${due.length} aujourd'hui</small></div></div>
    <div class="hlist">${[...due.filter(h => !isDone(h, k)), ...due.filter(h => isDone(h, k)), ...hs.filter(h => !scheduled(h, k))].map(habitCard).join('')}</div>
    <p class="hint">Touchez l'anneau pour valider · touchez le nom pour le détail</p>`;
}
function heatmap(h, weeks = 15){
  const k0 = today(), start = addDays(k0, -wdOf(k0) - (weeks - 1) * 7);
  let cells = '';
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
    const k = addDays(start, w * 7 + d), fut = k > k0, before = k < dk(new Date(h.created));
    const r = fut || before || !scheduled(h, k) ? -1 : Math.min(1, value(h, k) / h.target);
    cells += `<i style="grid-column:${w + 1};grid-row:${d + 1};${r >= 0 ? `background:color-mix(in srgb, ${h.color} ${Math.round(12 + r * 88)}%, #0a1a26)` : ''}" class="${r < 0 ? 'x' : ''} ${k === k0 ? 'today' : ''}"></i>`;
  }
  return `<div class="heat" style="grid-template-columns:repeat(${weeks}, 1fr)">${cells}</div>`;
}
function renderStats(){
  const hs = habits();
  if (!hs.length) { q('#hTab').innerHTML = '<div class="empty" style="margin-top:30px">Créez une habitude pour voir vos statistiques.</div>'; return; }
  const global = hs.reduce((a, h) => a + rate(h), 0) / hs.length;
  q('#hTab').innerHTML = `
    <div class="kpis3"><div><small>RÉUSSITE 30 J</small><b>${Math.round(global * 100)} %</b></div><div><small>MEILLEURE SÉRIE</small><b>${Math.max(...hs.map(bestStreak))} j</b></div><div><small>HABITUDES</small><b>${hs.length}</b></div></div>
    ${hs.map(h => `<button class="hstat" data-h="${h.id}" data-a="open" style="--hc:${h.color}">
      <div class="hs-top"><span>${h.icon} ${esc(h.name)}</span><b>${Math.round(rate(h) * 100)} %</b></div>
      ${heatmap(h)}
      <div class="hs-bot"><span>🔥 série ${streak(h)} j</span><span>record ${bestStreak(h)} j</span></div></button>`).join('')}`;
}
function render(){
  if (!root) return;
  $$('#hTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  (tab === 'today' ? renderToday : renderStats)();
}
function status(){
  const hs = habits(), k = today(), due = hs.filter(h => scheduled(h, k)), done = due.filter(h => isDone(h, k));
  if (!hs.length) return 'Choisissez une première habitude à suivre.';
  if (done.length === due.length && due.length) return 'Toutes vos habitudes du jour sont validées. Impeccable.';
  const best = hs.map(h => [h, streak(h)]).sort((a, b) => b[1] - a[1])[0];
  return `${done.length} habitude${done.length > 1 ? 's' : ''} sur ${due.length} validée${done.length > 1 ? 's' : ''}.` + (best && best[1] >= 3 ? ` Série en cours : ${best[1]} jours pour « ${best[0].name} ».` : '');
}

/* ---------- feuilles ---------- */
const FIXED = `
  <button class="fab" id="hAdd" aria-label="Nouvelle habitude">+</button>
  <div class="sheet hab" id="hEdit" role="dialog" aria-label="Habitude">
    <div class="grab"></div>
    <h2 id="heTitle">NOUVELLE HABITUDE</h2>
    <div class="presets small" id="hePresets"></div>
    <div class="field"><label>NOM</label><input id="heName" maxlength="40" placeholder="Ex : Boire de l'eau"></div>
    <div class="field"><label>ICÔNE</label><div class="icons" id="heIcons"></div></div>
    <div class="two">
      <div class="field"><label>OBJECTIF PAR JOUR</label><input id="heTarget" inputmode="numeric" placeholder="1"></div>
      <div class="field"><label>UNITÉ</label><input id="heUnit" maxlength="12" placeholder="verres, min…"></div>
    </div>
    <div class="field"><label>JOURS</label><div class="days" id="heDays">${WDS.map((w, i) => `<button data-d="${i}">${w}</button>`).join('')}</div><p class="note" id="heDaysNote">Tous les jours</p></div>
    <div class="field"><label>COULEUR</label><div class="colors" id="heColors"></div></div>
    <div class="field"><label>RAPPEL (NOTIFICATION)</label><input id="heRemind" type="time"></div>
    <p class="note" id="heAuto" hidden></p>
    <button class="btn primary" id="heSave">ENREGISTRER</button>
    <button class="btn danger" id="heDel">SUPPRIMER</button>
  </div>
  <div class="sheet hab" id="hDet" role="dialog" aria-label="Détail"><div class="grab"></div><div id="hDetB"></div></div>`;

let hEditing = null, hIcon = ICONS[0], hColor = COLORS[0], hDays = [], hAuto = null, hAutoLabel = '';
function openEdit(h, preset){
  hEditing = h || null;
  const d = h || preset || {name:'', icon:ICONS[0], target:1, unit:'', color:COLORS[habits().length % COLORS.length]};
  fq('#heTitle').textContent = h ? 'MODIFIER L\'HABITUDE' : 'NOUVELLE HABITUDE';
  fq('#hePresets').hidden = !!h;
  fq('#hePresets').innerHTML = PRESETS.map((p, i) => `<button data-preset="${i}" style="--hc:${p.color}"><span>${p.icon}</span>${esc(p.name)}</button>`).join('');
  fq('#heName').value = d.name; fq('#heTarget').value = d.target > 1 ? d.target : ''; fq('#heUnit').value = d.unit || '';
  hIcon = d.icon; hColor = d.color; hDays = [...(d.days || [])]; hAuto = d.auto || null; hAutoLabel = d.autoLabel || '';
  fq('#heRemind').value = d.remind || '';
  paintEdit();
  fq('#heDel').hidden = !h;
  J.openSheet(fq('#hEdit'));
}
function paintEdit(){
  fq('#heIcons').innerHTML = ICONS.map(i => `<button data-i="${i}" class="${i === hIcon ? 'on' : ''}">${i}</button>`).join('');
  fq('#heColors').innerHTML = COLORS.map(c => `<button data-c="${c}" class="${c === hColor ? 'on' : ''}" style="--cc:${c}"></button>`).join('');
  $$('#heDays button', fixed).forEach(b => b.classList.toggle('on', !hDays.length || hDays.includes(+b.dataset.d)));
  fq('#heDaysNote').textContent = !hDays.length || hDays.length === 7 ? 'Tous les jours' : hDays.length + ' jour' + (hDays.length > 1 ? 's' : '') + ' par semaine';
  fq('#heAuto').hidden = !hAuto; fq('#heAuto').textContent = hAuto ? '⚡ Validation automatique : ' + hAutoLabel + '.' : '';
}
function openDetail(h){
  detail = h;
  const k = today(), last = [];
  for (let i = 6; i >= 0; i--) last.push(addDays(k, -i));           // du plus ancien à aujourd'hui
  fq('#hDetB').innerHTML = `
    <div class="hd-top" style="--hc:${h.color}"><span class="hd-ic">${h.icon}</span><div><h2 style="margin:0">${esc(h.name.toUpperCase())}</h2><p class="note">${h.target > 1 ? `Objectif ${h.target} ${esc(h.unit)} / jour` : 'Objectif quotidien'}${h.days && h.days.length && h.days.length < 7 ? ' · ' + h.days.map(d => WDS[d]).join(' ') : ''}</p></div></div>
    <div class="kpis3"><div><small>SÉRIE</small><b>🔥 ${streak(h)}</b></div><div><small>RECORD</small><b>${bestStreak(h)} j</b></div><div><small>30 JOURS</small><b>${Math.round(rate(h) * 100)} %</b></div></div>
    ${heatmap(h, 15)}
    <div class="slabel"><span>7 DERNIERS JOURS</span><span>touchez pour corriger</span></div>
    <div class="hdays">${last.map(d => { const v = value(h, d), done = v >= h.target;
      return `<button data-fix="${d}" class="${done ? 'on' : ''} ${scheduled(h, d) ? '' : 'off'}" style="--hc:${h.color}"><small>${parseDk(d).toLocaleDateString('fr-FR', {weekday:'short'}).slice(0, 3)}</small><b>${done ? '✓' : h.target > 1 ? v : '·'}</b></button>`; }).join('')}</div>
    <button class="btn" data-a="edit">MODIFIER</button>`;
  J.openSheet(fq('#hDet'));
}

/* ---------- branchements ---------- */
function bind(){
  root.addEventListener('click', e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { J.haptic(); tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const pr = e.target.closest('[data-preset]'); if (pr) { openEdit(null, PRESETS[+pr.dataset.preset]); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'new') return openEdit();
    const card = a.closest('[data-h]'), h = card && S().habits.find(x => x.id === card.dataset.h); if (!h) return;
    const k = today();
    if (a.dataset.a === 'tap') {
      if (!scheduled(h, k)) { J.toast('Jour de repos pour cette habitude'); return; }
      if (h.auto && !manual(h, k) && autoValue(h, k)) { J.toast('Déjà validée automatiquement'); return; }
      const v = manual(h, k), next = h.target > 1 ? (v >= h.target ? 0 : v + 1) : (v ? 0 : 1);
      setValue(h, k, next); J.haptic(); render();
      if (next >= h.target && v < h.target) { const s = streak(h); J.toast(`${h.icon} ${h.name} : validée${s > 1 ? ` · série de ${s} jours 🔥` : ''}`); if ([7, 30, 100].includes(s)) J.say(`Série de ${s} jours pour ${h.name}. Remarquable.`); }
    }
    if (a.dataset.a === 'minus') { setValue(h, k, Math.max(0, manual(h, k) - 1)); J.haptic(); render(); }
    if (a.dataset.a === 'open') openDetail(h);
  });

  fq('#hAdd').addEventListener('click', () => { J.haptic(); openEdit(); });
  fq('#hePresets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]'); if (!b) return; const p = PRESETS[+b.dataset.preset];
    fq('#heName').value = p.name; fq('#heTarget').value = p.target > 1 ? p.target : ''; fq('#heUnit').value = p.unit;
    hIcon = p.icon; hColor = p.color; hDays = [...(p.days || [])]; hAuto = p.auto || null; hAutoLabel = p.autoLabel || ''; paintEdit(); J.haptic();
  });
  fq('#heName').addEventListener('input', () => { if (hAuto) { hAuto = null; paintEdit(); } });
  fq('#heIcons').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { hIcon = b.dataset.i; paintEdit(); } });
  fq('#heColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { hColor = b.dataset.c; paintEdit(); } });
  fq('#heDays').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return; const d = +b.dataset.d;
    if (!hDays.length) hDays = [0, 1, 2, 3, 4, 5, 6];
    hDays = hDays.includes(d) ? hDays.filter(x => x !== d) : [...hDays, d].sort();
    if (!hDays.length || hDays.length === 7) hDays = [];
    paintEdit();
  });
  fq('#heSave').addEventListener('click', () => {
    const name = fq('#heName').value.trim(); if (!name) { J.toast('Donnez un nom à l\'habitude'); return; }
    const data = {name, icon:hIcon, color:hColor, target:Math.max(1, parseInt(fq('#heTarget').value) || 1), unit:fq('#heUnit').value.trim(), days:hDays, remind:fq('#heRemind').value || null, auto:hAuto, autoLabel:hAutoLabel};
    if (hEditing) Object.assign(hEditing, data); else S().habits.push(Object.assign({id:uid(), created:Date.now()}, data));
    save(); J.closeSheet(); render(); J.haptic();
  });
  fq('#heDel').addEventListener('click', () => {
    const snap = JSON.stringify(S().habits), h = hEditing;
    S().habits = S().habits.filter(x => x !== h); save(); J.closeSheet(); render();
    J.toast('Habitude supprimée', {action:'ANNULER', onAction:() => { S().habits = JSON.parse(snap); save(); render(); }});
  });
  fq('#hDetB').addEventListener('click', e => {
    const f = e.target.closest('[data-fix]');
    if (f && detail) { const h = detail, d = f.dataset.fix, v = manual(h, d); setValue(h, d, v >= h.target ? 0 : h.target); J.haptic(); render(); openDetail(h); return; }
    if (e.target.closest('[data-a="edit"]')) { const h = detail; J.closeSheet(); setTimeout(() => openEdit(h), 320); }
  });
}

/* ---------- Jarvis qui discute ---------- */
const nrm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
J.actions = J.actions || {};
J.actions.log_habit = a => {
  const words = nrm(a.name).split(/\s+/).filter(w => w.length > 2);
  const h = habits().map(h => [h, words.filter(w => nrm(h.name).includes(w)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1])[0];
  if (!h) throw Object.assign(new Error('habitude introuvable'), {ask:`Je ne trouve pas d'habitude « ${a.name} ». Voulez-vous que je la crée dans le module Habitudes ?`});
  const hb = h[0], k = today(), add = Math.max(1, +a.amount || (hb.target > 1 ? 1 : hb.target));
  setValue(hb, k, Math.min(hb.target * 3, manual(hb, k) + add)); render();
  return {text:`${hb.icon} ${hb.name} : ${value(hb, k)}/${hb.target}${isDone(hb, k) ? ' ✓' : ''}`, go:'habitudes'};
};

/* ---------- déclaration ---------- */
J.module({
  id: 'habitudes',
  code: '06',
  order: 14,
  name: 'Habitudes',
  short: 'Habitudes',
  tagline: 'Séries, routines et constance',
  accent: '#ffe066',
  cls: 'hab',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.5.6-2.6 1.4-3.4.2 1.4 1 2.4 2 2.4-.8-2.6-.4-5 .6-7z"/><path d="M6 21h12"/></svg>',

  init(){ st = J.store('habitudes', DEFAULTS); st.onChange(() => render()); ['apple', 'muscu', 'nutrition', 'taches'].forEach(m => J.store(m, {}).onChange(() => render())); },
  summary(){ const k = today(), due = habits().filter(h => scheduled(h, k)); return due.length ? `<b>${due.filter(h => isDone(h, k)).length}/${due.length}</b> habitudes` : 'Aucune habitude'; },
  stat(){
    const hs = habits(); if (!hs.length) return null;
    const k = today(), due = hs.filter(h => scheduled(h, k)), done = due.filter(h => isDone(h, k)), best = Math.max(0, ...hs.map(streak));
    return {label:'HABITUDES', value:`${done.length}<small> / ${due.length}</small>`, sub:best ? `🔥 meilleure série : ${best} j` : 'aujourd\'hui', ratio:due.length ? done.length / due.length : null};
  },
  brief(){ return ''; },
  report(){ return status(); },
  chat(){ const k = today(); return `HABITUDES aujourd'hui : ${habits().map(h => `${h.name} ${scheduled(h, k) ? value(h, k) + '/' + h.target + (isDone(h, k) ? ' (fait)' : '') : '(repos)'}${streak(h) > 1 ? ', série ' + streak(h) + ' j' : ''}`).join(' ; ') || 'aucune habitude'}.`; },
  /* observations : série en jeu ce soir */
  insights(){
    const out = [], k = today();
    if (new Date().getHours() < 17) return out;
    habits().filter(h => scheduled(h, k) && !isDone(h, k) && streak(h) >= 3).sort((a, b) => streak(b) - streak(a)).slice(0, 2)
      .forEach(h => out.push({level:'warn', score:68 + Math.min(12, streak(h)), text:`Série de ${streak(h)} jours en jeu ce soir : ${h.name}.`, go:'habitudes'}));
    return out;
  },
  briefingSpeech(){
    const hs = habits(), k = today(), left = hs.filter(h => scheduled(h, k) && !isDone(h, k));
    return left.length ? `${left.length} habitude${left.length > 1 ? 's' : ''} à valider aujourd'hui.` : '';
  },
  /* pour les notifications : rappels du jour */
  reminders(){
    const out = [];
    for (let i = 0; i < 3; i++) {
      const k = addDays(today(), i);
      habits().forEach(h => { if (h.remind && scheduled(h, k)) out.push({id:'hab-' + h.id + '-' + k, kind:'habits', date:k, time:h.remind, title:`${h.icon} ${h.name}`, body:h.target > 1 ? `Objectif : ${h.target} ${h.unit}` : 'C\'est le moment !', url:'#/habitudes', skipIf:() => isDone(h, k)}); });
    }
    return out;
  },

  mount(body, fx){ root = body; fixed = fx; root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED; bind(); render(); J.say(status()); },
  onShow(){ render(); J.say(status()); },
  unmount(){ root = null; fixed = null; },
});
})();
