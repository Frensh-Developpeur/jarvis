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
const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');

let msgs = [], busy = false, viaVoice = false;
const key = () => 'jarvis.chat.' + ((J.user() || {}).username || '').toLowerCase();
const load = () => { msgs = ls.get(key()) || []; };
const persist = () => ls.set(key(), msgs.slice(-40));

/* résumé de tous les modules envoyé à l'IA */
function context(){
  const parts = [];
  J.modules.filter(m => !m.soon && m.chat).forEach(m => { try { const t = m.chat(); if (t) parts.push(t); } catch(e) { J.report(m.id + '.chat : ' + e); } });
  try { const w = J.weatherText && J.weatherText(); if (w) parts.push('MÉTÉO : ' + w); } catch(e) {}
  return parts.join('\n');
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
    (busy ? '<div class="cm j"><span class="cav"></span><div class="cb typing"><i></i><i></i><i></i></div></div>' : '');
  $('#chatSugg').innerHTML = (msgs.length > 2 ? SUGG.slice(0, 3) : SUGG).map(s => `<button data-s="${esc(s)}">${esc(s)}</button>`).join('');
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

/* ---------- envoi ---------- */
async function send(text){
  text = String(text || '').trim();
  if (!text || busy) return;
  const voice = viaVoice; viaVoice = false;
  msgs.push({role:'user', content:text}); busy = true; render(); persist();
  $('#chatIn').value = ''; autosize();
  let reply = '', acts = [];
  try {
    const now = new Date();
    const r = await J.api('POST', '/api/chat', {
      messages:msgs.slice(-10).map(m => ({role:m.role, content:m.content})),
      context:context(), name:(J.prefs() || {}).name || 'Monsieur', calendar:calendar(),
      now:`${WD[now.getDay()]} ${now.toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'})}, ${now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}`,
    });
    reply = r.reply || '';
    for (const a of r.actions || []) {
      if (a.type === 'open') { if (J.modules.some(m => m.id === a.module)) acts.push({ok:true, text:'Ouvrir ' + J.modules.find(m => m.id === a.module).name, go:a.module}); continue; }
      const fn = J.actions && J.actions[a.type];
      if (!fn) continue;
      try { const res = await fn(a); acts.push({ok:true, text:res.text || res, go:res.go}); }
      catch(e) { acts.push({ok:false, text:e.message}); }
    }
    if (!reply) reply = acts.length ? 'C\'est fait.' : 'Je n\'ai pas bien compris, pouvez-vous reformuler ?';
    if (acts.some(a => a.ok)) J.haptic();
  } catch(e) {
    reply = e.status === 429 ? 'Nous avons beaucoup discuté aujourd\'hui : le quota gratuit de l\'IA est atteint. Revenons-en demain.' : (e.message || 'Liaison interrompue avec le serveur.');
  }
  busy = false;
  msgs.push({role:'assistant', content:reply, acts}); persist(); render();
  if (voice) J.speak(reply);
}

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
  J.openSheet($('#chat'));
  if (prefill) { $('#chatIn').value = prefill; autosize(); }
};

/* ---------- branchements ---------- */
$('#chatSend').addEventListener('click', () => send($('#chatIn').value));
$('#chatIn').addEventListener('input', autosize);
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#chatIn').value); } });
$('#chatSugg').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { J.haptic(); send(b.dataset.s); } });
$('#chatMsgs').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { J.haptic(); J.closeSheet(); setTimeout(() => J.go(b.dataset.go), 150); } });
$('#chatClear').addEventListener('click', () => { msgs = []; persist(); render(); J.haptic(); });
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) $('#chatMic').addEventListener('click', dictate); else $('#chatMic').hidden = true;
document.addEventListener('click', e => { if (e.target.closest('[data-a="chat"]')) { J.haptic(); J.openChat(); } });
})();
