/* ============================================================
   Module 02 — Santé
   Données Apple Santé envoyées par le raccourci iPhone (pas, énergie,
   sommeil, fréquence cardiaque…), objectifs et historique 7 jours.
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
const lastNight = () => { const t = today(); return t && t.sleep ? t.sleep : null; };

function ring(ratio, size, label, sub){
  const r = 42, C = 2 * Math.PI * r, v = Math.max(0, Math.min(ratio, 1));
  const col = ratio >= 1 ? '#4dffc3' : '#3fe0ff';
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
function bars(series, goal, fmtV){
  const max = Math.max(goal || 0, ...series.map(s => s.v || 0)) || 1;
  return `<div class="bars">${series.map(s => `<div class="bar-col"><div class="bar-v">${s.v !== null ? fmtV(s.v) : ''}</div>
    <div class="bar-t"><i style="height:${(s.v || 0) / max * 100}%" class="${goal && s.v >= goal ? 'ok' : ''}"></i>${goal ? `<span class="goal" style="bottom:${goal / max * 100}%"></span>` : ''}</div>
    <div class="bar-d">${s.d.toLocaleDateString('fr-FR', {weekday:'short'}).slice(0, 2)}</div></div>`).join('')}</div>`;
}

function render(){
  if (!root) return;
  const t = today() || {}, doc = J.appleDoc();
  const steps = t.steps || 0;
  root.innerHTML = !doc.syncedAt ? `
    <section class="panel"><div class="empty" style="padding:24px 16px">
      <p>Aucune donnée reçue pour le moment.</p>
      <button class="btn primary" data-act="guide">CONNECTER APPLE SANTÉ</button></div></section>` : `
    <div class="sante-top">
      ${ring(steps / G().stepGoal, 200, fmt(steps), 'PAS · OBJECTIF ' + fmt(G().stepGoal))}
    </div>
    <div class="stats3">
      <div class="st"><div class="k">ÉNERGIE</div><div class="v">${t.energy ? fmt(t.energy) : '—'}</div><div class="s">kcal actives</div></div>
      <div class="st"><div class="k">SOMMEIL</div><div class="v">${t.sleep ? hours(t.sleep) : '—'}</div><div class="s">objectif ${G().sleepGoal} h</div></div>
      <div class="st"><div class="k">${t.heart ? 'CŒUR' : 'DISTANCE'}</div><div class="v">${t.heart ? Math.round(t.heart) : t.distance ? t.distance.toLocaleString('fr-FR', {maximumFractionDigits:1}) : '—'}</div><div class="s">${t.heart ? 'bpm' : 'km'}</div></div>
    </div>
    <section class="panel"><div class="ph"><span>PAS · 7 JOURS</span><span>moy. ${fmt(avg(last7('steps')))}</span></div>${bars(last7('steps'), G().stepGoal, v => v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v))}</section>
    <section class="panel"><div class="ph"><span>SOMMEIL · 7 JOURS</span><span>moy. ${hours(avg(last7('sleep')) || 0)}</span></div>${bars(last7('sleep'), G().sleepGoal, v => v.toFixed(1).replace('.', ','))}</section>
    <section class="panel"><div class="ph"><span>OBJECTIFS</span><span></span></div>
      <div class="goals">
        <label>Pas par jour<input id="gSteps" type="number" inputmode="numeric" value="${G().stepGoal}"></label>
        <label>Heures de sommeil<input id="gSleep" type="number" inputmode="decimal" step="0.5" value="${G().sleepGoal}"></label>
      </div></section>
    <button class="sync-row" data-act="runsync">↻ Synchroniser maintenant · dernière synchro ${J.ago(doc.syncedAt)}</button>
    <button class="sync-row" data-act="guide">Guide de configuration du raccourci</button>`;
}
const avg = s => { const v = s.filter(x => x.v !== null).map(x => x.v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

function message(){
  const t = today();
  if (!J.appleDoc().syncedAt) return 'Aucune donnée de santé reçue. Configurez le raccourci iPhone pour commencer.';
  if (!t || !t.steps) return 'Pas encore de données aujourd\'hui. Lancez une synchronisation.';
  const r = t.steps / G().stepGoal;
  if (r >= 1) return `Objectif atteint : ${fmt(t.steps)} pas. Remarquable.`;
  const left = G().stepGoal - t.steps;
  return `${fmt(t.steps)} pas pour l'instant. Encore ${fmt(left)} pour atteindre votre objectif, soit environ ${Math.round(left / 100)} minutes de marche.`;
}

J.module({
  id: 'sante',
  code: '02',
  order: 10,
  name: 'Santé',
  tagline: 'Pas, sommeil et activité (Apple Santé)',
  accent: '#ff5f8f',
  cls: 'sante',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3 12h4l2-3 3 6 2-3h7"/></svg>',

  init(){
    goals = J.store('sante', {stepGoal:8000, sleepGoal:8});
    goals.onChange(render);
    J.store('apple', {days:{}}).onChange(() => { render(); });
  },
  summary(){
    const t = today();
    if (!J.appleDoc().syncedAt) return 'À connecter';
    return t && t.steps ? `<b>${fmt(t.steps)}</b> pas${t.sleep ? `<br>Nuit : ${hours(t.sleep)}` : ''}` : 'Pas encore de données';
  },
  briefing(){
    if (!J.appleDoc().syncedAt) return null;
    const t = today() || {}, steps = t.steps || 0, r = steps / G().stepGoal;
    const sleepTxt = t.sleep ? (t.sleep < G().sleepGoal - 1 ? 'Nuit courte, couchez-vous tôt ce soir.' : 'Bonne nuit de récupération.') : '';
    return {order:10, cls:'wide', icon:J.modules.find(m => m.id === 'sante').icon, title:'ACTIVITÉ', act:'mod:sante', right:'›', body:`
      <div class="act">${ring(r, 74, Math.round(r * 100) + '%', '')}
        <div class="actd"><b>${fmt(steps)}</b> pas / ${fmt(G().stepGoal)}<br>
        ${t.energy ? fmt(t.energy) + ' kcal actives' : ''}${t.energy && t.sleep ? ' · ' : ''}${t.sleep ? 'nuit de ' + hours(t.sleep) : ''}
        ${sleepTxt ? `<br><span class="muted">${sleepTxt}</span>` : ''}</div></div>`};
  },
  briefingSpeech(){
    const t = today();
    if (!t) return '';
    const p = [];
    if (t.sleep) p.push(`Vous avez dormi ${hours(t.sleep).replace(' h ', ' heures ').replace(/ h$/, ' heures')}.`);
    if (t.steps) p.push(`${fmt(t.steps)} pas pour l'instant${t.steps >= G().stepGoal ? ', objectif atteint' : ''}.`);
    return p.join(' ');
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
      if (e.target.id === 'gSleep') { G().sleepGoal = Math.max(4, parseFloat(String(e.target.value).replace(',', '.')) || 8); goals.save(); render(); }
    });
  },
  unmount(){ root = null; },
});
})();
