/* ============================================================
   J.A.R.V.I.S. — dans l'app iPhone (coquille native, dossier ios/)
   L'app native injecte window.JarvisNative ; ici on branche dessus :
   - Santé lue directement (plus besoin du raccourci) à l'ouverture et au retour dans l'app
   - retour haptique natif
   - dictée native (la reconnaissance vocale web n'existe pas dans l'app)
   - notifications locales et pastille (gérées dans notify.js)
   Sans l'app native (navigateur, écran d'accueil), ce fichier ne fait rien.
   ============================================================ */
'use strict';
(() => {
const N = window.JarvisNative;
J.native = N || null;
if (!N) return;
const {ls} = J;
document.documentElement.classList.add('native-ios');

/* ---------- retour haptique natif ---------- */
J.haptic = (style) => { N.call('haptic', {style:style || 'light'}).catch(() => {}); };

/* ---------- dictée : imite l'API web SpeechRecognition, le reste de l'app n'y voit que du feu ---------- */
let active = null;
class NativeSR {
  constructor(){ this.lang = 'fr-FR'; this.interimResults = false; this.continuous = false; this.onresult = null; this.onerror = null; this.onend = null; this.ended = false; }
  start(){
    if (active && active !== this) active.abort();
    active = this;
    N.call('speech.start').catch(e => { if (this.onerror) this.onerror({error:/not-allowed/.test(e.message) ? 'not-allowed' : 'network'}); this._end(); });
  }
  stop(){ N.call('speech.stop').catch(() => {}); this._end(); }
  abort(){ this.stop(); }
  _end(){ if (this.ended) return; this.ended = true; if (active === this) active = null; if (this.onend) this.onend(); }
}
N.on('speech', d => {
  const r = active; if (!r) return;
  if (d.end) return r._end();
  if (typeof d.text === 'string' && r.onresult) {
    const alt = [{transcript:d.text, confidence:1}]; alt.isFinal = !!d.final;
    const results = [alt];
    r.onresult({results, resultIndex:0});
  }
});
window.SpeechRecognition = window.webkitSpeechRecognition = NativeSR;

/* ---------- Santé : lecture directe ---------- */
let syncing = false;
J.syncHealth = async (ask) => {
  if (syncing || !J.user()) return;
  syncing = true;
  try {
    if (ask || !ls.get('jarvis.hk')) { await N.call('health.authorize'); ls.set('jarvis.hk', 1); }
    const r = await N.call('health.read', {days:14});
    const st = J.store('apple', {days:{}}), d = st.data;
    d.days = d.days || {};
    Object.entries((r && r.days) || {}).forEach(([k, v]) => { d.days[k] = Object.assign({}, d.days[k], v); });
    d.days = Object.fromEntries(Object.keys(d.days).sort().slice(-60).map(k => [k, d.days[k]]));
    d.syncedAt = Date.now(); d.source = 'ios';
    st.save();
    st.listeners.forEach(f => { try { f(d); } catch(e) {} });   // l'objectif calories et la santé se recalculent
    if (J.renderBriefing) J.renderBriefing();
    J.updateWidgets();
    if (ask) J.toast('Santé synchronisée');
  } catch(e) {
    J.report('santé native : ' + e.message);
    if (ask) J.toast('Santé indisponible : ' + e.message);
  } finally { syncing = false; }
};
// le guide du raccourci n'a plus lieu d'être : « Connecter Apple Santé » demande directement l'autorisation
J.openGuide = () => J.syncHealth(true);
document.addEventListener('click', e => {
  const a = e.target.closest('#syncLink,[data-act="runsync"]');
  if (a) { e.stopImmediatePropagation(); e.preventDefault(); J.haptic(); J.syncHealth(true); }
}, true);

/* ---------- widgets : les chiffres du moment, déposés pour l'écran d'accueil et l'écran verrouillé ---------- */
let widT = 0;
J.updateWidgets = () => {
  clearTimeout(widT);
  widT = setTimeout(() => {
    if (!J.user()) return;
    const data = {name:(J.prefs() || {}).name || 'Monsieur'};
    J.modules.forEach(m => { if (m.widget && !m.soon) try { Object.assign(data, m.widget()); } catch(e) {} });
    N.call('widget.update', {data}).catch(() => {});
  }, 800);
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') J.updateWidgets(); });

/* ---------- Siri : « Dis Siri, demande à Jarvis… », « briefing Jarvis », « parle à Jarvis » ---------- */
const onHub = f => whenUser().then(() => { J.go(null); setTimeout(f, 500); });
N.on('ask', d => onHub(() => { if (d && d.text) J.ask(d.text, {from:'hub', voice:true}); }));
N.on('briefing', () => onHub(() => { const t = J.briefingSpeech ? J.briefingSpeech() : ''; if (t) { J.say(t); J.speak(t); } }));
N.on('listen', () => onHub(() => { const r = document.getElementById('hubReactor'); if (r) r.click(); }));

/* ---------- cycle de vie ---------- */
const whenUser = () => new Promise(res => { const t = setInterval(() => { if (J.user()) { clearInterval(t); res(); } }, 500); });
whenUser().then(() => {
  setTimeout(() => J.syncHealth(false), 1200);
  setInterval(() => { if (document.visibilityState === 'visible') J.syncHealth(false); }, 10 * 60e3);
  if (J.scheduleNotifs) {   // chaque modification de données met aussi les widgets à jour
    const sched = J.scheduleNotifs; J.scheduleNotifs = () => { sched(); J.updateWidgets(); };
    J.scheduleNotifs();
  }
  J.updateWidgets();
});
N.on('foreground', () => { if (J.user()) { J.syncHealth(false); if (J.scheduleNotifs) J.scheduleNotifs(); } });
// notification touchée : ouvre le bon module
N.on('open', d => { const id = String((d && d.url) || '').replace(/^#\/?/, ''); if (J.user()) J.go(id || null); });
N.call('ready').catch(() => {});
})();
