/* ============================================================
   J.A.R.V.I.S. — commandes du téléphone (app iPhone)
   Photos (recherche IA sur l'appareil), appels, SMS, itinéraires, apps,
   lampe, luminosité, volume, réveils, modes Concentration (via Raccourcis).
   Hors de l'app iPhone, ces actions répondent qu'elles n'y sont pas disponibles.
   ============================================================ */
'use strict';
(() => {
const {$, esc} = J;
const N = () => J.native;
const ask = msg => Object.assign(new Error(msg), {ask:msg});
const need = () => { if (!N()) throw ask('Cette commande fonctionne dans l\'app Jarvis sur iPhone.'); };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
J.actions = J.actions || {};

/* ---------- photos ---------- */
let sheet = null;
function photoSheet(){
  if (sheet) return sheet;
  document.body.insertAdjacentHTML('beforeend', `<div class="sheet" id="photoSheet" role="dialog" aria-label="Photos"><div class="grab"></div><h2 id="phsT">PHOTOS</h2><p class="note" id="phsN"></p><div class="phsgrid" id="phsG"></div></div>`);
  sheet = $('#photoSheet');
  $('#phsG').addEventListener('click', e => { const b = e.target.closest('[data-pid]'); if (b) { J.haptic(); N().call('photos.open', {id:b.dataset.pid}); } });
  return sheet;
}
const dayMs = (k, end) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(k || '')) return null; const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, end ? 23 : 0, end ? 59 : 0).getTime(); };
J.actions.photo_search = async a => {
  need();
  let st = await N().call('photos.status');
  if (!st.authorized || !st.count) { st = await N().call('photos.index'); st = await N().call('photos.status'); }
  else if (!st.running) N().call('photos.index').catch(() => {});   // nouvelles photos depuis la dernière fois
  const q = {labels:(a.labels || []).map(String), words:(a.words || []).map(String), from:dayMs(a.from), to:dayMs(a.to, true), place:a.place || ''};
  const r = await N().call('photos.search', q);
  const items = r.items || [];
  photoSheet();
  $('#phsT').textContent = (a.title || 'PHOTOS').toUpperCase();
  $('#phsN').textContent = items.length ? `${items.length} photo${items.length > 1 ? 's' : ''}${r.running ? ` · analyse en cours (${r.indexed} photos analysées)` : ''}` : r.running ? `Analyse de vos photos en cours (${r.indexed} déjà faites) : réessayez dans quelques minutes.` : 'Aucune photo ne correspond.';
  $('#phsG').innerHTML = items.map(x => `<button data-pid="${esc(x.id)}" style="background-image:url('${x.src}')"><span>${new Date(x.date).toLocaleDateString('fr-FR', {day:'numeric', month:'short', year:'2-digit'})}</span></button>`).join('');
  J.openSheet(sheet);
  return {text:items.length ? `${items.length} photo${items.length > 1 ? 's' : ''} trouvée${items.length > 1 ? 's' : ''}` : 'Aucune photo trouvée'};
};
N() && N().on('photos.progress', d => { const el = document.getElementById('sPhotoIdx'); if (el) el.textContent = `${d.count} / ${d.total} photos analysées`; });

/* ---------- contacts : appeler, écrire ---------- */
async function contact(name){
  const list = await N().call('contacts.find', {name});
  if (!list.length) throw ask(`Je ne trouve pas « ${name} » dans vos contacts.`);
  const exact = list.filter(c => norm(c.name) === norm(name));
  const pick = exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
  if (!pick) throw ask(`Plusieurs contacts correspondent : ${list.slice(0, 4).map(c => c.name).join(', ')}. Lequel ?`);
  const ph = pick.phones.find(p => /mobile|portable|iphone|cell/i.test(p.label)) || pick.phones[0];
  return {name:pick.name, number:ph.number};
}
J.actions.call = async a => {
  need();
  const c = a.number ? {name:a.number, number:a.number} : await contact(a.name || '');
  await N().call('call', {number:c.number});
  return {text:`Appel · ${c.name}`};
};
J.actions.sms = async a => {
  need();
  if (!a.text) throw ask('Que dois-je écrire ?');
  const c = a.number ? {name:a.number, number:a.number} : await contact(a.name || '');
  const r = await N().call('sms', {number:c.number, body:a.text});
  return {text:r === 'sent' ? `Message envoyé à ${c.name}` : r === 'cancelled' ? 'Message annulé' : `Message pour ${c.name}`};
};
J.actions.navigate = async a => {
  need();
  if (!a.destination) throw ask('Où souhaitez-vous aller ?');
  const flg = {walking:'w', transit:'r'}[a.mode] || 'd';
  await N().call('open.url', {url:`maps://?daddr=${encodeURIComponent(a.destination)}&dirflg=${flg}`});
  return {text:`Itinéraire · ${a.destination}`};
};
const APPS = {
  whatsapp:'whatsapp://', spotify:'spotify:', instagram:'instagram://', youtube:'youtube://', snapchat:'snapchat://', tiktok:'snssdk1233://',
  netflix:'nflx://', deezer:'deezer://', waze:'waze://', uber:'uber://', telegram:'tg://', messenger:'fb-messenger://', facebook:'fb://',
  twitter:'twitter://', x:'twitter://', gmail:'googlegmail://', 'google maps':'comgooglemaps://', plans:'maps://', maps:'maps://',
  musique:'music://', 'apple music':'music://', photos:'photos-redirect://', calendrier:'calshow://', rappels:'x-apple-reminderkit://',
  notes:'mobilenotes://', raccourcis:'shortcuts://', mail:'message://', telephone:'tel://', messages:'sms://', facetime:'facetime://',
  appareil:'camera://', 'app store':'itms-apps://', podcasts:'podcasts://', revolut:'revolut://', lydia:'lydia://', strava:'strava://',
};
J.actions.open_app = async a => {
  need();
  const k = norm(a.app).trim(), url = APPS[k] || Object.entries(APPS).find(([n]) => k.includes(n) || n.includes(k))?.[1];
  if (!url) throw ask(`Je ne sais pas encore ouvrir « ${a.app} ».`);
  await N().call('open.url', {url});
  return {text:`Ouverture · ${a.app}`};
};

/* ---------- lampe, luminosité, volume ---------- */
const pct = v => Math.max(0, Math.min(100, Math.round(+v)));
J.actions.torch = async a => { need(); const on = a.on !== false; await N().call('torch', {on, level:pct(a.level ?? 100)}); return {text:on ? 'Lampe allumée' : 'Lampe éteinte'}; };
J.actions.brightness = async a => { need(); if (!isFinite(+a.level)) throw ask('Quelle luminosité, en pourcentage ?'); await N().call('brightness', {level:pct(a.level)}); return {text:`Luminosité · ${pct(a.level)} %`}; };
J.actions.volume = async a => { need(); if (!isFinite(+a.level)) throw ask('Quel volume, en pourcentage ?'); await N().call('volume', {level:pct(a.level)}); return {text:`Volume · ${pct(a.level)} %`}; };

/* ---------- réveil (AlarmKit : sonne même en silencieux) ---------- */
J.actions.alarm = async a => {
  need();
  const m = String(a.time || '').match(/^(\d{1,2})[:h](\d{2})?/);
  if (!m) throw ask('À quelle heure, le réveil ?');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? new Date(a.date + 'T00:00') : new Date();
  d.setHours(+m[1], +(m[2] || 0), 0, 0);
  if (!a.date && d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  await N().call('alarm', {at:d.getTime(), label:a.label || 'Réveil Jarvis'});
  const today = new Date().toDateString() === d.toDateString();
  return {text:`Réveil · ${today ? 'aujourd\'hui' : d.toLocaleDateString('fr-FR', {weekday:'long'})} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`};
};

/* ---------- modes Concentration : raccourcis à créer une fois ---------- */
const FOCUS = {dnd:'Jarvis Ne pas déranger', sleep:'Jarvis Sommeil', off:'Jarvis Fin concentration'};
J.actions.focus = async a => {
  need();
  const name = FOCUS[a.mode] || FOCUS.dnd;
  await N().call('open.url', {url:`shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(name)}&x-success=${encodeURIComponent('jarvis://back')}&x-error=${encodeURIComponent('jarvis://shortcut-error?name=' + encodeURIComponent(name))}`});
  return {text:{dnd:'Ne pas déranger activé', sleep:'Mode sommeil activé', off:'Concentration désactivée'}[a.mode] || 'Ne pas déranger activé'};
};
N() && N().on('shortcut.error', d => J.toast(`Raccourci « ${d.name} » introuvable : Réglages › Commandes du téléphone`, {action:'VOIR', onAction:() => document.getElementById('openSettings').click()}));

/* ---------- réglages ---------- */
J.renderDeviceSettings = async () => {
  const box = document.getElementById('sDevice'); if (!box) return;
  if (!N()) { box.innerHTML = '<p class="note">Dans l\'app Jarvis sur iPhone : photos, appels, SMS, itinéraires, lampe, luminosité, volume, réveils et Ne pas déranger à la voix.</p>'; return; }
  let st = {}; try { st = await N().call('photos.status'); } catch(e) {}
  box.innerHTML = `
    <div class="toggle"><span>Recherche dans vos photos<small id="sPhotoIdx">${st.authorized ? `${st.count} photos analysées${st.running ? ' · en cours' : ''}` : 'Analyse sur l\'iPhone, rien n\'est envoyé'}</small></span><button class="btn ghost sm" id="sPhotoGo">${st.authorized ? 'METTRE À JOUR' : 'ACTIVER'}</button></div>
    <p class="note">« Ne pas déranger » à la voix : créez une fois ces 3 raccourcis dans l'app Raccourcis (+, puis l'action « Définir la concentration ») avec exactement ces noms :</p>
    <ul class="shlist"><li><b>Jarvis Ne pas déranger</b> → Ne pas déranger : Activer</li><li><b>Jarvis Sommeil</b> → Sommeil : Activer</li><li><b>Jarvis Fin concentration</b> → Ne pas déranger : Désactiver</li></ul>`;
  document.getElementById('sPhotoGo').onclick = async () => { J.haptic(); try { await N().call('photos.index'); J.toast('Analyse des photos lancée : gardez Jarvis ouvert quelques minutes'); } catch(e) { J.toast(e.message); } J.renderDeviceSettings(); };
};
})();
