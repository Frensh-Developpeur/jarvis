/* ============================================================
   Module 07 — Notes & journal
   Notes rapides (épinglées, couleurs, listes à cocher, recherche)
   et journal du soir (humeur, énergie, gratitude, bilan) avec historique.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, uid} = J;

const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const parseDk = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (k, n) => { const d = parseDk(k); d.setDate(d.getDate() + n); return dk(d); };
const today = () => dk(new Date());
const MOODS = [{e:'😣', n:'Très difficile', c:'#ff4d3d'}, {e:'😕', n:'Difficile', c:'#ff8a5c'}, {e:'😐', n:'Neutre', c:'#ffe066'}, {e:'🙂', n:'Bien', c:'#4dffc3'}, {e:'😄', n:'Excellent', c:'#3fe0ff'}];
const NOTE_COLORS = ['', '#3fe0ff', '#4dffc3', '#ffb347', '#ff5f8f', '#b98cff'];
const PROMPTS = ['Qu\'est-ce qui t\'a fait sourire aujourd\'hui ?', 'Qu\'as-tu appris aujourd\'hui ?', 'De quoi es-tu fier aujourd\'hui ?', 'Qu\'est-ce qui t\'a pris de l\'énergie ?', 'Qu\'aimerais-tu faire autrement demain ?', 'Quel moment voudrais-tu garder en mémoire ?', 'À qui as-tu envie de dire merci ?'];
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 3l7 7-3 1-4 4 1 5-2 1-4-5-5 5-1-1 5-5-5-4 1-2 5 1 4-4z"/></svg>';

let st = null, root = null, fixed = null, tab = 'notes', query = '';
const S = () => st.data;
const save = () => st.save();
const DEFAULTS = {notes:[], journal:{}};
const fmtDate = ts => { const d = new Date(ts), k = dk(d); return k === today() ? 'Aujourd\'hui ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : k === addDays(today(), -1) ? 'Hier' : d.toLocaleDateString('fr-FR', {day:'numeric', month:'short'}); };

/* aperçu d'une note : les lignes « - [ ] » / « - [x] » deviennent des cases à cocher */
function preview(body){
  const lines = (body || '').split('\n').filter(l => l.trim()).slice(0, 6);
  return lines.map(l => {
    const m = l.match(/^\s*[-*]\s\[( |x)\]\s?(.*)$/i);
    if (m) return `<div class="chk ${m[1].toLowerCase() === 'x' ? 'on' : ''}"><i></i>${esc(m[2])}</div>`;
    return `<div>${esc(l)}</div>`;
  }).join('');
}

/* ============================================================
   Interface
   ============================================================ */
const q = s => $(s, root);
const fq = s => $(s, fixed);
const TEMPLATE = `
  <div class="utabs" id="nbTabs"><button data-tab="notes">NOTES</button><button data-tab="journal">JOURNAL</button></div>
  <div id="nbTab"></div>`;

function renderNotes(){
  const ql = query.toLowerCase();
  const list = S().notes.filter(n => !ql || (n.title + ' ' + n.body).toLowerCase().includes(ql)).sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
  const card = n => `<button class="ncard ${n.color ? 'col' : ''}" data-note="${n.id}" style="--nc:${n.color || 'rgba(63,224,255,.25)'}">
      ${n.pinned ? `<span class="pin">${ICON_PIN}</span>` : ''}
      ${n.title ? `<b>${esc(n.title)}</b>` : ''}<div class="np">${preview(n.body) || '<i class="muted">Note vide</i>'}</div>
      <small>${fmtDate(n.updated)}</small></button>`;
  const pinned = list.filter(n => n.pinned), rest = list.filter(n => !n.pinned);
  q('#nbTab').innerHTML = `
    <div class="nsearch"><input id="nbQ" placeholder="Rechercher dans les notes…" value="${esc(query)}" enterkeyhint="search"></div>
    ${!S().notes.length ? '<div class="empty" style="margin-top:28px">Aucune note.<br>Idées, listes, codes Wi-Fi, numéros utiles… touchez + pour commencer.</div>'
      : !list.length ? '<div class="empty">Aucun résultat.</div>'
      : (pinned.length ? `<div class="slabel"><span>ÉPINGLÉES</span></div><div class="ngrid">${pinned.map(card).join('')}</div>` : '') +
        (rest.length ? `${pinned.length ? '<div class="slabel"><span>AUTRES</span></div>' : ''}<div class="ngrid">${rest.map(card).join('')}</div>` : '')}`;
}

function journalStats(){
  const days = Object.keys(S().journal).sort();
  let streak = 0, k = S().journal[today()] ? today() : addDays(today(), -1);
  while (S().journal[k]) { streak++; k = addDays(k, -1); }
  const last30 = days.filter(d => d >= addDays(today(), -29)).map(d => S().journal[d]).filter(e => e.mood !== undefined);
  const avg = last30.length ? last30.reduce((a, e) => a + e.mood, 0) / last30.length : null;
  return {streak, count:days.length, avg, last30};
}
function renderJournal(){
  const t = S().journal[today()], js = journalStats();
  const W = 320, H = 90, pts = [];
  for (let i = 29; i >= 0; i--) { const d = addDays(today(), -i), e = S().journal[d]; if (e && e.mood !== undefined) pts.push({x:(29 - i) / 29 * (W - 20) + 10, y:H - 14 - e.mood / 4 * (H - 28), m:e.mood}); }
  const entries = Object.keys(S().journal).sort().reverse().slice(0, 40);
  q('#nbTab').innerHTML = `
    <button class="jtoday ${t ? 'done' : ''}" data-a="write">
      <span class="jm">${t && t.mood !== undefined ? MOODS[t.mood].e : '✍️'}</span>
      <div><b>${t ? 'Journal du jour rempli' : 'Comment s\'est passée ta journée ?'}</b><small>${t ? 'Touchez pour compléter ou modifier' : esc(PROMPTS[new Date().getDate() % PROMPTS.length])}</small></div><i>›</i></button>
    <div class="kpis3"><div><small>SÉRIE</small><b>${js.streak ? '🔥 ' + js.streak : '0'} j</b></div><div><small>HUMEUR 30 J</small><b>${js.avg !== null ? MOODS[Math.round(js.avg)].e + ' ' + (js.avg + 1).toFixed(1).replace('.', ',') : '—'}</b></div><div><small>ENTRÉES</small><b>${js.count}</b></div></div>
    ${pts.length >= 2 ? `<section class="panel"><div class="ph"><span>HUMEUR · 30 JOURS</span><span></span></div>
      <svg viewBox="0 0 ${W} ${H}" class="mchart"><polyline points="${pts.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#ff5f8f" stroke-width="2" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px #ff5f8f)"/>
      ${pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${MOODS[p.m].c}"/>`).join('')}</svg></section>` : ''}
    ${entries.length ? `<div class="slabel"><span>HISTORIQUE</span></div><div class="jlist">${entries.map(d => { const e = S().journal[d];
      return `<button class="jrow" data-day="${d}"><span class="jm sm">${e.mood !== undefined ? MOODS[e.mood].e : '📝'}</span><div><b>${parseDk(d).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}).replace(/^./, c => c.toUpperCase())}</b>
        <small>${esc((e.good || e.free || (e.grat || []).filter(Boolean).join(', ') || '').slice(0, 90)) || '—'}</small></div></button>`; }).join('')}</div>` : ''}`;
}
function render(){
  if (!root) return;
  $$('#nbTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  (tab === 'notes' ? renderNotes : renderJournal)();
  fq('#nbAdd').hidden = tab !== 'notes';
}
function status(){
  if (tab === 'journal' || new Date().getHours() >= 19) {
    const t = S().journal[today()];
    if (!t && new Date().getHours() >= 19) return 'La journée touche à sa fin. Un mot dans votre journal ?';
  }
  const n = S().notes.length;
  return n ? `${n} note${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''}.` : 'Prêt à prendre des notes.';
}

/* ---------- feuilles ---------- */
const FIXED = `
  <button class="fab" id="nbAdd" aria-label="Nouvelle note">+</button>
  <div class="sheet nb" id="nbEdit" role="dialog" aria-label="Note">
    <div class="grab"></div>
    <div class="ne-bar"><div class="ncolors" id="neColors"></div><button class="pinb" id="nePin" aria-label="Épingler">${ICON_PIN}</button></div>
    <input id="neTitle" class="ne-title" placeholder="Titre" maxlength="80" autocomplete="off">
    <textarea id="neBody" class="ne-body" placeholder="Écrivez… (« - [ ] » crée une case à cocher)" rows="8"></textarea>
    <div class="ne-tools"><button id="neChk" type="button">☑ Case à cocher</button><span id="neInfo"></span></div>
    <button class="btn primary" id="neSave">ENREGISTRER</button>
    <button class="btn danger" id="neDel">SUPPRIMER</button>
  </div>
  <div class="sheet nb" id="nbJour" role="dialog" aria-label="Journal">
    <div class="grab"></div>
    <h2 id="jTitle">JOURNAL</h2>
    <div class="field"><label>HUMEUR</label><div class="moods" id="jMood">${MOODS.map((m, i) => `<button data-m="${i}" style="--mc:${m.c}"><span>${m.e}</span><small>${m.n}</small></button>`).join('')}</div></div>
    <div class="field"><label>ÉNERGIE</label><div class="energy" id="jEnergy">${[1, 2, 3, 4, 5].map(i => `<button data-e="${i}">${'⚡'.repeat(1)}<small>${i}</small></button>`).join('')}</div></div>
    <div class="field"><label>3 CHOSES POSITIVES</label><input id="jG1" placeholder="1." maxlength="120"><input id="jG2" placeholder="2." maxlength="120"><input id="jG3" placeholder="3." maxlength="120"></div>
    <div class="field"><label>CE QUI S'EST BIEN PASSÉ</label><textarea id="jGood" rows="2" maxlength="1000"></textarea></div>
    <div class="field"><label>À AMÉLIORER DEMAIN</label><textarea id="jBetter" rows="2" maxlength="1000"></textarea></div>
    <div class="field"><label id="jPromptL">NOTES LIBRES</label><textarea id="jFree" rows="3" maxlength="4000"></textarea></div>
    <button class="btn primary" id="jSave">ENREGISTRER</button>
    <button class="btn danger" id="jDel">SUPPRIMER CETTE ENTRÉE</button>
  </div>`;

let nEditing = null, nColor = '', nPinned = false;
function openNote(n){
  nEditing = n || null;
  fq('#neTitle').value = n ? n.title : ''; fq('#neBody').value = n ? n.body : '';
  nColor = n ? n.color || '' : ''; nPinned = n ? !!n.pinned : false;
  paintNote(); fq('#neDel').hidden = !n;
  fq('#neInfo').textContent = n ? 'Modifiée ' + fmtDate(n.updated).toLowerCase() : '';
  J.openSheet(fq('#nbEdit'));
  if (!n) J.focusAfterOpen(fq('#neBody'));
}
function paintNote(){
  fq('#neColors').innerHTML = NOTE_COLORS.map(c => `<button data-c="${c}" class="${c === nColor ? 'on' : ''}" style="--cc:${c || '#2a3d4a'}"></button>`).join('');
  fq('#nePin').classList.toggle('on', nPinned);
}
function saveNote(){
  const title = fq('#neTitle').value.trim(), body = fq('#neBody').value.replace(/\s+$/, '');
  if (!title && !body) { if (nEditing) S().notes = S().notes.filter(x => x !== nEditing); save(); J.closeSheet(); render(); return; }
  if (nEditing) Object.assign(nEditing, {title, body, color:nColor, pinned:nPinned, updated:Date.now()});
  else S().notes.push({id:uid(), title, body, color:nColor, pinned:nPinned, created:Date.now(), updated:Date.now()});
  J.haptic(); save(); J.closeSheet(); render();
}
let jDay = null, jMood = null, jEnergy = null;
function openJournal(day){
  jDay = day || today();
  const e = S().journal[jDay] || {};
  fq('#jTitle').textContent = jDay === today() ? 'JOURNAL DU JOUR' : parseDk(jDay).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}).toUpperCase();
  jMood = e.mood ?? null; jEnergy = e.energy ?? null;
  $$('#jMood button', fixed).forEach(b => b.classList.toggle('on', +b.dataset.m === jMood));
  $$('#jEnergy button', fixed).forEach(b => b.classList.toggle('on', jEnergy !== null && +b.dataset.e <= jEnergy));
  const g = e.grat || [];
  fq('#jG1').value = g[0] || ''; fq('#jG2').value = g[1] || ''; fq('#jG3').value = g[2] || '';
  fq('#jGood').value = e.good || ''; fq('#jBetter').value = e.better || ''; fq('#jFree').value = e.free || '';
  fq('#jPromptL').textContent = ('NOTES LIBRES · ' + PROMPTS[parseDk(jDay).getDate() % PROMPTS.length]).toUpperCase();
  fq('#jDel').hidden = !S().journal[jDay];
  J.openSheet(fq('#nbJour'));
}
function saveJournal(){
  const e = {grat:[fq('#jG1').value.trim(), fq('#jG2').value.trim(), fq('#jG3').value.trim()], good:fq('#jGood').value.trim(), better:fq('#jBetter').value.trim(), free:fq('#jFree').value.trim(), at:Date.now()};
  if (jMood !== null) e.mood = jMood; if (jEnergy !== null) e.energy = jEnergy;
  if (jMood === null && !e.good && !e.better && !e.free && !e.grat.some(Boolean)) { J.toast('Choisissez au moins une humeur'); return; }
  S().journal[jDay] = e; J.haptic(); save(); J.closeSheet(); render();
  const js = journalStats();
  J.say(jDay === today() ? `Entrée enregistrée.${js.streak > 1 ? ` Cela fait ${js.streak} jours d'affilée.` : ''} Bonne soirée.` : 'Entrée enregistrée.');
}

function bind(){
  root.addEventListener('click', e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { J.haptic(); tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const n = e.target.closest('[data-note]'); if (n) { openNote(S().notes.find(x => x.id === n.dataset.note)); return; }
    if (e.target.closest('[data-a="write"]')) return openJournal();
    const d = e.target.closest('[data-day]'); if (d) return openJournal(d.dataset.day);
  });
  root.addEventListener('input', e => {
    if (e.target.id !== 'nbQ') return;
    query = e.target.value; const pos = e.target.selectionStart; render(); const i = q('#nbQ'); i.focus(); i.setSelectionRange(pos, pos);
  });
  fq('#nbAdd').addEventListener('click', () => { J.haptic(); openNote(); });
  fq('#neColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { nColor = b.dataset.c; paintNote(); J.haptic(); } });
  fq('#nePin').addEventListener('click', () => { nPinned = !nPinned; paintNote(); J.haptic(); });
  fq('#neChk').addEventListener('click', () => {
    const ta = fq('#neBody'), pos = ta.selectionStart, before = ta.value.slice(0, pos), after = ta.value.slice(pos);
    const ins = (before && !before.endsWith('\n') ? '\n' : '') + '- [ ] ';
    ta.value = before + ins + after; ta.focus(); ta.setSelectionRange(pos + ins.length, pos + ins.length);
  });
  /* Entrée après une case à cocher : nouvelle case automatiquement */
  fq('#neBody').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const ta = e.target, pos = ta.selectionStart, line = ta.value.slice(0, pos).split('\n').pop();
    if (/^\s*[-*]\s\[( |x)\]\s?$/i.test(line)) { e.preventDefault(); ta.value = ta.value.slice(0, pos - line.length) + ta.value.slice(pos); ta.setSelectionRange(pos - line.length, pos - line.length); return; }
    if (/^\s*[-*]\s\[( |x)\]\s/i.test(line)) { e.preventDefault(); const ins = '\n- [ ] '; ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(pos); ta.setSelectionRange(pos + ins.length, pos + ins.length); }
  });
  fq('#neSave').addEventListener('click', saveNote);
  fq('#neDel').addEventListener('click', () => {
    const snap = JSON.stringify(S().notes), n = nEditing;
    S().notes = S().notes.filter(x => x !== n); save(); J.closeSheet(); render();
    J.toast('Note supprimée', {action:'ANNULER', onAction:() => { S().notes = JSON.parse(snap); save(); render(); }});
  });
  fq('#jMood').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; jMood = +b.dataset.m; $$('#jMood button', fixed).forEach(x => x.classList.toggle('on', x === b)); J.haptic(); });
  fq('#jEnergy').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; jEnergy = +b.dataset.e; $$('#jEnergy button', fixed).forEach(x => x.classList.toggle('on', +x.dataset.e <= jEnergy)); J.haptic(); });
  fq('#jSave').addEventListener('click', saveJournal);
  fq('#jDel').addEventListener('click', () => {
    const snap = JSON.stringify(S().journal), d = jDay;
    delete S().journal[d]; save(); J.closeSheet(); render();
    J.toast('Entrée supprimée', {action:'ANNULER', onAction:() => { S().journal = JSON.parse(snap); save(); render(); }});
  });
}

/* ---------- Jarvis qui discute ---------- */
J.actions = J.actions || {};
J.actions.add_note = a => {
  const title = String(a.title || '').slice(0, 80), body = String(a.text || a.body || '').slice(0, 4000);
  if (!title && !body) throw new Error('note vide');
  S().notes.push({id:uid(), title, body, color:'', pinned:false, created:Date.now(), updated:Date.now()}); save(); render();
  return {text:`Note : ${title || body.slice(0, 40)}`, go:'notes'};
};

/* ---------- déclaration ---------- */
J.module({
  id: 'notes',
  code: '07',
  order: 30,
  name: 'Notes',
  short: 'Notes',
  tagline: 'Notes rapides et journal du soir',
  accent: '#ff5f8f',
  cls: 'nb',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 12h8M8 16h5"/></svg>',

  init(){ st = J.store('notes', DEFAULTS); st.onChange(() => render()); },
  summary(){ return `${S().notes.length} notes`; },
  stat(){
    const h = new Date().getHours(), t = S().journal[today()], js = journalStats();
    if (h >= 18 && !t) return {label:'JOURNAL', value:'<small>À écrire</small>', sub:'Comment s\'est passée ta journée ?'};
    if (t) return {label:'JOURNAL', value:t.mood !== undefined ? MOODS[t.mood].e + '<small> ' + MOODS[t.mood].n + '</small>' : '✓', sub:js.streak > 1 ? `🔥 ${js.streak} jours d'affilée` : 'rempli aujourd\'hui'};
    return null;
  },
  brief(){ return ''; },
  report(){ return status(); },
  chat(){
    const js = journalStats(), t = S().journal[today()];
    const notes = [...S().notes].sort((a, b) => b.updated - a.updated).slice(0, 10).map(n => (n.title || n.body.split('\n')[0]).slice(0, 50) + (n.body ? ' : ' + n.body.replace(/\n/g, ' / ').slice(0, 120) : ''));
    return `NOTES récentes : ${notes.join(' | ') || 'aucune'}. JOURNAL : ${t ? 'rempli aujourd\'hui' + (t.mood !== undefined ? ' (humeur ' + MOODS[t.mood].n + ')' : '') : 'pas encore rempli aujourd\'hui'} ; série ${js.streak} j${js.avg !== null ? ', humeur moyenne 30 j ' + (js.avg + 1).toFixed(1) + '/5' : ''}.`;
  },
  reminders(){
    const out = [];
    for (let i = 0; i < 3; i++) { const k = addDays(today(), i); out.push({id:'journal-' + k, kind:'journal', date:k, time:'21:30', title:'✍️ Journal du soir', body:'Deux minutes pour faire le point sur ta journée ?', url:'#/notes', skipIf:() => !!S().journal[k]}); }
    return out;
  },

  mount(body, fx){ root = body; fixed = fx; root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED; bind(); render(); J.say(status()); },
  onShow(){ render(); J.say(status()); },
  unmount(){ root = null; fixed = null; },
});
})();
