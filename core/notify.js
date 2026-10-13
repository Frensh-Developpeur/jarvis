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
const DEFAULT_PREFS = {tasks:true, habits:true, journal:true, morning:'08:00', weigh:true};
const prefsN = () => Object.assign({}, DEFAULT_PREFS, (J.prefs() || {}).notif || {});
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function subscription(){
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enable(){
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
  // briefing du matin
  if (p.morning) for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); const k = dk(d);
    let tasks = 0; try { tasks = J.store('taches', {tasks:[]}).data.tasks.filter(t => !t.done && t.due && t.due <= k).length; } catch(e) {}
    add({id:'morning-' + k, date:k, time:p.morning, title:`☀️ ${J.greeting().replace(/\.$/, '')}`, body:(tasks ? `${tasks} tâche${tasks > 1 ? 's' : ''} au programme. ` : '') + 'Votre briefing du jour est prêt.', url:'#/'});
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
  return out.sort((a, b) => a.at - b.at).slice(0, 250);
}
let last = '', timer = 0;
async function schedule(force){
  if (!ls.get('jarvis.push') || !J.user()) return;
  const items = collect(), sig = JSON.stringify(items);
  if (!force && sig === last) return;
  try { await J.api('PUT', '/api/push/schedule', {items}); last = sig; } catch(e) {}
}
J.scheduleNotifs = () => { clearTimeout(timer); timer = setTimeout(() => schedule(false), 2500); };

/* ---------- réglages ---------- */
async function renderSettings(){
  const box = $('#sNotif'); if (!box) return;
  const p = prefsN(), sub = await subscription().catch(() => null), on = !!sub && Notification.permission === 'granted';
  const row = (k, label, small) => `<div class="toggle"><span>${label}<small>${small}</small></span><label class="sw"><input type="checkbox" data-np="${k}" ${p[k] !== false && p[k] !== null ? 'checked' : ''}><i></i></label></div>`;
  box.innerHTML = !supported() ? `<p class="note">${standalone() ? 'Votre version d\'iOS ne permet pas les notifications web (iOS 16.4 minimum).' : 'Pour recevoir des notifications, ouvrez Jarvis depuis son icône sur l\'écran d\'accueil.'}</p>`
    : !on ? `<p class="note">Rappels de tâches à l'heure, habitudes, journal du soir, briefing du matin… même quand Jarvis est fermé.</p><button class="btn primary" id="nEnable">ACTIVER LES NOTIFICATIONS</button>`
    : `<p class="note">✓ Notifications activées sur cet appareil.</p>
      ${row('tasks', 'Tâches', 'À l\'heure prévue')}
      ${row('habits', 'Habitudes', 'À l\'heure de rappel de chaque habitude')}
      ${row('journal', 'Journal du soir', 'À 21 h 30 si pas encore rempli')}
      <div class="toggle"><span>Briefing du matin<small>Résumé de la journée</small></span><input type="time" class="ntime" id="nMorning" value="${p.morning || ''}"></div>
      ${row('weigh', 'Pesée', 'Lundi et jeudi, avec l\'objectif calories adaptatif')}
      <div class="two"><button class="btn ghost" id="nTest">TESTER</button><button class="btn ghost" id="nOff">DÉSACTIVER</button></div>`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'nEnable') { e.target.disabled = true; try { if (await enable()) { J.toast('Notifications activées'); J.haptic(); } } catch(err) { J.toast('Activation impossible : ' + err.message); J.report('push enable : ' + (err.stack || err)); } renderSettings(); }
  if (e.target.id === 'nTest') { try { await J.api('POST', '/api/push/test'); J.toast('Notification envoyée : verrouillez l\'écran pour la voir'); } catch(err) { J.toast(err.message); } }
  if (e.target.id === 'nOff') { await disable(); J.toast('Notifications désactivées'); renderSettings(); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.np;
  if (k || e.target.id === 'nMorning') {
    const pr = J.prefs(); pr.notif = Object.assign({}, DEFAULT_PREFS, pr.notif || {});
    if (k) pr.notif[k] = e.target.checked; else pr.notif.morning = e.target.value || null;
    J.store('core', {}).save(); schedule(true);
  }
});
J.renderNotifSettings = renderSettings;

/* ---------- ouverture depuis une notification ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
  const url = e.data && e.data.go; if (!url || !J.user()) return;
  const id = url.replace(/^#\/?/, '');
  J.go(id || null);
});
})();
