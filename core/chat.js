/* ============================================================
   J.A.R.V.I.S. — conversation
   Tu écris ou tu dictes, Jarvis répond et agit dans les modules.
   Le serveur interroge une IA gratuite (Workers AI) avec un résumé
   des modules ; les actions renvoyées sont exécutées ici (J.actions).
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, ls} = J;
const SUGG = [
  "Qu'est-ce que j'ai aujourd'hui ?",
  "J'ai dépensé 12 € au resto",
  'Rappelle-moi demain à 18h d\'appeler le garage',
  "J'ai mangé 150 g de poulet et 200 g de riz",
  'Combien il me reste ce mois-ci ?',
  'Fais-moi le bilan de ma semaine',
];
const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');

let msgs = [], busy = false, viaVoice = false;
const key = () => 'jarvis.chat.' + ((J.user() || {}).username || '').toLowerCase();
const load = () => { msgs = ls.get(key()) || []; };
const persist = () => ls.set(key(), msgs.slice(-40));

/* contexte envoyé à l'IA : le détail des seuls modules concernés par la question (moins de jetons = quota qui dure
   plus longtemps), et une ligne d'aperçu pour les autres */
const TOPICS = {
  finances: /€|euros?\b|reste|combien|mois\b|balles|d[ée]pens|pay[ée]|achet|budget|solde|argent|compte|salaire|revenu|virement|factur|loyer|[ée]pargn|abonnement|co[uû]t|prix|fric|thune|banque|essence|courses/i,
  nutrition: /reste|combien|mang|repas|calor|kcal|prot[ée]in|glucide|lipide|macro|d[ée]j|d[îi]ner|go[uû]ter|collation|\d\s?g\b|grammes?|poids|pes[ée]|kilos?\b|faim|aliment|whey|riz|p[âa]tes|poulet|cuit|cru\b|bu\b|boire/i,
  muscu: /muscu|s[ée]ance|salle|sport|entra[iî]n|exercice|d[ée]velopp|squat|pompes|halt[èe]re|record|routine|push|pull|legs?\b|s[ée]ries?\b/i,
  taches: /t[âa]che|rappel|faire|todo|agenda|rdv|rendez|r[ée]union|appel|demain|planning|deadline|terminer|fini/i,
  habitudes: /habitude|s[ée]rie|streak|m[ée]dit|lecture|\beau\b|valid/i,
  notes: /note|journal|humeur|id[ée]e|liste|gratitude|[ée]cri/i,
  social: /d[ée]fi|classement|amis?\b|potes?|copains?|qui (a|est)|premier|gagn|battu|concours/i,
  sante: /\bpas\b|marche|march[ée]|[ée]nergie|activit|sant[ée]|bouger|apple/i,
};
const GENERAL = /aujourd'?hui|journ[ée]e|bilan|r[ée]sum|quoi de neuf|programme|le point|semaine|conseil|qu'?est-ce que j'?ai|briefing|tout\b|pr[ée]vu/i;
const METEO = /m[ée]t[ée]o|pluie|pleu|temps qu|parapluie|froid|chaud|soleil|temp[ée]rature|sortir|v[ée]lo|veste/i;
let lastTopics = [];
function context(text = ''){
  const mods = J.modules.filter(m => !m.soon && m.chat);
  let want = GENERAL.test(text) ? mods.map(m => m.id) : mods.filter(m => TOPICS[m.id] && TOPICS[m.id].test(text)).map(m => m.id);
  const asked = /\?\s*$/.test(((msgs.filter(m => m.role === 'assistant').slice(-1)[0]) || {}).content || '');
  if (!want.length && asked) want = lastTopics;   // réponse à une question de Jarvis (« cuit », « demain 19h ») : même sujet qu'avant
  lastTopics = want;
  const parts = [];
  mods.forEach(m => {
    try {
      if (want.includes(m.id)) { const t = m.chat(); if (t) parts.push(t); return; }
      const st = m.stat && m.stat();   // aperçu : une ligne
      if (st && st.value) parts.push(`${m.name.toUpperCase()} (aperçu) : ${String(st.label || '').toLowerCase()} ${st.value}${st.sub ? ', ' + st.sub : ''}`.replace(/<[^>]+>/g, ''));
    } catch(e) { J.report(m.id + '.chat : ' + e); }
  });
  try { const m = J.memoryText ? J.memoryText() : ''; if (m) parts.unshift('MÉMOIRE (ce que l\'utilisateur t\'a demandé de retenir, à utiliser pour personnaliser) : ' + m); } catch(e) {}
  try { const ins = J.insights ? J.insights().slice(0, 6) : []; if (ins.length) parts.push('OBSERVATIONS DE JARVIS (à mentionner si pertinent) : ' + ins.map(x => x.text).join(' | ')); } catch(e) {}
  if (want.length === mods.length || METEO.test(text)) try { const w = J.weatherText && J.weatherText(); if (w) parts.push('MÉTÉO : ' + w); } catch(e) {}
  // montants à la française (sinon l'IA recopie « 2422.9 € » et la voix le lit mal)
  const eur = n => n.toLocaleString('fr-FR', {minimumFractionDigits:n % 1 ? 2 : 0, maximumFractionDigits:2}) + ' €';
  return parts.join('\n').replace(/(-?\d+(?:\.\d+)?)\s?€/g, (_, n) => eur(+n)).replace(/(\d)\.(\d)/g, '$1,$2');
}
function calendar(){
  const out = [];
  for (let i = -1; i <= 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); out.push(`${i === -1 ? 'hier' : i === 0 ? "aujourd'hui" : i === 1 ? 'demain' : WD[d.getDay()]} = ${dk(d)}`); }
  return out.join(', ');
}

/* ---------- rendu ---------- */
function bubble(m){
  if (m.role === 'user') return `<div class="cm u"><div class="cb">${esc(m.content)}</div></div>`;
  const acts = (m.acts || []).map(a => `<button class="ca ${a.ok ? '' : 'ko'}" ${a.go ? `data-go="${a.go}"` : ''}>${a.ok ? '✓' : '⚠'} ${esc(a.text)}${a.go ? ' ›' : ''}</button>`).join('');
  return `<div class="cm j"><span class="cav"></span><div><div class="cb">${esc(m.content)}</div>${acts ? `<div class="cas">${acts}</div>` : ''}</div></div>`;
}
function render(){
  const box = $('#chatMsgs');
  box.innerHTML = (msgs.length ? msgs.map(bubble).join('') : `<div class="cwelcome"><div class="cw-r"></div><b>${esc(J.greeting())}</b><p>Écrivez-moi ou dictez : une dépense, un repas, une tâche, une question sur votre journée… je m'en occupe.</p></div>`) +
    (busy ? '<div class="cm j"><span class="cav"></span><div class="cb cb-typing"><i></i><i></i><i></i></div></div>' : '');
  $('#chatSugg').innerHTML = (msgs.length > 2 ? SUGG.slice(0, 3) : SUGG).map(s => `<button data-s="${esc(s)}">${esc(s)}</button>`).join('');
  stick = true; requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

/* ---------- envoi ---------- */
/* réponse partielle : le texte de "reply" déjà reçu (le JSON arrive morceau par morceau) */
function partialReply(raw){
  const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return '';
  try { return JSON.parse('"' + m[1].replace(/\\u[0-9a-fA-F]{0,3}$/, '') + '"'); } catch(e) { return m[1].replace(/\\n/g, ' ').replace(/\\(.)/g, '$1'); }
}
function finalReply(raw){
  let r = null;
  raw = raw.replace(/\\'/g, "'");   // échappement invalide parfois produit par l'IA (C\'est)
  try { r = JSON.parse(raw); } catch(e) { try { r = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch(e2) {} }
  if (!r || typeof r !== 'object') return {reply:partialReply(raw), actions:[]};
  return {reply:String(r.reply || ''), actions:Array.isArray(r.actions) ? r.actions.filter(a => a && typeof a.type === 'string').slice(0, 8) : []};
}
async function stream(payload, onText){
  let res;
  try {
    res = await fetch(J.API + '/api/chat?stream', {method:'POST', cache:'no-store',
      headers:{'Content-Type':'application/json', Authorization:'Bearer ' + J.token()}, body:JSON.stringify(payload)});
  } catch(e) { const err = new Error('Liaison interrompue avec le serveur.'); throw err; }
  if (!res.ok) { let out = {}; try { out = await res.json(); } catch(e) {} const err = new Error(out.error || 'Erreur ' + res.status); err.status = res.status; throw err; }
  if (!res.body || !res.body.getReader) return finalReply(await res.text());
  const rd = res.body.getReader(), dec = new TextDecoder();
  let raw = '', shown = '';
  for (;;) {
    const {done, value} = await rd.read();
    if (done) break;
    raw += dec.decode(value, {stream:true});
    const t = partialReply(raw);
    if (t && t !== shown) { shown = t; onText(t); }
  }
  return finalReply(raw);
}
/* bulle de Jarvis en cours d'écriture (feuille de conversation) */
function liveBubble(t){
  let b = $('#chatMsgs .cm.live .cb');
  if (!b) { const ty = $('#chatMsgs .cb-typing'); if (ty) ty.closest('.cm').remove(); $('#chatMsgs').insertAdjacentHTML('beforeend', '<div class="cm j live"><span class="cav"></span><div><div class="cb"></div></div></div>'); b = $('#chatMsgs .cm.live .cb'); }
  b.textContent = t; toBottom();
}

async function send(text, opts = {}){
  text = String(text || '').trim();
  if (!text || busy) return;
  if (!msgs.length) load();
  const voice = viaVoice || !!opts.voice, fromHub = opts.from === 'hub'; viaVoice = false;
  msgs.push({role:'user', content:text}); busy = true; persist();
  if (fromHub) { $('#hubReactor').classList.add('thinking'); J.say('…'); $('#hubActs').innerHTML = ''; }
  else { render(); $('#chatIn').value = ''; autosize(); }
  let briefing = false;
  let reply = '', acts = [], asks = [];
  try {
    const now = new Date();
    const payload = {
      // les actions déjà faites sont rappelées à l'IA, sinon elle les refait en répondant à la question suivante
      messages:msgs.slice(-10).map(m => ({role:m.role, content:m.content + ((m.acts || []).some(a => a.ok) ? ` [déjà fait : ${m.acts.filter(a => a.ok).map(a => a.text).join(' ; ')}]` : '')})),
      context:context(text), name:(J.prefs() || {}).name || 'Monsieur', calendar:calendar(),
      now:`${WD[now.getDay()]} ${now.toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'})}, ${now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}`,
    };
    // la réponse s'affiche mot à mot pendant que l'IA l'écrit
    const live = t => { if (fromHub) J.say(t, true); else liveBubble(t); };
    const r = await stream(payload, live);
    reply = (r.reply || '').trim().length > 3 ? r.reply.trim() : '';   // l'IA renvoie parfois une réponse tronquée (« C »)
    // ce que l'utilisateur vient de dire (dernière question + réponse) : les actions y vérifient une précision (« cuit », « cru »…)
    J.chatRecentText = msgs.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
    // garde-fou : une action déjà faite plus haut dans la conversation n'est pas refaite,
    // sauf si le dernier message en reparle (« encore 200 g de riz »)
    const mainOf = a => norm(String(a.food || a.label || a.title || a.name || '')).split(/\s+/)[0];
    const sigOf = a => [a.type, mainOf(a), a.grams || a.portions || a.amount || a.kg || '', a.due || ''].join('|');
    const done = new Set(msgs.slice(-12).flatMap(m => (m.acts || []).filter(x => x.ok && x.sig).map(x => x.sig)));
    const said = norm(text); let skipped = 0;
    // « annuler » : on photographie les données que les actions vont modifier
    const snaps = {};
    (r.actions || []).forEach(a => { const id = STORE_OF[a.type]; if (id && !snaps[id]) snaps[id] = JSON.stringify(J.store(id, {}).data); });
    for (const a of r.actions || []) {
      const sig = sigOf(a), main = mainOf(a);
      if (done.has(sig) && !(main && said.includes(main))) { skipped++; continue; }
      if (a.type === 'briefing') { briefing = true; continue; }
      if (a.type === 'open') { if (J.modules.some(m => m.id === a.module)) acts.push({ok:true, text:'Ouvrir ' + J.modules.find(m => m.id === a.module).name, go:a.module}); continue; }
      const fn = J.actions && J.actions[a.type];
      if (!fn) continue;
      try { const res = await fn(a); acts.push({ok:true, text:res.text || res, go:res.go, sig}); }
      catch(e) { if (e.ask) asks.push(e.ask); else acts.push({ok:false, text:e.message}); }
    }
    // une information manque : Jarvis pose la question au lieu d'annoncer une action qui n'a pas eu lieu
    if (acts.some(x => x.ok) && Object.keys(snaps).length && !(r.actions || []).some(a => a.type === 'undo')) lastUndo = {snaps, label:acts.filter(x => x.ok).map(x => x.text).join(' · ')};
    if (asks.length) reply = (acts.some(x => x.ok) ? 'C\'est noté pour le reste. ' : '') + asks.join(' ');
    if (!reply) reply = acts.length ? 'C\'est fait.' : 'Je n\'ai pas bien compris, pouvez-vous reformuler ?';
    // garde-fou : jamais « c'est noté » si rien n'a été enregistré (l'IA de secours l'annonce parfois sans créer l'action)
    else if (!acts.some(a => a.ok) && !asks.length && !briefing && !skipped && /^\s*(c'est (not[ée]|fait)|fait\b|not[ée]\b|entendu, c'est)|j'ai (bien )?(ajout|enregistr|not|programm|cr[ée]|plac)[ée]|je vous rappellerai|(a|ont) été (ajout|enregistr|programm)[ée]/i.test(reply))
      reply = 'Je n\'ai rien pu enregistrer cette fois. Pouvez-vous me redire la demande en une phrase complète ?';
    if (acts.some(a => a.ok)) J.haptic();
  } catch(e) {
    reply = e.status === 429 ? 'Nous avons beaucoup discuté aujourd\'hui : le quota gratuit de l\'IA est atteint. Revenons-en demain.' : (e.message || 'Liaison interrompue avec le serveur.');
  }
  busy = false; delete J.chatRecentText;
  if (briefing) { reply = J.briefingSpeech(); }
  msgs.push({role:'assistant', content:reply, acts}); persist();
  if (fromHub) {
    $('#hubReactor').classList.remove('thinking');
    J.say(reply, 'final');
    $('#hubActs').innerHTML = acts.map(a => `<button class="ca ${a.ok ? '' : 'ko'}" ${a.go ? `data-go="${a.go}"` : ''}>${a.ok ? '✓' : '⚠'} ${esc(a.text)}${a.go ? ' ›' : ''}</button>`).join('') + (lastUndo && acts.some(a => a.ok && a.text !== 'Annulé') ? '<button class="ca undo" data-undo>↶ Annuler</button>' : '');
    $('#hubConv').hidden = false;
    if (J.renderBriefing) J.renderBriefing();
  } else render();
  if (voice || briefing) {
    const spoken = J.speak(reply);
    if (voice && fromHub && /\?\s*$/.test(reply) && !briefing) spoken.then(() => { if (!J.sheetOpen() && $('#hub').classList.contains('active')) setTimeout(hubListen, 250); });
  }
}
J.ask = send;
J.chatCalendar = calendar;
/* demande faite hors de l'app (Siri, Centre de contrôle, bouton Action) : la réponse a déjà été dite,
   on applique les actions et on range l'échange dans la conversation */
J.applyRemote = async (item) => {
  if (!item || !item.text) return;
  if (!msgs.length) load();
  const acts = [], asks = [];
  J.chatRecentText = item.text;
  for (const a of item.actions || []) {
    if (a.type === 'briefing' || a.type === 'open') continue;
    const fn = J.actions && J.actions[a.type]; if (!fn) continue;
    try { const res = await fn(a); acts.push({ok:true, text:res.text || res, go:res.go}); }
    catch(e) { if (e.ask) asks.push(e.ask); else acts.push({ok:false, text:e.message}); }
  }
  delete J.chatRecentText;
  msgs.push({role:'user', content:item.text});
  msgs.push({role:'assistant', content:asks.length ? asks.join(' ') : item.reply, acts});
  persist();
  if (document.querySelector('.sheet.chat.show')) render();
  if (acts.some(a => a.ok)) J.toast('Via Siri · ' + acts.filter(a => a.ok).map(a => a.text).join(' · '));
  if (asks.length) J.toast('Jarvis a une question : ' + asks[0], {action:'RÉPONDRE', onAction:() => J.openChat && J.openChat()});
  if (J.renderBriefing) J.renderBriefing();
};

/* ---------- annuler la dernière action ---------- */
const STORE_OF = {add_expense:'finances', add_income:'finances', log_food:'nutrition', log_weight:'nutrition', add_task:'taches', complete_task:'taches',
  reschedule_overdue:'taches', log_habit:'habitudes', add_note:'notes', remember:'memory', forget:'memory'};
let lastUndo = null;
function undo(){
  if (!lastUndo) throw Object.assign(new Error('rien à annuler'), {ask:'Il n\'y a rien à annuler pour le moment.'});
  const u = lastUndo; lastUndo = null;
  Object.entries(u.snaps).forEach(([id, json]) => { const st = J.store(id, {}); st.data = JSON.parse(json); st.save(); st.listeners.forEach(f => { try { f(st.data); } catch(e) {} }); });
  const cur = J.modules.find(m => document.getElementById('mv-' + m.id) && document.getElementById('mv-' + m.id).classList.contains('active'));
  try { if (cur && cur.onShow) cur.onShow(); } catch(e) {}
  if (J.renderBriefing) J.renderBriefing();
  J.haptic('warning');
  return {text:'Annulé : ' + u.label};
}
J.actions = J.actions || {};
J.actions.undo = () => undo();
document.addEventListener('click', e => {
  if (!e.target.closest('[data-undo]')) return;
  try { const r = undo(); J.toast(r.text); e.target.closest('[data-undo]').remove(); } catch(err) { J.toast(err.ask || err.message); }
});

/* ---------- mémoire : ce que l'utilisateur demande à Jarvis de retenir ---------- */
const mem = () => J.store('memory', {facts:[]});
J.actions.remember = a => {
  const fact = String(a.fact || '').trim().replace(/\s+/g, ' ').slice(0, 220);
  if (!fact) throw Object.assign(new Error('?'), {ask:'Que dois-je retenir ?'});
  const st = mem(), f = st.data.facts = st.data.facts || [];
  if (!f.some(x => norm(x.t) === norm(fact))) f.push({t:fact, at:Date.now()});
  st.data.facts = f.slice(-60); st.save(); renderMemory();
  return {text:'Mémorisé : ' + fact};
};
J.actions.forget = a => {
  const words = norm(a.fact || '').split(/\s+/).filter(w => w.length > 2), st = mem(), f = st.data.facts || [];
  const keep = f.filter(x => !words.length || words.filter(w => norm(x.t).includes(w)).length < Math.max(1, Math.ceil(words.length / 2)));
  if (keep.length === f.length) throw Object.assign(new Error('?'), {ask:`Je n'ai rien en mémoire sur « ${a.fact} ».`});
  st.data.facts = keep; st.save(); renderMemory();
  return {text:`Oublié (${f.length - keep.length})`};
};
J.memoryText = () => (mem().data.facts || []).map(x => x.t).join(' ; ');
function renderMemory(){
  const box = document.getElementById('sMemory'); if (!box) return;
  const f = mem().data.facts || [];
  box.innerHTML = f.length ? f.map((x, i) => `<div class="memrow"><span>${esc(x.t)}</span><button data-memdel="${i}" aria-label="Oublier">✕</button></div>`).join('')
    : '<p class="note">Dites « retiens que… » à Jarvis : il s\'en souviendra dans toutes vos conversations.</p>';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-memdel]'); if (!b) return;
  const st = mem(); st.data.facts.splice(+b.dataset.memdel, 1); st.save(); renderMemory(); J.haptic();
});
J.renderMemory = renderMemory;

/* ---------- minuteurs : « minuteur 12 minutes pour les pâtes » ---------- */
const TKEY = 'jarvis.timers';
J.timers = () => (ls.get(TKEY) || []).filter(t => t.at > Date.now() - 5000);
J.actions.timer = a => {
  const min = parseFloat(String(a.minutes ?? '').replace(',', '.')), sec = parseFloat(String(a.seconds ?? '').replace(',', '.'));
  const ms = (min > 0 ? min * 60 : 0) * 1000 + (sec > 0 ? sec * 1000 : 0);
  if (!(ms >= 5000 && ms <= 24 * 3600e3)) throw Object.assign(new Error('?'), {ask:'Pour combien de temps, le minuteur ?'});
  const label = String(a.label || 'Minuteur').trim().slice(0, 40) || 'Minuteur';
  const t = {id:Date.now().toString(36), at:Date.now() + ms, label};
  ls.set(TKEY, [...J.timers(), t]);
  armTimers(); if (J.scheduleNotifs) J.scheduleNotifs();
  if (J.notifPrompt) J.notifPrompt('Pour être prévenu même app fermée,');
  const m = Math.round(ms / 60000);
  return {text:`Minuteur ${label === 'Minuteur' ? '' : label + ' '}· ${m >= 1 ? m + ' min' : Math.round(ms / 1000) + ' s'}`};
};
let timerT = 0, tickT = 0;
function armTimers(){
  clearTimeout(timerT); clearInterval(tickT);
  const list = J.timers().sort((a, b) => a.at - b.at);
  renderTimers();
  if (!list.length) return;
  tickT = setInterval(renderTimers, 1000);
  timerT = setTimeout(() => {
    const due = J.timers().filter(t => t.at <= Date.now() + 500);
    ls.set(TKEY, J.timers().filter(t => t.at > Date.now() + 500));
    due.forEach(t => { J.toast(`⏱ ${t.label} : c'est l'heure.`); J.haptic('success'); if (J.speak) J.speak(`${t.label === 'Minuteur' ? 'Le minuteur est' : t.label + ' : le minuteur est'} terminé.`); });
    armTimers();
  }, Math.max(0, list[0].at - Date.now()));
}
function renderTimers(){
  const box = document.getElementById('hubTimers'); if (!box) return;
  const list = J.timers().filter(t => t.at > Date.now()).sort((a, b) => a.at - b.at);
  const mmss = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  box.innerHTML = list.map(t => `<button class="tmr" data-tmr="${t.id}"><b>${mmss(t.at - Date.now())}</b>${esc(t.label)}<i>✕</i></button>`).join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tmr]'); if (!b) return;
  ls.set(TKEY, J.timers().filter(t => t.id !== b.dataset.tmr)); J.haptic(); armTimers(); if (J.scheduleNotifs) J.scheduleNotifs();
});
setTimeout(armTimers, 1500);
J.chatContext = context;   // diagnostic : ce qui part vers l'IA

/* la liste des messages reste collée en bas quand la feuille change de taille (clavier) ou qu'un message arrive,
   sauf si l'utilisateur est remonté lire l'historique */
const box = $('#chatMsgs'); let stick = true;
box.addEventListener('scroll', () => { stick = box.scrollTop >= box.scrollHeight - box.clientHeight - 60; }, {passive:true});
const toBottom = () => { if (stick) box.scrollTop = box.scrollHeight; };
if ('ResizeObserver' in window) new ResizeObserver(toBottom).observe(box);
// filet de sécurité : quand le clavier change la taille de la zone visible, on recolle en bas (après l'animation)
if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (J.sheetOpen()) { toBottom(); setTimeout(toBottom, 120); setTimeout(toBottom, 400); } });
J._chatStick = () => stick;

/* ---------- accueil : barre de saisie et réacteur ---------- */
$('#hubAskF').addEventListener('submit', e => { e.preventDefault(); const v = $('#hubAsk').value; $('#hubAsk').value = ''; $('#hubAsk').blur(); send(v, {from:'hub'}); });
$('#hubActs').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { J.haptic(); J.go(b.dataset.go); } });
let hubRec = null;
function hubListen(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#hubAsk').focus(); J.toast('Dictée : utilisez le micro du clavier'); return; }   // l'app installée peut ne pas avoir la reconnaissance vocale
  if (hubRec) { hubRec.stop(); return; }
  const r = $('#hubReactor'), time = $('#hubTime'), hint = $('#hubHint');
  hubRec = new SR(); hubRec.lang = 'fr-FR'; hubRec.interimResults = true;
  let heard = '';
  r.classList.add('listening'); time.textContent = 'ÉCOUTE'; hint.textContent = 'TOUCHER POUR ARRÊTER'; J.haptic(); J.say('Je vous écoute…');
  hubRec.onresult = e => { heard = [...e.results].map(x => x[0].transcript).join(' '); J.say('« ' + heard + ' »'); };
  hubRec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { J.toast('Micro indisponible : utilisez le micro du clavier'); $('#hubAsk').focus(); } };
  hubRec.onend = () => {
    hubRec = null; r.classList.remove('listening'); hint.textContent = 'TOUCHER POUR PARLER';
    time.textContent = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
    if (heard.trim()) send(heard, {from:'hub', voice:true}); else J.say('Je n\'ai rien entendu. Touchez le réacteur et parlez.');
  };
  try { hubRec.start(); } catch(e) { hubRec = null; r.classList.remove('listening'); $('#hubAsk').focus(); }
}
/* toucher = parler ; appui long (0,5 s) = briefing vocal */
(() => {
  const r = $('#hubReactor'); let t = 0, long = false;
  r.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; J.haptic(); const txt = J.briefingSpeech(); J.say(txt); J.speak(txt); }, 500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => r.addEventListener(ev, () => clearTimeout(t)));
  r.addEventListener('click', () => { if (long) return; hubListen(); });
  r.addEventListener('contextmenu', e => e.preventDefault());
})();

/* ---------- dictée ---------- */
let rec = null;
function dictate(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = true;
  const btn = $('#chatMic'); btn.classList.add('on'); J.haptic();
  rec.onresult = e => { $('#chatIn').value = [...e.results].map(r => r[0].transcript).join(' '); autosize(); };
  rec.onerror = e => { if (e.error !== 'aborted') J.toast(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans Réglages' : 'Dictée indisponible'); };
  rec.onend = () => { btn.classList.remove('on'); rec = null; if ($('#chatIn').value.trim()) { viaVoice = true; send($('#chatIn').value); } };
  try { rec.start(); } catch(e) { btn.classList.remove('on'); rec = null; }
}
function autosize(){ const t = $('#chatIn'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }

J.openChat = (prefill) => {
  load(); render();
  $('#hubConv').hidden = true;
  J.openSheet($('#chat'));
  if (prefill) { $('#chatIn').value = prefill; autosize(); }
};

/* ---------- branchements ---------- */
$('#chatSend').addEventListener('click', () => send($('#chatIn').value));
if (!msgs.length) load();
$('#chatIn').addEventListener('input', autosize);
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#chatIn').value); } });
$('#chatSugg').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { J.haptic(); send(b.dataset.s); } });
$('#chatMsgs').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { J.haptic(); J.closeSheet(); setTimeout(() => J.go(b.dataset.go), 150); } });
$('#chatClear').addEventListener('click', () => { msgs = []; persist(); render(); J.haptic(); });
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) $('#chatMic').addEventListener('click', dictate); else $('#chatMic').hidden = true;
document.addEventListener('click', e => { if (e.target.closest('[data-a="chat"]')) { J.haptic(); J.openChat(); } });
})();
