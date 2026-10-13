/* ============================================================
   Module 02 — Santé
   Données Apple Santé envoyées par le raccourci iPhone : pas et énergie
   active, objectifs et historique 7 jours.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc} = J;
let goals = null, root = null;
const G = () => goals.data;
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const hours = h => { const H = Math.floor(h), M = Math.round((h - H) * 60); return M ? `${H} h ${String(M).padStart(2, '0')}` : `${H} h`; };
const dayKey = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const today = () => (J.appleDoc().days || {})[J.todayKey()] || null;

function ring(ratio, size, label, sub, color = '#3fe0ff'){
  const r = 42, C = 2 * Math.PI * r, v = Math.max(0, Math.min(ratio, 1));
  const col = ratio >= 1 ? '#4dffc3' : color;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(63,224,255,.12)" stroke-width="7"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" transform="rotate(-90 50 50)"
      stroke-dasharray="${v * C} ${C}" style="filter:drop-shadow(0 0 4px ${col})"/></svg>
    <div class="rc"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
function last7(field){
  const days = J.appleDoc().days || {}, out = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const v = (days[dayKey(d)] || {})[field]; out.push({d, v:v ?? null}); }
  return out;
}
function bars(series, goal, fmtV, cls = ''){
  const max = Math.max(goal || 0, ...series.map(s => s.v || 0)) || 1;
  return `<div class="bars ${cls}">${series.map(s => `<div class="bar-col"><div class="bar-v">${s.v !== null ? fmtV(s.v) : ''}</div>
    <div class="bar-t"><i style="height:${(s.v || 0) / max * 100}%" class="${goal && s.v >= goal ? 'ok' : ''}"></i>${goal ? `<span class="goal" style="bottom:${goal / max * 100}%"></span>` : ''}</div>
    <div class="bar-d">${s.d.toLocaleDateString('fr-FR', {weekday:'short'}).slice(0, 2)}</div></div>`).join('')}</div>`;
}

function render(){
  if (!root) return;
  const t = today() || {}, doc = J.appleDoc();
  const steps = t.steps || 0, kcal = t.energy || 0;
  root.innerHTML = !doc.syncedAt ? `
    <section class="panel"><div class="empty" style="padding:24px 16px">
      <p>Aucune donnée reçue pour le moment.</p>
      <button class="btn primary" data-act="guide">CONNECTER APPLE SANTÉ</button></div></section>` : `
    <div class="sante-top two-rings">
      ${ring(steps / G().stepGoal, 168, fmt(steps), 'PAS · ' + fmt(G().stepGoal))}
      ${ring(kcal / G().energyGoal, 168, fmt(kcal), 'KCAL · ' + fmt(G().energyGoal), '#ff5f8f')}
    </div>
    <section class="panel"><div class="ph"><span>PAS · 7 JOURS</span><span>moy. ${fmt(avg(last7('steps')))}</span></div>${bars(last7('steps'), G().stepGoal, v => v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v))}</section>
    <section class="panel"><div class="ph"><span>ÉNERGIE ACTIVE · 7 JOURS</span><span>moy. ${fmt(avg(last7('energy')))} kcal</span></div>${bars(last7('energy'), G().energyGoal, v => Math.round(v), 'pink')}</section>
    <section class="panel"><div class="ph"><span>OBJECTIFS</span><span></span></div>
      <div class="goals">
        <label>Pas par jour<input id="gSteps" type="number" inputmode="numeric" value="${G().stepGoal}"></label>
        <label>Kcal actives par jour<input id="gEnergy" type="number" inputmode="numeric" value="${G().energyGoal}"></label>
      </div></section>
    <button class="sync-row" data-act="runsync">↻ Synchroniser maintenant · dernière synchro ${J.ago(doc.syncedAt)}</button>
    <button class="sync-row" data-act="guide">Guide de configuration du raccourci</button>`;
}
const avg = s => { const v = s.filter(x => x.v !== null).map(x => x.v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

function message(){
  const t = today();
  if (!J.appleDoc().syncedAt) return 'Aucune donnée de santé reçue. Configurez le raccourci iPhone pour commencer.';
  if (!t || (!t.steps && !t.energy)) return 'Pas encore de données aujourd\'hui. Lancez une synchronisation.';
  const steps = t.steps || 0, r = steps / G().stepGoal;
  const kcal = t.energy ? ` ${fmt(t.energy)} kcal actives brûlées.` : '';
  if (r >= 1) return `Objectif atteint : ${fmt(steps)} pas. Remarquable.` + kcal;
  const left = G().stepGoal - steps;
  return `${fmt(steps)} pas pour l'instant. Encore ${fmt(left)} pour l'objectif, soit environ ${Math.round(left / 100)} minutes de marche.` + kcal;
}

J.module({
  id: 'sante',
  code: '02',
  order: 10,
  name: 'Santé',
  tagline: 'Pas et énergie active (Apple Santé)',
  accent: '#ff5f8f',
  cls: 'sante',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3 12h4l2-3 3 6 2-3h7"/></svg>',

  init(){
    goals = J.store('sante', {stepGoal:8000, energyGoal:400});
    goals.onChange(render);
    J.store('apple', {days:{}}).onChange(() => { render(); });
  },
  summary(){
    const t = today();
    if (!J.appleDoc().syncedAt) return 'À connecter';
    return t && t.steps ? `<b>${fmt(t.steps)}</b> pas${t.energy ? `<br>${fmt(t.energy)} kcal actives` : ''}` : 'Pas encore de données';
  },
  stat(){
    if (!J.appleDoc().syncedAt) return null;
    const t = today() || {}, steps = t.steps || 0;
    return {label:'PAS', value:fmt(steps), sub:`objectif ${fmt(G().stepGoal)}${t.energy ? ' · ' + fmt(t.energy) + ' kcal' : ''}`, ratio:steps / G().stepGoal};
  },
  briefingSpeech(){
    const t = today();
    if (!t || !t.steps) return '';
    return `${fmt(t.steps)} pas pour l'instant${t.steps >= G().stepGoal ? ', objectif atteint' : ''}${t.energy ? ` et ${fmt(t.energy)} calories actives` : ''}.`;
  },
  brief(){
    const t = today();
    return t && t.steps ? `${fmt(t.steps)} pas aujourd'hui.` : '';
  },
  report(){ return message(); },

  mount(body){
    root = body;
    render();
    J.say(message());
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      J.haptic();
      if (b.dataset.act === 'guide') J.openGuide();
      if (b.dataset.act === 'runsync') location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Jarvis');
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'gSteps') { G().stepGoal = Math.max(500, parseInt(e.target.value) || 8000); goals.save(); render(); }
      if (e.target.id === 'gEnergy') { G().energyGoal = Math.max(50, parseInt(e.target.value) || 400); goals.save(); render(); }
    });
  },
  onShow(){ render(); J.say(message()); },
  unmount(){ root = null; },
});
})();
