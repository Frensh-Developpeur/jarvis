/* ============================================================
   J.A.R.V.I.S. — notifications push
   - abonnement de l'appareil (iOS 16.4+, app installée sur l'écran d'accueil)
   - planification : les modules exposent reminders() ; on envoie au serveur
     la liste des notifications des 7 prochains jours, il les déclenche à l'heure
   - catégories réglables : tâches, habitudes, journal, briefing du matin, pesée
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, ls} = J;
const DEFAULT_PREFS = {tasks:true, habits:true, journal:true, morning:'08:00', evening:'21:00', weigh:true, social:true, taskLead:15};
const prefsN = () => Object.assign({}, DEFAULT_PREFS, (J.prefs() || {}).notif || {});
const NAT = () => J.native;   // app iPhone : notifications locales programmées sur le téléphone
const supported = () => !!NAT() || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function subscription(){
  if (NAT()) return ls.get('jarvis.push') ? {native:true} : null;
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enable(){
  if (NAT()) {
    const st = await NAT().call('notify.authorize');
    if (st !== 'granted') { J.toast('Notifications refusées : Réglages iPhone › Notifications › Jarvis'); return false; }
    ls.set('jarvis.push', true); last = ''; await schedule(true); return true;
  }
  if (!supported()) { J.toast(standalone() ? 'Notifications non prises en charge : iOS 16.4 minimum' : 'Installez Jarvis sur l\'écran d\'accueil pour recevoir des notifications'); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { J.toast('Notifications refusées : Réglages iPhone › Notifications › Jarvis'); return false; }
  const reg = await navigator.serviceWorker.ready;
  const {key} = await J.api('GET', '/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64uToBytes(key)});
  await J.api('POST', '/api/push/subscribe', {subscription:sub.toJSON()});
  ls.set('jarvis.push', true);
  await schedule(true);
  return true;
}
async function disable(){
  if (NAT()) { await NAT().call('notify.clear'); ls.del('jarvis.push'); return; }
  const sub = await subscription();
  if (sub) { try { await J.api('POST', '/api/push/unsubscribe', {endpoint:sub.endpoint}); } catch(e) {} await sub.unsubscribe(); }
  ls.del('jarvis.push');
  try { await J.api('PUT', '/api/push/schedule', {items:[]}); } catch(e) {}
}

/* ---------- calcul des notifications à venir ---------- */
const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const atOf = (date, time) => { const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
function collect(){
  const p = prefsN(), now = Date.now(), horizon = now + 7 * 864e5, out = [];
  const add = (r) => { const at = r.at || atOf(r.date, r.time); if (at > now + 30e3 && at < horizon) out.push({nid:r.id, at, title:r.title, body:r.body || '', url:r.url || '#/'}); };
  J.modules.filter(m => !m.soon && m.reminders).forEach(m => {
    let list = []; try { list = m.reminders() || []; } catch(e) { J.report(m.id + '.reminders : ' + e); }
    list.forEach(r => {
      if (r.kind && p[r.kind] === false) return;
      try { if (r.skipIf && r.skipIf()) return; } catch(e) {}
      add(r);
    });
  });
  // briefing du matin : le programme réel de la journée (tâches, premier rendez-vous, séance conseillée)
  const name = (J.prefs() || {}).name || 'Monsieur';
  let tasksAll = []; try { tasksAll = J.store('taches', {tasks:[]}).data.tasks.filter(t => !t.done && t.due); } catch(e) {}
  if (p.morning) for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); const k = dk(d);
    const day = tasksAll.filter(t => t.due <= k), timed = tasksAll.filter(t => t.due === k && t.time).sort((a, b) => a.time.localeCompare(b.time));
    const parts = [];
    if (day.length) parts.push(`${day.length} tâche${day.length > 1 ? 's' : ''} au programme`);
    if (timed[0]) parts.push(`premier rendez-vous à ${timed[0].time.replace(':', 'h')} : ${timed[0].title}`);
    add({id:'morning-' + k, date:k, time:p.morning, title:`☀️ Bonjour ${name}`, body:(parts.length ? parts.join(', ') + '. ' : 'Journée libre pour l\'instant. ') + 'Touchez pour le briefing.', url:'#/'});
  }
  // bilan du soir (aujourd'hui : avec les chiffres du moment ; ils sont recalculés à chaque modification)
  if (p.evening) for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); const k = dk(d);
    let body = 'Faisons le point sur votre journée.';
    if (i === 0) {
      const w = {}; J.modules.forEach(m => { if (m.widget && !m.soon) try { Object.assign(w, m.widget()); } catch(e) {} });
      const bits = [];
      if (w.tasksLeft) bits.push(`${w.tasksLeft} tâche${w.tasksLeft > 1 ? 's' : ''} encore ouverte${w.tasksLeft > 1 ? 's' : ''}`);
      if (w.kcalGoal) bits.push(w.kcal ? `${Math.round(Math.max(0, w.kcalGoal - w.kcal)).toLocaleString('fr-FR')} kcal restantes` : 'aucun repas saisi');
      if (w.stepGoal && w.steps < w.stepGoal) bits.push(`${Math.round(w.steps).toLocaleString('fr-FR')} pas sur ${Math.round(w.stepGoal).toLocaleString('fr-FR')}`);
      body = bits.length ? bits.join(' · ') + '.' : 'Tout est à jour. Belle journée, ' + name + '.';
    }
    add({id:'evening-' + k, date:k, time:p.evening, title:'🌙 Bilan du soir', body, url:'#/'});
  }
  // pesée (objectif calories adaptatif) : lundi et jeudi
  try {
    const nut = J.store('nutrition', {}).data;
    if (p.weigh && nut.mode === 'adaptive') for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i); const k = dk(d);
      if (![1, 4].includes(d.getDay()) || (nut.weights || {})[k]) continue;
      add({id:'weigh-' + k, date:k, time:'07:30', title:'⚖️ Pesée du jour', body:'À jeun, avant le petit-déjeuner : elle affine votre objectif calories.', url:'#/nutrition'});
    }
  } catch(e) {}
  try { (J.timers ? J.timers() : []).forEach(t => add({id:'timer-' + t.id, at:t.at, title:`⏱ ${t.label}`, body:'Le minuteur est terminé.', url:'#/'})); } catch(e) {}
  return out.sort((a, b) => a.at - b.at).slice(0, 250);
}
let last = '', timer = 0;
async function schedule(force){
  if (!ls.get('jarvis.push') || !J.user()) return;
  const items = collect(), sig = JSON.stringify(items);
  if (NAT()) {   // pastille : tâches du jour et en retard
    let badge = 0; try { const k = dk(new Date()); badge = J.store('taches', {tasks:[]}).data.tasks.filter(t => !t.done && t.due && t.due <= k).length; } catch(e) {}
    const nsig = sig + badge; if (!force && nsig === last) return;
    try { await NAT().call('notify.schedule', {items, badge}); last = nsig; } catch(e) {}
    return;
  }
  if (!force && sig === last) return;
  try { await J.api('PUT', '/api/push/schedule', {items}); last = sig; } catch(e) {}
}
J.scheduleNotifs = () => { clearTimeout(timer); timer = setTimeout(() => schedule(false), 2500); };

/* ---------- réglages ---------- */
async function renderSettings(){
  const box = $('#sNotif'); if (!box) return;
  const p = prefsN(), sub = await subscription().catch(() => null);
  const on = NAT() ? !!sub && (await NAT().call('notify.status').catch(() => '')) === 'granted' : !!sub && Notification.permission === 'granted';
  const row = (k, label, small) => `<div class="toggle"><span>${label}<small>${small}</small></span><label class="sw"><input type="checkbox" data-np="${k}" ${p[k] !== false && p[k] !== null ? 'checked' : ''}><i></i></label></div>`;
  box.innerHTML = !supported() ? `<p class="note">${standalone() ? 'Votre version d\'iOS ne permet pas les notifications web (iOS 16.4 minimum).' : 'Pour recevoir des notifications, ouvrez Jarvis depuis son icône sur l\'écran d\'accueil.'}</p>`
    : !on ? `<p class="note">Rappels de tâches à l'heure, habitudes, journal du soir, briefing du matin… même quand Jarvis est fermé.</p><button class="btn primary" id="nEnable">ACTIVER LES NOTIFICATIONS</button>`
    : `<p class="note">✓ Notifications activées sur cet appareil.</p>
      ${row('tasks', 'Tâches', 'Pour les tâches avec une heure')}
      <div class="toggle"><span>Rappel des tâches<small>Par défaut ; modifiable tâche par tâche</small></span><select class="ntime" id="nTaskLead">${[[0, 'À l\'heure'], [5, '5 min avant'], [10, '10 min avant'], [15, '15 min avant'], [30, '30 min avant'], [60, '1 h avant'], [1440, 'La veille']].map(([v, n]) => `<option value="${v}" ${(typeof p.taskLead === 'number' ? p.taskLead : 15) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${row('habits', 'Habitudes', 'À l\'heure de rappel de chaque habitude')}
      ${row('journal', 'Journal du soir', 'À 21 h 30 si pas encore rempli')}
      <div class="toggle"><span>Briefing du matin<small>Programme de la journée</small></span><input type="time" class="ntime" id="nMorning" value="${p.morning || ''}"></div>
      <div class="toggle"><span>Bilan du soir<small>Tâches, calories et pas restants</small></span><input type="time" class="ntime" id="nEvening" value="${p.evening || ''}"></div>
      ${row('weigh', 'Pesée', 'Lundi et jeudi, avec l\'objectif calories adaptatif')}
      ${NAT() ? '<p class="note">Dans l\'app iPhone, les notifications des amis (🔥, défis) ne sont pas disponibles : elles passent par l\'écran d\'accueil web.</p>' : row('social', 'Défis entre amis', 'Un ami vous 🔥, vous dépasse, termine une séance ou lance un défi')}
      <div class="two"><button class="btn ghost" id="nTest">TESTER</button><button class="btn ghost" id="nOff">DÉSACTIVER</button></div>`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'nEnable') { e.target.disabled = true; try { if (await enable()) { J.toast('Notifications activées'); J.haptic(); } } catch(err) { J.toast('Activation impossible : ' + err.message); J.report('push enable : ' + (err.stack || err)); } renderSettings(); }
  if (e.target.id === 'nTest') {
    if (NAT()) { try { await NAT().call('notify.schedule', {items:[...collect(), {nid:'test', at:Date.now() + 5000, title:'J.A.R.V.I.S.', body:'Notifications opérationnelles. À votre service.', url:'#/'}]}); last = ''; J.toast('Notification dans 5 secondes : verrouillez l\'écran pour la voir'); } catch(err) { J.toast(err.message); } return; }
    try { await J.api('POST', '/api/push/test'); J.toast('Notification envoyée : verrouillez l\'écran pour la voir'); } catch(err) { J.toast(err.message); }
  }
  if (e.target.id === 'nOff') { await disable(); J.toast('Notifications désactivées'); renderSettings(); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.np;
  if (e.target.id === 'nTaskLead') { const pr = J.prefs(); pr.notif = Object.assign({}, DEFAULT_PREFS, pr.notif || {}); pr.notif.taskLead = +e.target.value; J.store('core', {}).save(); schedule(true); return; }
  if (e.target.id === 'nEvening') { const pr = J.prefs(); pr.notif = Object.assign({}, DEFAULT_PREFS, pr.notif || {}); pr.notif.evening = e.target.value || null; J.store('core', {}).save(); schedule(true); return; }
  if (k || e.target.id === 'nMorning') {
    const pr = J.prefs(); pr.notif = Object.assign({}, DEFAULT_PREFS, pr.notif || {});
    if (k) pr.notif[k] = e.target.checked; else pr.notif.morning = e.target.value || null;
    J.store('core', {}).save(); schedule(true);
  }
});
J.renderNotifSettings = renderSettings;

/* ---------- proposer d'activer, au bon moment ----------
   état : 'on' | 'off' (possible, pas encore activé) | 'denied' | 'install' (iPhone : ouvrir depuis l'écran d'accueil) | 'no' */
J.notifState = () => {
  if (NAT()) return ls.get('jarvis.push') ? 'on' : 'off';
  if (!supported()) return /iPhone|iPad/.test(navigator.userAgent) && !standalone() ? 'install' : 'no';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && ls.get('jarvis.push') ? 'on' : 'off';
};
J.enableNotifs = async () => {
  try { if (await enable()) { J.toast('Notifications activées'); J.haptic(); } }
  catch(err) { J.toast('Activation impossible : ' + err.message); J.report('push enable : ' + (err.stack || err)); }
  if (J.renderBriefing) J.renderBriefing();
};
const ASK_KEY = 'jarvis.notifAsk';
J.notifSnoozed = () => Date.now() - (ls.get(ASK_KEY) || 0) < 3 * 864e5;
J.notifSnooze = () => ls.set(ASK_KEY, Date.now());
/* J.notifPrompt('Je peux vous le rappeler à l'heure.') : petite proposition après une action où ça a du sens */
J.notifPrompt = (why) => {
  if (J.notifState() !== 'off' || J.notifSnoozed()) return;
  J.notifSnooze();   // une proposition tous les 3 jours au plus
  setTimeout(() => J.toast(`${why} Activer les notifications ?`, {action:'ACTIVER', onAction:J.enableNotifs}), 2400);
};

/* ---------- ouverture depuis une notification ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
  const url = e.data && e.data.go; if (!url || !J.user()) return;
  const id = url.replace(/^#\/?/, '');
  J.go(id || null);
});
})();
