/* ============================================================
   Module 05 — Tâches
   Saisie rapide en langage naturel (« demain 18h appeler le garage !! #travail »),
   dictée vocale, vues Aujourd'hui / À venir / Listes, priorités, sous-tâches,
   répétitions, gestes iOS, intégration au tableau de bord et au briefing.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, uid} = J;

/* ---------- dates ---------- */
const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const parseDk = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (k, n) => { const d = parseDk(k); d.setDate(d.getDate() + n); return dk(d); };
const today = () => dk(new Date());
const daysBetween = (a, b) => Math.round((parseDk(b) - parseDk(a)) / 864e5);
const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dueLabel(k){
  if (!k) return '';
  const n = daysBetween(today(), k);
  if (n === 0) return "Aujourd'hui"; if (n === 1) return 'Demain'; if (n === -1) return 'Hier';
  if (n > 1 && n < 7) return WD[parseDk(k).getDay()].replace(/^./, c => c.toUpperCase());
  if (n < 0) return `il y a ${-n} j`;
  return parseDk(k).toLocaleDateString('fr-FR', {day:'numeric', month:'short'});
}

const PRIO = [{n:'Aucune', c:'transparent'}, {n:'Basse', c:'#3fe0ff'}, {n:'Moyenne', c:'#ffb347'}, {n:'Haute', c:'#ff4d3d'}];
const REPEAT = {daily:'Chaque jour', weekdays:'Jours ouvrés', weekly:'Chaque semaine', monthly:'Chaque mois', yearly:'Chaque année'};
const LIST_COLORS = ['#3fe0ff', '#ffb347', '#4dffc3', '#ff5f8f', '#b98cff', '#ffe066', '#5c9dff'];
const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const ICON_REP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>';
const ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/></svg>';

/* ---------- état ---------- */
let st = null, root = null, fixed = null, tab = 'today', openList = null, showDone = false;
const S = () => st.data;
const save = () => st.save();
const DEFAULTS = {tasks:[], lists:[{id:'perso', name:'Perso', color:'#3fe0ff'}, {id:'travail', name:'Travail', color:'#ffb347'}, {id:'courses', name:'Courses', color:'#4dffc3'}]};
const listOf = id => S().lists.find(l => l.id === id) || S().lists[0];
const active = () => S().tasks.filter(t => !t.done);
const overdue = () => active().filter(t => t.due && t.due < today());
const dueToday = () => active().filter(t => t.due === today());
const doneToday = () => S().tasks.filter(t => t.done && t.doneAt && dk(new Date(t.doneAt)) === today());
function sortTasks(a, b){
  return (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || (b.prio || 0) - (a.prio || 0) || a.created - b.created;
}

/* ============================================================
   Saisie en langage naturel
   « demain 18h appeler le garage !! #travail », « tous les lundis sport »,
   « dans 3 jours payer le loyer », « le 15 rdv dentiste à 9h30 »
   ============================================================ */
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function nextWeekday(wd, strictlyAfter = true){
  const d = new Date(); let n = (wd - d.getDay() + 7) % 7; if (n === 0 && strictlyAfter) n = 7;
  d.setDate(d.getDate() + n); return dk(d);
}
/* rappel avant une tâche : null = réglage par défaut, 0 = à l'heure, -1 = aucun, sinon minutes avant */
const LEADS = [[0, 'À l\'heure'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [1440, 'La veille'], [-1, 'Aucun']];
const leadName = m => m === 0 ? 'à l\'heure' : m === -1 ? 'aucun rappel' : m === 1440 ? 'la veille' : m >= 60 ? (m / 60) + ' h avant' : m + ' min avant';
const defaultLead = () => { const n = (J.prefs() || {}).notif || {}; return typeof n.taskLead === 'number' ? n.taskLead : 15; };
const leadOf = t => typeof t.lead === 'number' ? t.lead : defaultLead();
function parseQuick(input){
  let t = ' ' + input.trim() + ' ';
  const out = {title:'', due:null, time:null, prio:0, list:null, repeat:null, tags:[], lead:null};
  const cut = re => { const m = t.match(re); if (m) t = t.replace(m[0], ' '); return m; };
  let m;
  if ((m = cut(/\s(!{1,3})(?=\s)/))) out.prio = m[1].length;
  if ((m = cut(/\s#([\wÀ-ÿ'-]+)/i))) {
    const name = norm(m[1]), l = S().lists.find(x => norm(x.name) === name || norm(x.name).startsWith(name));
    out.list = l ? l.id : null; if (!l) out.newList = m[1];
  }
  // répétitions
  if ((m = cut(/\s(tous les jours|chaque jour|quotidiennement)(?=\s)/i))) out.repeat = 'daily';
  else if ((m = cut(/\s(en semaine|jours ouvr[ée]s|du lundi au vendredi)(?=\s)/i))) out.repeat = 'weekdays';
  else if ((m = cut(/\s(?:tous les|chaque)\s(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?(?=\s)/i))) { out.repeat = 'weekly'; out.due = nextWeekday(WD.indexOf(m[1].toLowerCase()), false); }
  else if ((m = cut(/\s(toutes les semaines|chaque semaine|hebdo(?:madaire)?)(?=\s)/i))) out.repeat = 'weekly';
  else if ((m = cut(/\s(tous les mois|chaque mois|mensuel(?:lement)?)(?=\s)/i))) out.repeat = 'monthly';
  else if ((m = cut(/\s(tous les ans|chaque ann[ée]e)(?=\s)/i))) out.repeat = 'yearly';
  // rappel : « rappel 10 min avant », « 1 h avant », « la veille »
  if ((m = cut(/\s(?:(?:avec\s)?(?:un\s)?rappel\s)?(\d{1,3})\s?(min|minutes?|h|heures?)\savant(?=\s)/i))) out.lead = +m[1] * (/^h/i.test(m[2]) ? 60 : 1);
  else if ((m = cut(/\s(?:(?:avec\s)?(?:un\s)?rappel\s)?la veille(?=\s)/i))) out.lead = 1440;
  // heure : « à 18h », « 18h30 », « 9:15 »
  if ((m = cut(/\s(?:[àa]\s)?(\d{1,2})\s?(?:h|:)\s?(\d{2})?(?=\s)/i))) { const h = +m[1], mi = +(m[2] || 0); if (h < 24 && mi < 60) out.time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); }
  if ((m = cut(/\s(ce soir)(?=\s)/i))) { out.due = today(); if (!out.time) out.time = '19:00'; }
  if ((m = cut(/\s(ce matin)(?=\s)/i))) { out.due = today(); if (!out.time) out.time = '09:00'; }
  // dates
  if ((m = cut(/\s(aujourd'?hui|auj)(?=\s)/i))) out.due = today();
  else if ((m = cut(/\s(apr[eè]s[- ]demain)(?=\s)/i))) out.due = addDays(today(), 2);
  else if ((m = cut(/\s(demain)(?=\s)/i))) out.due = addDays(today(), 1);
  else if ((m = cut(/\s(ce week-?end|le week-?end)(?=\s)/i))) out.due = nextWeekday(6, false);
  else if ((m = cut(/\s(la semaine prochaine|semaine prochaine)(?=\s)/i))) out.due = nextWeekday(1, true);
  else if ((m = cut(/\sdans\s(\d+)\s(jours?|semaines?|mois)(?=\s)/i))) { const n = +m[1]; out.due = /mois/.test(m[2]) ? (() => { const d = new Date(); d.setMonth(d.getMonth() + n); return dk(d); })() : addDays(today(), /sem/.test(m[2]) ? n * 7 : n); }
  else if ((m = cut(/\s(?:ce |le |la )?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: prochain)?(?=\s)/i))) out.due = nextWeekday(WD.indexOf(m[1].toLowerCase()), true);
  else if ((m = cut(/\s(?:le\s)?(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?=\s)/))) {
    let y = m[3] ? +m[3] : new Date().getFullYear(); if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && dk(d) < today()) d.setFullYear(y + 1); out.due = dk(d);
  } else if ((m = cut(new RegExp('\\s(?:le\\s)?(\\d{1,2})(?:er)?\\s(' + MONTHS.join('|') + ')(?=\\s)', 'i')))) {
    const d = new Date(new Date().getFullYear(), MONTHS.indexOf(m[2].toLowerCase()), +m[1]); if (dk(d) < today()) d.setFullYear(d.getFullYear() + 1); out.due = dk(d);
  } else if ((m = cut(/\sle\s(\d{1,2})(?:er)?(?=\s)/i))) {
    const d = new Date(); d.setDate(+m[1]); if (dk(d) < today()) d.setMonth(d.getMonth() + 1); out.due = dk(d);
  }
  if (out.time && !out.due) out.due = out.time < new Date().toTimeString().slice(0, 5) ? addDays(today(), 1) : today();
  if (out.repeat && !out.due) out.due = today();
  out.title = t.replace(/\s+/g, ' ').replace(/^\s*(?:de |d'|à |a )/i, '').trim();
  out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);
  return out;
}
J.parseTask = parseQuick;

/* ============================================================
   Actions
   ============================================================ */
function nextDue(due, rep){
  const d = parseDk(due || today());
  if (rep === 'daily') d.setDate(d.getDate() + 1);
  if (rep === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  if (rep === 'weekly') d.setDate(d.getDate() + 7);
  if (rep === 'monthly') d.setMonth(d.getMonth() + 1);
  if (rep === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return dk(d);
}
function addTask(data){
  const t = Object.assign({id:uid(), title:'', note:'', due:null, time:null, prio:0, list:'perso', repeat:null, sub:[], done:false, created:Date.now()}, data);
  S().tasks.push(t); save();
  if (t.due && t.time && J.notifPrompt) J.notifPrompt('Je peux vous le rappeler à l\'heure.');   // tâche avec heure : le moment idéal pour proposer les rappels
  return t;
}
function snapshot(){ return JSON.stringify({tasks:S().tasks, lists:S().lists}); }
function restore(s){ const d = JSON.parse(s); S().tasks = d.tasks; S().lists = d.lists; save(); render(); }
function complete(t){
  const snap = snapshot();
  if (!t.done) {
    t.done = true; t.doneAt = Date.now();
    let msg = 'Tâche terminée';
    if (t.repeat) { // la suivante est créée automatiquement
      addTask({title:t.title, note:t.note, due:nextDue(t.due, t.repeat), time:t.time, prio:t.prio, list:t.list, repeat:t.repeat, lead:t.lead, sub:(t.sub || []).map(s => ({id:uid(), title:s.title, done:false}))});
      msg = `Terminée · prochaine : ${dueLabel(nextDue(t.due, t.repeat)).toLowerCase()}`;
    }
    J.haptic(); save(); render();
    J.toast(msg, {action:'ANNULER', onAction:() => restore(snap)});
    const left = dueToday().length + overdue().length;
    if (!left && (dueToday().length + doneToday().length) > 1) J.say("Toutes les tâches du jour sont terminées. Bravo.");
  } else { t.done = false; delete t.doneAt; J.haptic(); save(); render(); }
}
function removeTask(t){
  const snap = snapshot();
  S().tasks = S().tasks.filter(x => x !== t); J.haptic(); save(); render();
  J.toast('Tâche supprimée', {action:'ANNULER', onAction:() => restore(snap)});
}
function prune(){   // on garde les 300 dernières tâches terminées
  const done = S().tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (done.length > 300) { const drop = new Set(done.slice(300).map(t => t.id)); S().tasks = S().tasks.filter(t => !drop.has(t.id)); }
}

/* ============================================================
   Interface
   ============================================================ */
const q = s => $(s, root);
const fq = s => $(s, fixed);
const TEMPLATE = `
  <div class="qadd">
    <div class="qa-row"><input id="tQuick" placeholder="Ajouter : « demain 18h appeler le garage !! »" enterkeyhint="done" autocomplete="off">
      ${('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? `<button class="qa-mic" id="tMic" aria-label="Dicter">${ICON_MIC}</button>` : ''}</div>
    <div class="qa-prev" id="tPrev"></div>
  </div>
  <div class="utabs" id="tTabs"><button data-tab="today">AUJOURD'HUI</button><button data-tab="up">À VENIR</button><button data-tab="lists">LISTES</button></div>
  <div id="tTab"></div>`;

function taskRow(t){
  const l = listOf(t.list), subDone = (t.sub || []).filter(s => s.done).length, late = !t.done && t.due && t.due < today();
  const meta = [];
  if (t.due && tab !== 'today') meta.push(`<span class="${late ? 'late' : ''}">${dueLabel(t.due)}</span>`);
  else if (late) meta.push(`<span class="late">${dueLabel(t.due)}</span>`);
  if (t.time) meta.push(`<span>${t.time.replace(':', 'h')}</span>`);
  if (t.repeat) meta.push(`<span class="ic">${ICON_REP}</span>`);
  if ((t.sub || []).length) meta.push(`<span>${subDone}/${t.sub.length}</span>`);
  if (t.note) meta.push(`<span class="ic">${ICON_NOTE}</span>`);
  if (!openList) meta.push(`<span class="lc" style="--lc:${l.color}">${esc(l.name)}</span>`);
  return `<div class="srow" data-id="${t.id}">
    <div class="sbg"><span class="l">${t.done ? '↺ À FAIRE' : '✓ TERMINER'}</span><button class="sact" type="button">Supprimer</button></div>
    <div class="row ${t.done ? 'done' : ''}">
      <button class="tck p${t.prio || 0}" data-a="check" aria-label="Terminer"></button>
      <div class="info"><div class="l">${esc(t.title)}</div>${meta.length ? `<div class="m">${meta.join('')}</div>` : ''}</div>
      ${t.prio ? `<span class="flag" style="--pc:${PRIO[t.prio].c}">${'!'.repeat(t.prio)}</span>` : ''}
    </div></div>`;
}
const block = (title, list, cls = '', right = '') => list.length ? `<div class="tsec ${cls}"><div class="tsh"><span>${title}</span><span>${right || list.length}</span></div><div class="tcard">${list.map(taskRow).join('')}</div></div>` : '';

function renderToday(){
  const od = overdue().sort(sortTasks), td = dueToday().sort(sortTasks), dn = doneToday().sort((a, b) => b.doneAt - a.doneAt);
  const total = td.length + dn.length + od.length, ratio = total ? dn.length / total : 0;
  const nodate = active().filter(t => !t.due).sort(sortTasks).slice(0, 5);
  const r = 26, C = 2 * Math.PI * r;
  q('#tTab').innerHTML = `
    <div class="thero">
      <svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(185,140,255,.15)" stroke-width="6"/>
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="#b98cff" stroke-width="6" stroke-linecap="round" stroke-dasharray="${ratio * C} ${C}" transform="rotate(-90 32 32)" style="filter:drop-shadow(0 0 4px #b98cff)"/></svg>
      <div><b>${total ? `${dn.length} / ${total} faite${dn.length > 1 ? 's' : ''}` : 'Journée libre'}</b><small>${new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}).replace(/^./, c => c.toUpperCase())}${od.length ? ` · <span class="late">${od.length} en retard</span>` : ''}</small></div>
    </div>
    ${block('EN RETARD', od, 'od')}
    ${block("AUJOURD'HUI", td)}
    ${!od.length && !td.length ? `<div class="empty">${dn.length ? 'Tout est fait pour aujourd\'hui. Remarquable.' : 'Rien de prévu aujourd\'hui.<br>Ajoutez une tâche ci-dessus, par exemple « 18h sport ».'}</div>` : ''}
    ${nodate.length ? block('SANS DATE', nodate, 'nd', active().filter(t => !t.due).length > 5 ? `${active().filter(t => !t.due).length}` : '') : ''}
    ${dn.length ? `<button class="tdone-t" data-a="toggledone">${showDone ? '▾' : '▸'} Terminées aujourd'hui (${dn.length})</button>${showDone ? `<div class="tcard dim">${dn.map(taskRow).join('')}</div>` : ''}` : ''}`;
}
function renderUpcoming(){
  const list = active().filter(t => t.due && t.due >= today()).sort(sortTasks);
  const groups = new Map();
  list.forEach(t => { const n = daysBetween(today(), t.due), key = n <= 13 ? t.due : n <= 31 ? 'mois' : 'plus'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(t); });
  const html = [];
  groups.forEach((items, key) => {
    const title = key === 'mois' ? 'DANS LE MOIS' : key === 'plus' ? 'PLUS TARD' : (dueLabel(key) + (daysBetween(today(), key) > 1 ? ' ' + parseDk(key).toLocaleDateString('fr-FR', {day:'numeric', month:'short'}) : '')).toUpperCase();
    html.push(block(title, items));
  });
  const nd = active().filter(t => !t.due).sort(sortTasks);
  q('#tTab').innerHTML = (html.join('') || '<div class="empty">Rien de planifié pour les prochains jours.</div>') + block('SANS DATE', nd, 'nd');
}
function renderLists(){
  if (openList) {
    const l = listOf(openList);
    const items = S().tasks.filter(t => t.list === l.id && !t.done).sort(sortTasks);
    const done = S().tasks.filter(t => t.list === l.id && t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30);
    q('#tTab').innerHTML = `
      <div class="lhead2"><button class="lnk" data-a="back">‹ Listes</button><button class="lnk" data-a="editlist">Modifier</button></div>
      <div class="ltitle" style="--lc:${l.color}"><span></span><b>${esc(l.name)}</b><small>${items.length} à faire</small></div>
      ${items.length ? `<div class="tcard">${items.map(taskRow).join('')}</div>` : '<div class="empty">Liste vide. Ajoutez une tâche ci-dessus.</div>'}
      ${done.length ? `<button class="tdone-t" data-a="toggledone">${showDone ? '▾' : '▸'} Terminées (${done.length})</button>${showDone ? `<div class="tcard dim">${done.map(taskRow).join('')}</div>` : ''}` : ''}`;
    return;
  }
  const smart = [
    {id:'@today', name:"Aujourd'hui", n:dueToday().length + overdue().length, c:'#b98cff'},
    {id:'@up', name:'Planifiées', n:active().filter(t => t.due).length, c:'#5c9dff'},
    {id:'@all', name:'Toutes', n:active().length, c:'#8aa7b8'},
    {id:'@prio', name:'Prioritaires', n:active().filter(t => t.prio >= 2).length, c:'#ff4d3d'},
  ];
  q('#tTab').innerHTML = `
    <div class="smart">${smart.map(s => `<button class="sm" data-smart="${s.id}" style="--lc:${s.c}"><span class="dot"></span><b>${s.n}</b><small>${s.name}</small></button>`).join('')}</div>
    <div class="slabel"><span>MES LISTES</span><button class="lnk" data-a="newlist">+ Nouvelle</button></div>
    <div class="tcard">${S().lists.map(l => { const n = S().tasks.filter(t => t.list === l.id && !t.done).length;
      return `<button class="lrow" data-list="${l.id}" style="--lc:${l.color}"><span class="dot"></span><b>${esc(l.name)}</b><span>${n || ''}</span><i>›</i></button>`; }).join('')}</div>`;
}
let smartView = null;
function renderSmart(){
  const map = {'@all':['Toutes', active()], '@prio':['Prioritaires', active().filter(t => t.prio >= 2)], '@up':['Planifiées', active().filter(t => t.due)]};
  const [name, list] = map[smartView];
  q('#tTab').innerHTML = `<div class="lhead2"><button class="lnk" data-a="back">‹ Listes</button></div><div class="ltitle"><b>${name}</b><small>${list.length} à faire</small></div>
    ${list.length ? `<div class="tcard">${list.sort(sortTasks).map(taskRow).join('')}</div>` : '<div class="empty">Rien ici.</div>'}`;
}

function render(){
  if (!root) return;
  $$('#tTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'today') renderToday();
  else if (tab === 'up') renderUpcoming();
  else if (smartView) renderSmart();
  else renderLists();
}
function status(){
  const od = overdue().length, td = dueToday().length;
  if (!od && !td) return doneToday().length ? 'Tout est fait pour aujourd\'hui. Je vous félicite.' : 'Aucune tâche prévue aujourd\'hui.';
  const next = dueToday().filter(t => t.time).sort(sortTasks).find(t => t.time >= new Date().toTimeString().slice(0, 5));
  return `${td} tâche${td > 1 ? 's' : ''} aujourd'hui${od ? `, ${od} en retard` : ''}.` + (next ? ` Prochaine : ${next.title} à ${next.time.replace(':', 'h')}.` : '');
}

/* ---------- aperçu de la saisie rapide ---------- */
function updatePreview(){
  const v = q('#tQuick').value.trim(), el = q('#tPrev');
  if (!v) { el.innerHTML = ''; el.hidden = true; return; }
  const p = parseQuick(v), chips = [];
  if (p.due) chips.push(`📅 ${dueLabel(p.due)}`);
  if (p.time) chips.push(`⏰ ${p.time.replace(':', 'h')}`);
  if (p.prio) chips.push(`${'!'.repeat(p.prio)} ${PRIO[p.prio].n.toLowerCase()}`);
  if (p.repeat) chips.push(`↻ ${REPEAT[p.repeat].toLowerCase()}`);
  if (p.lead !== null && p.lead !== undefined) chips.push(`🔔 ${leadName(p.lead)}`);
  if (p.list || p.newList) chips.push(`● ${p.list ? listOf(p.list).name : p.newList + ' (nouvelle)'}`);
  el.hidden = !chips.length;
  el.innerHTML = chips.map(c => `<span>${esc(c)}</span>`).join('') + (chips.length ? '<em>↵ pour ajouter</em>' : '');
}
function quickAdd(){
  const v = q('#tQuick').value.trim(); if (!v) return;
  const p = parseQuick(v);
  if (!p.title) { J.toast('Précisez la tâche'); return; }
  if (p.newList) { const nl = {id:uid(), name:p.newList.charAt(0).toUpperCase() + p.newList.slice(1), color:LIST_COLORS[S().lists.length % LIST_COLORS.length]}; S().lists.push(nl); p.list = nl.id; }
  if (!p.list) p.list = openList || 'perso';
  if (!p.due && tab === 'today' && !openList) p.due = today();
  const t = addTask({title:p.title, due:p.due, time:p.time, prio:p.prio, list:p.list, repeat:p.repeat, lead:p.lead});
  q('#tQuick').value = ''; updatePreview(); J.haptic(); render();
  J.toast(`Ajoutée${t.due ? ' · ' + dueLabel(t.due).toLowerCase() : ''}${t.time ? ' à ' + t.time.replace(':', 'h') : ''}`);
}

/* ---------- dictée ---------- */
let rec = null;
function dictate(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = true; rec.maxAlternatives = 1;
  const btn = q('#tMic'); btn.classList.add('on'); J.haptic();
  rec.onresult = e => { const txt = [...e.results].map(r => r[0].transcript).join(' '); q('#tQuick').value = txt.replace(/^(?:rappelle[- ]moi\s(?:de\s|d')?|ajoute\s|note\s)/i, ''); updatePreview(); };
  rec.onerror = e => { if (e.error !== 'aborted') J.toast(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans Réglages' : 'Dictée indisponible'); };
  rec.onend = () => { btn.classList.remove('on'); rec = null; if (q('#tQuick').value.trim()) quickAdd(); };
  try { rec.start(); } catch(e) { btn.classList.remove('on'); rec = null; }
}

/* ============================================================
   Feuille d'édition
   ============================================================ */
const FIXED = `
  <button class="fab" id="tAdd" aria-label="Nouvelle tâche">+</button>
  <div class="sheet tsk" id="tEdit" role="dialog" aria-label="Tâche">
    <div class="grab"></div>
    <div class="te-top"><button class="tck big" id="tkCk" aria-label="Terminer"></button><textarea id="tkTitle" rows="1" placeholder="Que faut-il faire ?" maxlength="200"></textarea></div>
    <textarea id="tkNote" rows="2" placeholder="Notes" maxlength="2000"></textarea>
    <div class="field"><label>ÉCHÉANCE</label>
      <div class="chips" id="tkDueChips"><button data-due="0">Aujourd'hui</button><button data-due="1">Demain</button><button data-due="we">Week-end</button><button data-due="nw">Lundi</button><button data-due="none">Aucune</button></div>
      <div class="two"><input id="tkDue" type="date"><input id="tkTime" type="time"></div></div>
    <div class="field" id="tkLeadF"><label>RAPPEL</label><div class="chips" id="tkLead"></div></div>
    <div class="field"><label>PRIORITÉ</label><div class="seg" id="tkPrio">${PRIO.map((p, i) => `<button data-v="${i}">${i ? '!'.repeat(i) + ' ' : ''}${p.n.toUpperCase()}</button>`).join('')}</div></div>
    <div class="field"><label>LISTE</label><div class="chips" id="tkList"></div></div>
    <div class="field"><label>RÉPÉTITION</label><div class="chips" id="tkRep"><button data-v="">Aucune</button>${Object.entries(REPEAT).map(([k, v]) => `<button data-v="${k}">${v}</button>`).join('')}</div></div>
    <div class="field"><label>SOUS-TÂCHES</label><div id="tkSubs"></div><div class="subadd"><input id="tkSubIn" placeholder="+ Ajouter une étape" enterkeyhint="done"></div></div>
    <button class="btn primary" id="tkSave">ENREGISTRER</button>
    <div class="two" id="tkMore"><button class="btn ghost" id="tkDup">DUPLIQUER</button><button class="btn danger" id="tkDel">SUPPRIMER</button></div>
  </div>
  <div class="sheet tsk" id="tList" role="dialog" aria-label="Liste">
    <div class="grab"></div>
    <h2 id="tlTitle">NOUVELLE LISTE</h2>
    <div class="field"><label>NOM</label><input id="tlName" maxlength="30" placeholder="Ex : Maison"></div>
    <div class="field"><label>COULEUR</label><div class="colors" id="tlColors"></div></div>
    <button class="btn primary" id="tlSave">ENREGISTRER</button>
    <button class="btn danger" id="tlDel">SUPPRIMER LA LISTE</button>
  </div>`;

let editing = null, eSubs = [], ePrio = 0, eListId = 'perso', eRep = '', eLead = null;
function seg(sel, v, attr = 'v'){ $$(sel + ' button', fixed).forEach(b => b.classList.toggle('on', b.dataset[attr] === String(v))); }
function renderSubs(){
  fq('#tkSubs').innerHTML = eSubs.map((s, i) => `<div class="sub ${s.done ? 'done' : ''}"><button class="tck sm" data-si="${i}"></button><span>${esc(s.title)}</span><button class="sx" data-sx="${i}">✕</button></div>`).join('');
}
function renderLead(){   // le rappel n'a de sens qu'avec une heure
  const hasTime = !!fq('#tkTime').value;
  fq('#tkLead').innerHTML = hasTime ? [[null, `Par défaut (${leadName(defaultLead())})`], ...LEADS].map(([v, n]) => `<button data-lead="${v}" class="${v === eLead ? 'on' : ''}">${n}</button>`).join('')
    : '<span class="lead-hint">Ajoutez une heure pour être prévenu.</span>';
}
function autosize(el){ el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
function openEditor(t, preset = {}){
  editing = t || null;
  const d = t || Object.assign({title:'', note:'', due:tab === 'today' && !openList ? today() : null, time:null, prio:0, list:openList || 'perso', repeat:null, sub:[]}, preset);
  fq('#tkTitle').value = d.title; fq('#tkNote').value = d.note || '';
  fq('#tkDue').value = d.due || ''; fq('#tkTime').value = d.time || '';
  ePrio = d.prio || 0; seg('#tkPrio', ePrio);
  eListId = d.list; fq('#tkList').innerHTML = S().lists.map(l => `<button data-l="${l.id}" style="--lc:${l.color}" class="${l.id === eListId ? 'on' : ''}"><i></i>${esc(l.name)}</button>`).join('');
  eRep = d.repeat || ''; seg('#tkRep', eRep);
  eLead = typeof d.lead === 'number' ? d.lead : null; renderLead();
  eSubs = JSON.parse(JSON.stringify(d.sub || [])); renderSubs();
  fq('#tkCk').hidden = !t; fq('#tkCk').classList.toggle('on', !!(t && t.done));
  fq('#tkMore').hidden = !t;
  fq('#tkSave').textContent = t ? 'ENREGISTRER' : 'AJOUTER';
  J.openSheet(fq('#tEdit'));
  setTimeout(() => { autosize(fq('#tkTitle')); autosize(fq('#tkNote')); }, 0);
  if (!t) J.focusAfterOpen(fq('#tkTitle'));
}
function saveEditor(){
  const title = fq('#tkTitle').value.trim();
  if (!title) { J.toast('Donnez un titre à la tâche'); return; }
  const data = {title, note:fq('#tkNote').value.trim(), due:fq('#tkDue').value || null, time:fq('#tkTime').value || null, prio:ePrio, list:eListId, repeat:eRep || null, sub:eSubs, lead:eLead};
  if (data.repeat && !data.due) data.due = today();
  if (editing) Object.assign(editing, data); else addTask(data);
  J.haptic(); save(); J.closeSheet(); render();
  J.toast(editing ? 'Tâche mise à jour' : 'Tâche ajoutée');
}

/* ============================================================
   Branchements
   ============================================================ */
function bind(){
  root.addEventListener('click', e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { J.haptic(); tab = tb.dataset.tab; openList = null; smartView = null; showDone = false; render(); window.scrollTo(0, 0); return; }
    const a = e.target.closest('[data-a]'), act = a && a.dataset.a;
    if (act === 'check') { const t = S().tasks.find(x => x.id === a.closest('.srow').dataset.id); if (t) complete(t); return; }
    if (act === 'toggledone') { showDone = !showDone; render(); return; }
    if (act === 'back') { openList = null; smartView = null; showDone = false; render(); return; }
    if (act === 'newlist') return openListSheet();
    if (act === 'editlist') return openListSheet(listOf(openList));
    const sm = e.target.closest('[data-smart]');
    if (sm) { if (sm.dataset.smart === '@today') { tab = 'today'; render(); } else { smartView = sm.dataset.smart; render(); } window.scrollTo(0, 0); return; }
    const lr = e.target.closest('[data-list]'); if (lr) { openList = lr.dataset.list; showDone = false; render(); window.scrollTo(0, 0); return; }
    const row = e.target.closest('.srow'); if (row) { const t = S().tasks.find(x => x.id === row.dataset.id); if (t) openEditor(t); }
  });
  q('#tQuick').addEventListener('input', updatePreview);
  q('#tQuick').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quickAdd(); } });
  q('#tQuick').addEventListener('blur', () => setTimeout(() => { if (!q('#tQuick').value) updatePreview(); }, 100));
  if (q('#tMic')) q('#tMic').addEventListener('click', dictate);

  J.swipeRows(root, {
    right: row => { const t = S().tasks.find(x => x.id === row.dataset.id); if (t) complete(t); },
    left: row => { const t = S().tasks.find(x => x.id === row.dataset.id); if (t) removeTask(t); },
  });

  /* feuille d'édition */
  fq('#tAdd').addEventListener('click', () => { J.haptic(); openEditor(); });
  ['#tkTitle', '#tkNote'].forEach(s => fq(s).addEventListener('input', e => autosize(e.target)));
  fq('#tkTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fq('#tkNote').focus(); } });
  fq('#tkDueChips').addEventListener('click', e => {
    const b = e.target.closest('[data-due]'); if (!b) return;
    const v = b.dataset.due;
    fq('#tkDue').value = v === 'none' ? '' : v === 'we' ? nextWeekday(6, false) : v === 'nw' ? nextWeekday(1, true) : addDays(today(), +v);
    if (v === 'none') fq('#tkTime').value = '';
    J.haptic();
  });
  fq('#tkPrio').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { ePrio = +b.dataset.v; seg('#tkPrio', ePrio); } });
  fq('#tkList').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (b) { eListId = b.dataset.l; $$('#tkList button', fixed).forEach(x => x.classList.toggle('on', x === b)); } });
  fq('#tkRep').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { eRep = b.dataset.v; seg('#tkRep', eRep); } });
  fq('#tkLead').addEventListener('click', e => { const b = e.target.closest('[data-lead]'); if (!b) return; eLead = b.dataset.lead === 'null' ? null : +b.dataset.lead; J.haptic(); renderLead(); });
  fq('#tkTime').addEventListener('change', renderLead);
  fq('#tkSubIn').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const v = e.target.value.trim(); if (!v) return;
    eSubs.push({id:uid(), title:v, done:false}); e.target.value = ''; renderSubs();
  });
  fq('#tkSubs').addEventListener('click', e => {
    const c = e.target.closest('[data-si]'); if (c) { const s = eSubs[+c.dataset.si]; s.done = !s.done; J.haptic(); renderSubs(); return; }
    const x = e.target.closest('[data-sx]'); if (x) { eSubs.splice(+x.dataset.sx, 1); renderSubs(); }
  });
  fq('#tkCk').addEventListener('click', () => { if (!editing) return; saveEditor(); complete(editing); });
  fq('#tkSave').addEventListener('click', saveEditor);
  fq('#tkDup').addEventListener('click', () => { const t = editing; J.closeSheet(); setTimeout(() => openEditor(null, {title:t.title, note:t.note, due:t.due, time:t.time, prio:t.prio, list:t.list, repeat:t.repeat, lead:t.lead, sub:(t.sub || []).map(s => ({id:uid(), title:s.title, done:false}))}), 320); });
  fq('#tkDel').addEventListener('click', () => { const t = editing; J.closeSheet(); removeTask(t); });

  /* listes */
  fq('#tlColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { listColor = b.dataset.c; $$('#tlColors button', fixed).forEach(x => x.classList.toggle('on', x === b)); } });
  fq('#tlSave').addEventListener('click', () => {
    const name = fq('#tlName').value.trim(); if (!name) { J.toast('Nom requis'); return; }
    if (listEditing) Object.assign(listEditing, {name, color:listColor}); else S().lists.push({id:uid(), name, color:listColor});
    save(); J.closeSheet(); render();
  });
  fq('#tlDel').addEventListener('click', () => {
    if (!listEditing || S().lists.length <= 1) return;
    const snap = snapshot(), id = listEditing.id, fallback = S().lists.find(l => l.id !== id).id;
    S().tasks.forEach(t => { if (t.list === id) t.list = fallback; });
    S().lists = S().lists.filter(l => l.id !== id); openList = null;
    save(); J.closeSheet(); render(); J.toast('Liste supprimée (tâches déplacées)', {action:'ANNULER', onAction:() => restore(snap)});
  });
}
let listEditing = null, listColor = LIST_COLORS[0];
function openListSheet(l){
  listEditing = l || null;
  fq('#tlTitle').textContent = l ? 'MODIFIER LA LISTE' : 'NOUVELLE LISTE';
  fq('#tlName').value = l ? l.name : '';
  listColor = l ? l.color : LIST_COLORS[S().lists.length % LIST_COLORS.length];
  fq('#tlColors').innerHTML = LIST_COLORS.map(c => `<button data-c="${c}" class="${c === listColor ? 'on' : ''}" style="--cc:${c}"></button>`).join('');
  fq('#tlDel').hidden = !l || S().lists.length <= 1;
  J.openSheet(fq('#tList'));
  if (!l) J.focusAfterOpen(fq('#tlName'));
}

/* ---------- Jarvis qui discute ---------- */
J.actions = J.actions || {};
J.actions.add_task = a => {
  const title = String(a.title || '').trim(); if (!title) throw Object.assign(new Error('Quelle tâche dois-je ajouter ?'), {ask:'Quelle tâche dois-je ajouter ?'});
  const due = /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : null, time = /^\d{1,2}:\d{2}$/.test(a.time || '') ? a.time.padStart(5, '0') : null;
  const l = a.list && S().lists.find(x => norm(x.name) === norm(a.list));
  const lead = a.lead === null || a.lead === undefined || a.lead === '' || !isFinite(+a.lead) ? null : Math.max(-1, Math.min(10080, Math.round(+a.lead)));
  const t = addTask({title:title.charAt(0).toUpperCase() + title.slice(1), due:due || (time ? today() : null), time, prio:Math.max(0, Math.min(3, +a.priority || 0)), list:l ? l.id : 'perso', lead});
  render();
  return {text:`Tâche : ${t.title}${t.due ? ' · ' + dueLabel(t.due).toLowerCase() : ''}${t.time ? ' à ' + t.time.replace(':', 'h') + ' · 🔔 ' + leadName(leadOf(t)) : ''}`, go:'taches'};
};
/* « replanifie mes tâches en retard » : réparties sur les prochains jours, les prioritaires d'abord, 3 par jour au plus */
J.actions.reschedule_overdue = a => {
  const od = overdue().sort((x, y) => (y.prio || 0) - (x.prio || 0) || x.due.localeCompare(y.due));
  if (!od.length) throw Object.assign(new Error('?'), {ask:'Aucune tâche en retard, tout est à jour.'});
  const per = Math.max(1, Math.min(6, +a.per_day || 3)), load = {};
  active().filter(t => t.due && t.due >= today()).forEach(t => { load[t.due] = (load[t.due] || 0) + 1; });
  let d = 0, first = null, last = null;
  od.forEach(t => {
    while ((load[addDays(today(), d)] || 0) >= per + (d === 0 ? 0 : 1)) d++;
    const k = addDays(today(), d); t.due = k; load[k] = (load[k] || 0) + 1; first = first || k; last = k;
  });
  save(); render();
  return {text:`${od.length} tâche${od.length > 1 ? 's' : ''} replanifiée${od.length > 1 ? 's' : ''} · ${first === last ? dueLabel(first).toLowerCase() : (first === today() ? 'd\'aujourd\'hui' : 'du ' + dueLabel(first).toLowerCase()) + ' à ' + dueLabel(last).toLowerCase()}`, go:'taches'};
};
J.actions.complete_task = a => {
  const words = norm(a.title || '').split(/\s+/).filter(w => w.length > 2);
  const t = active().map(t => [t, words.filter(w => norm(t.title).includes(w)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1])[0];
  if (!t) throw Object.assign(new Error('tâche introuvable'), {ask:`Je ne trouve pas de tâche correspondant à « ${a.title} ». Laquelle est-ce ?`});
  complete(t[0]);
  return {text:`Terminée : ${t[0].title}`, go:'taches'};
};

/* ---------- déclaration du module ---------- */
J.module({
  id: 'taches',
  code: '05',
  order: 12,
  name: 'Tâches',
  short: 'Tâches',
  tagline: 'À faire, rappels et listes',
  accent: '#b98cff',
  cls: 'tsk',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',

  init(){ st = J.store('taches', DEFAULTS); st.onChange(() => render()); },
  summary(){ const n = dueToday().length + overdue().length; return n ? `<b>${n}</b> à faire aujourd'hui` : 'Rien aujourd\'hui'; },
  /* observations : tâche qui traîne, retard qui s'accumule */
  insights(){
    const out = [], od = overdue().sort((a, b) => a.due.localeCompare(b.due));
    if (od.length >= 5) out.push({level:'warn', score:70, text:`${od.length} tâches en retard. Dites « replanifie mes tâches en retard » et je les répartis sur les prochains jours.`, go:'taches'});
    const old = od[0], age = old ? Math.round((Date.parse(today()) - Date.parse(old.due)) / 864e5) : 0;
    if (old && age >= 3) out.push({level:'warn', score:56 + Math.min(12, age), text:`« ${old.title} » traîne depuis ${age} jours.`, go:'taches'});
    return out;
  },
  widget(){
    const now = new Date().toTimeString().slice(0, 5), next = dueToday().filter(t => t.time && t.time >= now).sort(sortTasks)[0] || [...overdue(), ...dueToday()].sort(sortTasks)[0];
    return {tasksLeft:overdue().length + dueToday().length, overdue:overdue().length, nextTask:next ? next.title : null, nextTime:next && next.time && next.due === today() ? next.time : null};
  },
  stat(){
    const od = overdue().length, td = dueToday().length, dn = doneToday().length, total = od + td + dn;
    const next = dueToday().filter(t => t.time).sort(sortTasks).find(t => t.time >= new Date().toTimeString().slice(0, 5));
    return {label:'TÂCHES', value:(od + td) ? `${od + td}<small> à faire</small>` : '<small>Tout est fait</small>',
      sub:od ? `${od} en retard` : next ? `${next.time.replace(':', 'h')} · ${esc(next.title)}` : total ? `${dn} terminée${dn > 1 ? 's' : ''}` : 'aucune aujourd\'hui', ratio:total ? dn / total : null};
  },
  brief(){ const od = overdue().length; return od ? `Attention, ${od} tâche${od > 1 ? 's' : ''} en retard.` : ''; },
  report(){ return status(); },
  chat(){
    const fmtT = t => `${t.title}${t.due ? ' (' + t.due + (t.time ? ' ' + t.time : '') + ')' : ''}${t.prio >= 2 ? ' [prioritaire]' : ''}`;
    const up = active().filter(t => t.due && t.due > today() && t.due <= addDays(today(), 7)).sort(sortTasks).slice(0, 12);
    return `TÂCHES : en retard : ${overdue().map(fmtT).join(' ; ') || 'aucune'}. Aujourd'hui : ${dueToday().sort(sortTasks).map(fmtT).join(' ; ') || 'aucune'}. À venir (7 j) : ${up.map(fmtT).join(' ; ') || 'rien'}. Sans date : ${active().filter(t => !t.due).length}. Listes : ${S().lists.map(l => l.name).join(', ')}.`;
  },
  /* notifications : chaque tâche datée avec une heure */
  reminders(){
    const atOf = (d, t) => { const [y, m, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi).getTime(); };
    return active().filter(t => t.due && t.time && leadOf(t) !== -1).map(t => {
      const lead = leadOf(t), at = atOf(t.due, t.time) - lead * 60000;
      const when = lead === 0 ? 'Maintenant' : lead === 1440 ? `Demain à ${t.time.replace(':', 'h')}` : `Dans ${lead >= 60 ? lead / 60 + ' h' : lead + ' min'} · à ${t.time.replace(':', 'h')}`;
      return {id:'task-' + t.id + '-' + t.due + '-' + t.time + '-' + lead, kind:'tasks', at, title:'⏰ ' + t.title,
        body:[when, t.prio >= 2 ? 'priorité ' + PRIO[t.prio].n.toLowerCase() : '', (t.sub || []).length ? `${t.sub.filter(x => x.done).length}/${t.sub.length} étapes` : ''].filter(Boolean).join(' · '), url:'#/taches'};
    });
  },
  briefing(){
    const list = [...overdue(), ...dueToday()].sort(sortTasks).slice(0, 5);
    if (!list.length) return null;
    return {order:12, icon:J.modules.find(m => m.id === 'taches').icon, title:"TÂCHES DU JOUR", act:'mod:taches', right:'›', body:'<ul class="blist">' + list.map(t =>
      `<li class="${t.due < today() ? 'late' : ''}"><span class="bt2">${t.time ? t.time.replace(':', 'h') : t.due < today() ? 'RETARD' : '—'}</span><span>${esc(t.title)}</span>${t.prio >= 2 ? `<em style="color:${PRIO[t.prio].c}">${'!'.repeat(t.prio)}</em>` : ''}</li>`).join('') + '</ul>'};
  },
  briefingSpeech(){
    const od = overdue(), td = dueToday().sort(sortTasks);
    if (!od.length && !td.length) return '';
    return `${td.length} tâche${td.length > 1 ? 's' : ''} aujourd'hui${od.length ? `, ${od.length} en retard` : ''}` + (td[0] ? `, dont ${td[0].title}${td[0].time ? ' à ' + td[0].time.replace(':', ' heures ') : ''}` : '') + '.';
  },

  mount(body, fx){
    root = body; fixed = fx;
    root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED;
    prune(); bind(); render(); updatePreview();
    J.say(status());
  },
  onShow(){ render(); J.say(status()); },
  unmount(){ if (rec) rec.stop(); root = null; fixed = null; },
});
})();
