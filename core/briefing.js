/* ============================================================
   J.A.R.V.I.S. — briefing du jour (hub)
   Météo (Open-Meteo), agenda et rappels (envoyés par le raccourci iPhone),
   cartes fournies par les modules (briefing()), remarque du jour.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, ls} = J;
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
J.todayKey = todayKey;
const hm = d => d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
J.ago = ts => {
  if (!ts) return 'jamais';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 60 * 24 && new Date(ts).getDate() === new Date().getDate()) return 'à ' + hm(new Date(ts));
  return new Date(ts).toLocaleDateString('fr-FR', {weekday:'long'}) + ' ' + hm(new Date(ts));
};

/* ---------- icônes ---------- */
const I = {
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  partly:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v1.5M3.8 5.8l1 1M2 10h1.5"/><path d="M5.3 12A4 4 0 0 1 12 7.5"/><path d="M7 20h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.6A3.2 3.2 0 0 0 7 20z"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 19h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 11.5 3.8 3.8 0 0 0 7 19z"/></svg>',
  rain:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 15h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 7.5 3.8 3.8 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  snow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 14h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 6.5 3.8 3.8 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/></svg>',
  storm:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 15h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 7.5 3.8 3.8 0 0 0 7 15z"/><path d="M13 13l-3 5h4l-2 4"/></svg>',
  fog:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10h16M3 14h18M6 18h12M7 6h10"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v1.5M12 20.5V22"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
};
J.icons = I;

/* ============================================================
   Météo
   ============================================================ */
const WMO = c =>
  c === 0 ? ['Ciel dégagé', 'sun'] : c === 1 ? ['Plutôt dégagé', 'sun'] : c === 2 ? ['Partiellement nuageux', 'partly'] :
  c === 3 ? ['Couvert', 'cloud'] : c <= 48 ? ['Brouillard', 'fog'] : c <= 57 ? ['Bruine', 'rain'] : c <= 67 ? ['Pluie', 'rain'] :
  c <= 77 ? ['Neige', 'snow'] : c <= 82 ? ['Averses', 'rain'] : c <= 86 ? ['Averses de neige', 'snow'] : ['Orage', 'storm'];

let weather = ls.get('jarvis.weather');     // {at, place, data}
let weatherLoading = false;

async function locate(){
  const city = (J.prefs().city || '').trim();
  if (city) {
    const cached = ls.get('jarvis.geo');
    if (cached && cached.city === city) return cached;
    const r = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name=' + encodeURIComponent(city))).json();
    if (!r.results || !r.results.length) throw new Error('Ville introuvable');
    const g = {city, lat:r.results[0].latitude, lon:r.results[0].longitude, place:r.results[0].name, at:Date.now()};
    ls.set('jarvis.geo', g); return g;
  }
  const cached = ls.get('jarvis.geo');
  if (cached && !cached.city && Date.now() - cached.at < 6 * 3600e3) return cached;
  const pos = await new Promise((ok, ko) => navigator.geolocation.getCurrentPosition(ok, ko, {timeout:10000, maximumAge:3600e3}));
  const g = {lat:pos.coords.latitude, lon:pos.coords.longitude, at:Date.now(), place:''};
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=fr&lat=${g.lat}&lon=${g.lon}`)).json();
    const a = r.address || {};
    g.place = a.city || a.town || a.village || a.municipality || '';
  } catch(e) {}
  ls.set('jarvis.geo', g); return g;
}
async function loadWeather(force){
  if (weatherLoading) return;
  if (!force && weather && Date.now() - weather.at < 30 * 60e3 && weather.day === todayKey()) return;
  if (!force && !(J.prefs() || {}).city && !ls.get('jarvis.geo')) return;    // la position n'est demandée qu'après un toucher
  weatherLoading = true;
  try {
    const g = await locate();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&timezone=auto&forecast_days=1` +
      '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,uv_index_max' +
      '&hourly=precipitation_probability';
    const data = await (await fetch(url)).json();
    if (!data || !data.current || !data.daily || !data.hourly) throw new Error('réponse météo incomplète');
    weather = {at:Date.now(), day:todayKey(), place:g.place, data};
    ls.set('jarvis.weather', weather);
  } catch(e) {
    if (force) J.toast(e.code === 1 ? 'Position refusée : indiquez votre ville dans les réglages' : 'Météo indisponible');
  } finally { weatherLoading = false; }
  J.renderBriefing();
}
J.refreshWeather = () => loadWeather(true);
J.weatherText = () => { const w = weatherInfo(); return w ? `${w.label}, ${w.temp}° (min ${w.min}°, max ${w.max}°), pluie ${w.rain} %${w.place ? ', ' + w.place : ''}${w.tips.length ? '. ' + w.tips.join(', ') : ''}` : ''; };

function weatherInfo(){
  if (!weather || !weather.data || !weather.data.current || !weather.data.daily || !weather.data.hourly) {
    if (weather) { weather = null; ls.del('jarvis.weather'); setTimeout(() => loadWeather(false), 0); }   // cache abîmé : on le jette et on recharge
    return null;
  }
  const w = weather.data, c = w.current, d = w.daily;
  const [label, icon] = WMO(c.weather_code);
  const max = Math.round(d.temperature_2m_max[0]), min = Math.round(d.temperature_2m_min[0]);
  const rain = d.precipitation_probability_max[0] ?? 0, uv = d.uv_index_max[0] ?? 0;
  // heure de pluie la plus probable dans le reste de la journée
  let rainAt = null;
  const nowH = new Date().getHours();
  w.hourly.time.forEach((t, i) => { const h = new Date(t).getHours(); if (h >= nowH && w.hourly.precipitation_probability[i] >= 50 && rainAt === null) rainAt = h; });
  const tips = [];
  if (rain >= 50) tips.push(rainAt !== null ? `pluie probable vers ${rainAt} h, prenez un parapluie` : 'prenez un parapluie');
  if (min <= 3) tips.push('couvrez-vous bien, il fait froid');
  if (max >= 28) tips.push('pensez à vous hydrater');
  if (uv >= 6) tips.push('indice UV élevé, crème solaire recommandée');
  if (c.wind_speed_10m >= 40) tips.push('vent fort aujourd\'hui');
  const sunset = new Date(d.sunset[0]);
  return {label, icon:c.is_day ? icon : (icon === 'sun' ? 'moon' : icon), temp:Math.round(c.temperature_2m), feels:Math.round(c.apparent_temperature),
          max, min, rain, uv, tips, sunset, place:weather.place, at:weather.at};
}

/* ============================================================
   Agenda & rappels (raccourci iPhone)
   ============================================================ */
/* document synchronisé 'apple' : écrit uniquement par le serveur (raccourci iPhone) */
const appleDoc = () => J.store('apple', {days:{}}).data;
J.appleDoc = appleDoc;

function parseEvent(line){
  const m = line.match(/^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?\s*[-–—|·]?\s*(.*)$/);
  if (!m) return {time:null, title:line.trim(), mins:null};
  const h = +m[1], mi = +(m[2] || 0);
  return {time:`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`, title:(m[3] || '').trim() || 'Événement', mins:h * 60 + mi};
}
function agenda(){
  const a = appleDoc().agenda;
  if (!a || a.date !== todayKey()) return null;
  const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const items = a.items.map(parseEvent);
  const next = items.find(e => e.mins !== null && e.mins >= nowM - 5);
  return {items, next, nowM, at:a.at};
}
function reminders(){
  const r = appleDoc().reminders;
  if (!r || r.date !== todayKey()) return null;
  return {items:r.items, at:r.at};
}
const inMins = m => m < 60 ? `dans ${m} min` : `dans ${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;

/* ============================================================
   Remarque du jour
   ============================================================ */
const QUIPS = [
  "Une journée bien planifiée est une journée à moitié gagnée. L'autre moitié, je vous la laisse.",
  "J'ai pris la liberté de tout vérifier. Deux fois.",
  "Rappel amical : l'eau reste la boisson la plus sous-estimée de l'univers connu.",
  "Si je puis me permettre, quelques pas de plus ne vous feraient aucun mal.",
  "Les grands projets commencent toujours par une petite tâche. Je suggère de commencer.",
  "Votre sommeil est un investissement. Les intérêts sont excellents.",
  "Je reste à votre disposition, comme toujours.",
  "Un budget respecté est une forme d'élégance.",
  "J'ai analysé vos habitudes. Je garde mes conclusions pour moi, par politesse.",
  "La procrastination est une stratégie. Rarement la bonne.",
  "Souvenez-vous de vous lever de temps en temps. Votre dos me remerciera.",
  "Aucune menace détectée. Une journée calme, en somme.",
  "Je vous recommande une pause. Même les armures ont besoin de refroidir.",
  "Vous avez tout ce qu'il faut pour réussir aujourd'hui. Et moi, accessoirement.",
  "Petit rappel : répondre à ce message important que vous repoussez depuis trois jours.",
  "J'ai mis vos priorités dans l'ordre. Libre à vous de les respecter.",
  "Le progrès ne se mesure pas en jours, mais en habitudes.",
  "Si quelque chose vous préoccupe, notez-le. Je m'occupe du reste.",
  "Excellente journée en perspective. Statistiquement parlant.",
  "Pensez à appeler quelqu'un qui compte pour vous. Ça ne prend que cinq minutes.",
];
const quip = () => { const d = new Date(), n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); return QUIPS[n % QUIPS.length]; };

/* ============================================================
   Rendu des cartes du hub
   ============================================================ */
function card({cls = '', icon = '', title, right = '', body, act = ''}){
  return `<div class="bcard ${cls}" ${act ? `data-act="${act}"` : ''}>
    <div class="bh"><span class="bi">${icon}</span><span class="bt">${esc(title)}</span><span class="br">${right}</span></div>${body}</div>`;
}
function moduleCards(){
  return J.modules.filter(m => !m.soon && m.briefing)
    .map(m => { try { return m.briefing(); } catch(e) { return null; } })
    .filter(Boolean).flat().sort((a, b) => (a.order || 50) - (b.order || 50));
}

/* tuiles « chiffres du jour » : météo + stat() de chaque module */
function quickTile({label, value, sub = '', ratio = null, act = '', icon = '', accent = '#3fe0ff', cls = ''}){
  return `<button class="qt ${cls}" data-act="${act}" style="--acc:${accent}">
    <span class="ql">${icon}${esc(label)}</span><span class="qv">${value}</span>${sub ? `<span class="qs">${sub}</span>` : ''}
    ${ratio !== null ? `<span class="qb"><i style="width:${Math.max(0, Math.min(1, ratio)) * 100}%"></i></span>` : ''}</button>`;
}
/* observations de tous les modules, les plus importantes d'abord */
J.insights = () => {
  const all = [];
  J.modules.filter(m => !m.soon && m.insights).forEach(m => { try { (m.insights() || []).forEach(x => all.push(Object.assign({go:m.id}, x))); } catch(e) { J.report(m.id + '.insights : ' + e); } });
  return all.sort((a, b) => b.score - a.score);
};
/* anneaux du réacteur : pas (cyan), calories (vert), tâches terminées (ambre) */
function hubRings(){
  const stat = id => { const m = J.modules.find(x => x.id === id && !x.soon); try { return m && m.stat ? m.stat() : null; } catch(e) { return null; } };
  const set = (cls, r, ratio) => { const el = $('#hubReactor .' + cls), C = 2 * Math.PI * r; if (el) el.setAttribute('stroke-dasharray', `${Math.max(0.001, Math.min(1, ratio || 0)) * C} ${C}`); };
  const s = stat('sante'), n = stat('nutrition'), t = stat('taches');
  set('r-steps', 111, s && s.ratio); set('r-kcal', 105, n && n.ratio); set('r-tasks', 99, t && t.ratio);
  const pct = x => x && x.ratio !== null && x.ratio !== undefined ? Math.round(x.ratio * 100) + ' %' : '—';
  const lg = $('#hubLegend');
  if (lg) lg.innerHTML = `<span style="--c:#3fe0ff"><i></i>PAS <b>${pct(s)}</b></span><span style="--c:#4dffc3"><i></i>KCAL <b>${pct(n)}</b></span><span style="--c:#ffb347"><i></i>TÂCHES <b>${pct(t)}</b></span>`;
}
J.renderBriefing = () => {
  try { renderBriefingInner(); } catch(e) { J.report('renderBriefing : ' + (e.stack || e)); }
};
function renderBriefingInner(){
  const el = $('#briefing'); if (!el || !J.user()) return;
  $('#briefDate').textContent = new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});

  const tiles = [];
  let w = null; try { w = weatherInfo(); } catch(e) { J.report('météo : ' + e); }
  tiles.push(w ? quickTile({label:'MÉTÉO' + (w.place ? ' · ' + w.place.toUpperCase() : ''), value:`${w.temp}°<small> ${w.min}°/${w.max}°</small>`, sub:w.tips[0] ? w.tips[0].charAt(0).toUpperCase() + w.tips[0].slice(1) : w.label, act:'weather', icon:I[w.icon]})
               : quickTile({label:'MÉTÉO', value:'<small>Activer</small>', sub:'Touchez pour la météo locale', act:'weather', icon:I.partly, cls:'setup'}));
  J.modules.filter(m => !m.soon && m.stat).sort((a, b) => (a.order || 50) - (b.order || 50)).forEach(m => {
    try { const t = m.stat(); if (t) tiles.push(quickTile(Object.assign({icon:m.icon, accent:m.accent, act:'mod:' + m.id}, t))); } catch(e) {}
  });
  $('#quick').innerHTML = tiles.join('');
  hubRings();

  const html = [];
  const ag = agenda(), rm = reminders(), synced = appleDoc().syncedAt;
  if (!synced) html.push(card({cls:'setup', icon:I.link, title:'CONNECTER APPLE SANTÉ', act:'guide',
    body:'<p class="bs">Vos pas et calories actives dans Jarvis : 5 minutes de configuration.</p>'}));
  // analyse de Jarvis : ce qui mérite l'attention aujourd'hui
  const ins = J.insights().slice(0, 3);
  if (ins.length) html.push(card({cls:'insight', icon:I.eye, title:'ANALYSE DE JARVIS', right:ins.length + ' / ' + J.insights().length,
    body:'<ul class="ilist">' + ins.map(x => `<li class="${x.level}" data-go="${x.go}"><i></i><span>${esc(x.text)}</span></li>`).join('') + '</ul>'}));
  // personne n'avait activé les notifications : on le propose clairement, une carte qu'on peut repousser
  if (J.notifState && J.notifState() === 'off' && !J.notifSnoozed()) html.push(card({cls:'setup', icon:I.bell, title:'ACTIVER LES NOTIFICATIONS',
    body:'<p class="bs">Rappels de tâches à l\'heure, briefing du matin, journal du soir… et quand un ami vous 🔥 ou vous dépasse dans un défi.</p><div class="bbtns"><button class="btn primary" data-act="notif">ACTIVER</button><button class="btn ghost" data-act="notif-later">PLUS TARD</button></div>'}));
  if (ag && ag.items.length) html.push(card({icon:I.cal, title:'AGENDA', right:ag.items.length + ' évén.', body:'<ul class="blist">' + ag.items.map(e => {
      const past = e.mins !== null && e.mins < ag.nowM - 5, isNext = e === ag.next;
      return `<li class="${past ? 'past' : ''} ${isNext ? 'next' : ''}"><span class="bt2">${e.time || '—'}</span><span>${esc(e.title)}</span>${isNext ? `<em>${e.mins > ag.nowM ? inMins(e.mins - ag.nowM) : 'maintenant'}</em>` : ''}</li>`;
    }).join('') + '</ul>'}));
  if (rm && rm.items.length) html.push(card({icon:I.check, title:'RAPPELS', right:rm.items.length, body:'<ul class="blist">' + rm.items.map(t => `<li><span class="dot"></span><span>${esc(t)}</span></li>`).join('') + '</ul>'}));
  moduleCards().forEach(c => html.push(card(c)));
  el.innerHTML = html.join('');
  el.hidden = !html.length;

  $('#quip').textContent = '« ' + quip() + ' »';
  const sl = $('#syncLink');
  sl.hidden = !synced;
  if (synced) sl.textContent = `↻ Synchroniser Apple Santé · ${J.ago(synced)}`;
}

function onAct(e){
  const g = e.target.closest('[data-go]'); if (g && !e.target.closest('[data-act]')) { J.haptic(); J.go(g.dataset.go); return; }
  const c = e.target.closest('[data-act]'); if (!c) return;
  J.haptic();
  const a = c.dataset.act;
  if (a === 'weather') loadWeather(true);
  if (a === 'guide') J.openGuide();
  if (a === 'notif') J.enableNotifs();
  if (a === 'notif-later') { J.notifSnooze(); J.renderBriefing(); }
  if (a.startsWith('mod:')) J.go(a.slice(4));
}
$('#briefing').addEventListener('click', onAct);
$('#quick').addEventListener('click', onAct);
$('#syncLink').addEventListener('click', () => { J.haptic(); location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Jarvis'); });

/* ============================================================
   Briefing vocal (concis : chaque caractère consomme le quota de voix)
   ============================================================ */
J.briefingSpeech = () => {
  const parts = [J.greeting()];
  const w = weatherInfo();
  if (w) parts.push(`${w.label}, ${w.temp} degrés, ${w.max} au maximum.${w.tips[0] ? ' ' + w.tips[0].charAt(0).toUpperCase() + w.tips[0].slice(1) + '.' : ''}`);
  const ag = agenda();
  if (ag) {
    const left = ag.items.filter(e => e.mins === null || e.mins >= ag.nowM - 5);
    if (!left.length) parts.push(ag.items.length ? 'Plus aucun rendez-vous aujourd\'hui.' : 'Aucun rendez-vous aujourd\'hui.');
    else parts.push(`${left.length} rendez-vous${ag.items.length > left.length ? ' restants' : ''}${ag.next ? `, le prochain à ${ag.next.time.replace(':', ' heures ').replace(' heures 00', ' heures')} : ${ag.next.title}` : ''}.`);
  }
  const rm = reminders();
  if (rm && rm.items.length) parts.push(`${rm.items.length} rappel${rm.items.length > 1 ? 's' : ''}, dont ${rm.items[0]}.`);
  J.modules.filter(m => !m.soon && m.briefingSpeech).sort((a, b) => (a.order || 50) - (b.order || 50)).forEach(m => { try { const t = m.briefingSpeech(); if (t) parts.push(t); } catch(e) {} });
  const top = J.insights().filter(x => x.level !== 'good').slice(0, 2);
  if (top.length) parts.push('À noter : ' + top.map(x => x.text).join(' '));
  return parts.join(' ');
};

J.onHubShow = () => { loadWeather(false); J.renderBriefing(); };
})();
