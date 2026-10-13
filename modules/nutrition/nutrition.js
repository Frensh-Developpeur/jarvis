/* ============================================================
   Module 03 — Nutrition
   Objectif calories + macros (protéines, glucides, lipides),
   journal par repas, aliments de base CIQUAL (hors ligne),
   produits Open Food Facts (recherche + code-barres), aliments perso.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, uid, r2} = J;

const MEALS = [
  {id:'pdj', name:'Petit-déjeuner', short:'P.-DÉJ', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 2c0 2 2 2 2 4M12 2c0 2 2 2 2 4"/></svg>'},
  {id:'dej', name:'Déjeuner', short:'DÉJEUNER', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="7"/><circle cx="12" cy="13" r="3.5"/><path d="M3 3v6M5 3v6M4 9v12M20 3c-1.5 1-2 3-2 6h2v12"/></svg>'},
  {id:'col', name:'Collation', short:'COLLATION', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 21c-4 0-7-3.5-7-8 0-3 2-5 4.5-5 1.2 0 1.8.5 2.5.5s1.3-.5 2.5-.5C17 8 19 10 19 13c0 4.5-3 8-7 8z"/><path d="M12 8c0-2 1-4 3-5"/></svg>'},
  {id:'din', name:'Dîner', short:'DÎNER', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'},
];
const MAC = {p:{name:'Protéines', short:'PROT', c:'#4dffc3'}, c:{name:'Glucides', short:'GLUC', c:'#ffb347'}, f:{name:'Lipides', short:'LIP', c:'#ff5f8f'}};
const ICON_SCAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

/* ---------- dates ---------- */
const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const parseDk = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (k, n) => { const d = parseDk(k); d.setDate(d.getDate() + n); return dk(d); };
const today = () => dk(new Date());
const dayLabel = k => k === today() ? "Aujourd'hui" : k === addDays(today(), -1) ? 'Hier' : parseDk(k).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const hhmm = d => d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
const g1 = n => (Math.round(n * 10) / 10).toLocaleString('fr-FR');
const defaultMeal = () => { const h = new Date().getHours() + new Date().getMinutes() / 60; return h < 10.5 ? 'pdj' : h < 15 ? 'dej' : h < 18 ? 'col' : 'din'; };

/* ---------- état ---------- */
let st = null, root = null, fixed = null;
let day = today(), tab = 'jour', histRange = 7;
const S = () => st.data;
const save = () => st.save();
const DEFAULTS = {goals:{kcal:2200, p:140, c:250, f:70}, addActive:false, mode:'fixed', plan:{rate:-0.25}, weights:{}, profile:null, days:{}, foods:[], recents:[], favs:[]};

const items = k => ((S().days[k] || {}).items || []);
const val = (it, key) => it.per100[key] * it.g / 100;
function sums(list){
  const o = {kcal:0, p:0, c:0, f:0};
  list.forEach(it => { o.kcal += val(it, 'kcal'); o.p += val(it, 'p'); o.c += val(it, 'c'); o.f += val(it, 'f'); });
  return o;
}
/* ============================================================
   Moteur de calcul de l'objectif
   - fixe : valeurs saisies (+ calories actives Apple en option)
   - adaptatif : métabolisme de base (Apple ou Mifflin-St Jeor) + activité
     mesurée par Apple Santé + digestion, calibré sur l'évolution réelle
     du poids, puis ajusté selon le rythme visé (kg / semaine)
   ============================================================ */
const RATES = [[-0.75, 'Perte rapide'], [-0.5, 'Perte'], [-0.25, 'Perte douce'], [0, 'Maintien'], [0.25, 'Prise douce'], [0.5, 'Prise de masse']];
const rateLabel = r => (RATES.find(x => x[0] === r) || [0, 'Maintien'])[1];
const kgw = r => (r > 0 ? '+' : r < 0 ? '−' : '') + String(Math.abs(r)).replace('.', ',') + ' kg / sem.';
const appleDay = k => (J.appleDoc().days || {})[k] || {};
function weightMap(){
  const m = {};
  Object.entries(J.appleDoc().days || {}).forEach(([k, d]) => { if (d.weight > 25 && d.weight < 300) m[k] = d.weight; });
  return Object.assign(m, S().weights);          // les pesées manuelles priment
}
function weightAt(k){ const m = weightMap(), ks = Object.keys(m).filter(x => x <= k).sort(); return ks.length ? m[ks[ks.length - 1]] : null; }
function latestWeight(){ const m = weightMap(), ks = Object.keys(m).sort(); return ks.length ? {k:ks[ks.length - 1], kg:m[ks[ks.length - 1]], apple:!S().weights[ks[ks.length - 1]]} : null; }
const profileOk = () => { const p = S().profile; return !!(p && p.age > 10 && p.cm > 120 && (p.kg > 30 || latestWeight())); };
const bmrFor = k => { const p = S().profile, kg = weightAt(k) || p.kg; return 10 * kg + 6.25 * p.cm - 5 * p.age + (p.sex === 'f' ? -161 : 5); };
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
/* activité habituelle : moyenne des 7 derniers jours mesurés par Apple (hors jour en cours) */
function activeExpected(k){ const v = []; for (let i = 1; i <= 7; i++) { const e = appleDay(addDays(k, -i)).energy; if (e > 0) v.push(e); } return v.length >= 2 ? avg(v) : null; }
function basalAvg(k){ const v = []; for (let i = 1; i <= 14; i++) { const b = appleDay(addDays(k, -i)).basal; if (b > 800 && b < 4000) v.push(b); } return v.length >= 2 ? avg(v) : null; }
function rawTdee(k){
  const p = S().profile, bmr = bmrFor(k), basal = basalAvg(k), base = basal || bmr;
  const declared = Math.max(0, bmr * (0.9 * (p.act || 1.375) - 1));        // activité déduite du niveau déclaré
  const measured = appleDay(k).energy > 0 ? appleDay(k).energy : null, expected = activeExpected(k);
  let act, src, live = null;
  if (k === today()) {
    /* journée en cours : ce qui est déjà mesuré par Apple + ce qu'il reste à dépenser d'ici ce soir
       (activité habituelle répartie de 7 h à 23 h). Plus la journée avance, plus le mesuré compte. */
    const ref = expected !== null ? expected : declared;
    const at = appleDay(k).at ? new Date(appleDay(k).at) : null;
    if (measured !== null && at && dk(at) === k) {
      const h = at.getHours() + at.getMinutes() / 60, frac = Math.min(1, Math.max(0, (h - 7) / 16));
      const remaining = ref * (1 - frac);
      act = measured + remaining;
      live = {measured, remaining, at, frac, ref};
      src = frac >= 1 ? `mesurée par Apple (journée complète)` : `${fmt(measured)} kcal mesurées à ${hhmm(at)} + ${fmt(remaining)} prévues d'ici ce soir`;
    } else {
      act = ref;
      src = (expected !== null ? 'votre moyenne sur 7 jours' : 'niveau déclaré') + " · pas encore de données Apple aujourd'hui";
    }
  } else if (measured !== null) { act = measured; src = 'mesurée'; }
  else if (expected !== null) { act = expected; src = 'moyenne 7 jours'; }
  else { act = declared; src = 'niveau déclaré'; }
  const tef = (base + act) / 9;                                               // digestion ≈ 10 % de la dépense
  return {bmr, base, basal:!!basal, act, src, live, apple:measured !== null || expected !== null, tef, tdee:base + act + tef};
}
/* calibration : dépense réelle = apports moyens − variation de poids × 7 700 kcal/kg */
let calCache = null;
function calibration(){
  const key = st.updatedAt + '|' + (J.appleDoc().syncedAt || 0) + '|' + today();
  if (calCache && calCache.key === key) return calCache;
  const res = {key, factor:1, days:0, weighIns:0, ok:false};
  const wm = weightMap(), wk = Object.keys(wm).filter(k => k >= addDays(today(), -35) && k <= today()).sort();
  const intake = [];
  for (let i = 1; i <= 28; i++) { const k = addDays(today(), -i), list = items(k), kc = sums(list).kcal; if (list.length >= 2 && kc > 800) intake.push({kc, f:rawTdee(k).tdee}); }
  res.days = intake.length; res.weighIns = wk.length;
  if (wk.length >= 3 && intake.length >= 10) {
    const t0 = parseDk(wk[0]), pts = wk.map(k => [(parseDk(k) - t0) / 864e5, wm[k]]);
    if (pts[pts.length - 1][0] >= 10) {
      const mx = avg(pts.map(p => p[0])), my = avg(pts.map(p => p[1]));
      const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
      const observed = avg(intake.map(d => d.kc)) - slope * 7700, formula = avg(intake.map(d => d.f));
      const raw = Math.min(1.2, Math.max(0.8, observed / formula)), conf = Math.min(1, intake.length / 21);
      Object.assign(res, {ok:true, factor:1 + (raw - 1) * conf, observed, formula, slope, conf});
    }
  }
  return calCache = res;
}
function goalsFor(k){
  if (S().mode !== 'adaptive' || !profileOk()) {
    const g = S().goals, act = S().addActive && appleDay(k).energy > 0 ? Math.round(appleDay(k).energy) : 0;
    return {kcal:g.kcal + act, p:g.p, c:g.c, f:g.f, mode:'fixed', active:act};
  }
  const r = rawTdee(k), cal = calibration(), p = S().profile, rate = S().plan.rate;
  const tdee = r.tdee * cal.factor, delta = rate * 7700 / 7, floor = p.sex === 'f' ? 1200 : 1500;
  const kcal = Math.max(floor, Math.round((tdee + delta) / 10) * 10);
  const kg = weightAt(k) || p.kg, prot = Math.round(kg * (rate < 0 ? 2 : 1.8)), fat = Math.round(kcal * .27 / 9);
  return {kcal, p:prot, c:Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4)), f:fat, mode:'adaptive', r, cal, tdee, delta, rate, kg, floored:tdee + delta < floor};
}
const goalK = k => goalsFor(k).kcal;
function prune(){
  const keys = Object.keys(S().days).sort();
  if (keys.length > 180) keys.slice(0, keys.length - 180).forEach(k => delete S().days[k]);
}

/* ---------- messages de Jarvis ---------- */
function status(k){
  const list = items(k), s = sums(list), goal = goalK(k), left = goal - s.kcal;
  if (!list.length) return k === today() ? 'Aucun repas enregistré aujourd\'hui. Touchez + pour ajouter ce que vous mangez.' : 'Aucun repas enregistré ce jour-là.';
  const pLeft = goalsFor(k).p - s.p;
  if (left < -150) return `Objectif dépassé de ${fmt(-left)} kcal. Rien de dramatique, demain est un autre jour.`;
  if (left < 0) return `Objectif atteint, légèrement dépassé de ${fmt(-left)} kcal.`;
  return `Il vous reste ${fmt(left)} kcal.` + (pLeft > 15 ? ` Encore ${fmt(pLeft)} g de protéines à trouver.` : ' Apport en protéines au rendez-vous.');
}

/* ============================================================
   Base CIQUAL (aliments de base, hors ligne)
   ============================================================ */
let ciqual = null, ciqualLoading = null;
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe');
function loadCiqual(){
  if (ciqual) return Promise.resolve(ciqual);
  return ciqualLoading || (ciqualLoading = fetch('modules/nutrition/ciqual.json').then(r => r.json()).then(d => {
    ciqual = d.rows.map(r => ({name:r[0], n:norm(r[0]), per100:{kcal:r[1], p:r[2], c:r[3], f:r[4]}, fib:r[5], src:'ciqual'}));
    return ciqual;
  }));
}
function searchCiqual(q){
  if (!ciqual) return [];
  const toks = norm(q).split(/[\s,]+/).filter(Boolean);
  if (!toks.length) return [];
  const res = [];
  for (const f of ciqual) {
    if (!toks.every(t => f.n.includes(t))) continue;
    let score = 0;
    if (f.n.startsWith(toks[0])) score += 50;
    const first = f.n.split(/[ ,]/)[0];
    if (first === toks[0] || first === toks[0] + 's') score += 30;
    if (/\b(cru|cuit|nature)\b/.test(f.n)) score += 5;
    score -= f.n.length / 4;
    res.push({f, score});
  }
  return res.sort((a, b) => b.score - a.score).slice(0, 15).map(r => r.f);
}

/* ============================================================
   Interface
   ============================================================ */
const q = s => $(s, root);
const fq = s => $(s, fixed);

const TEMPLATE = `
  <div class="utabs" id="nTabs"><button data-tab="jour">JOUR</button><button data-tab="hist">HISTORIQUE</button><button data-tab="obj">OBJECTIFS</button></div>
  <div id="nTab"></div>`;

function macroBar(key, v, goal){
  const m = MAC[key], r = goal ? v / goal : 0;
  return `<div class="mac" style="--mc:${m.c}"><div class="mt"><span>${m.short}</span><b>${fmt(v)}<small> / ${fmt(goal)} g</small></b></div>
    <div class="mb"><i style="width:${Math.min(100, r * 100)}%" class="${r > 1.1 ? 'over' : ''}"></i></div><div class="ml">${r > 1 ? '+' + fmt(v - goal) + ' g' : 'reste ' + fmt(goal - v) + ' g'}</div></div>`;
}
function itemRow(it){
  return `<div class="srow" data-id="${it.id}">
    <div class="sbg"><span class="l"></span><button class="sact" type="button">Supprimer</button></div>
    <div class="row">
      <div class="info"><div class="l">${esc(it.name)}</div><div class="m">${fmt(it.g)} g${it.brand ? ' · ' + esc(it.brand) : ''} · P ${g1(val(it, 'p'))} · G ${g1(val(it, 'c'))} · L ${g1(val(it, 'f'))}</div></div>
      <div class="kc">${fmt(val(it, 'kcal'))}<small>kcal</small></div>
    </div></div>`;
}
function renderJour(){
  const k = day, list = items(k), s = sums(list), G = goalsFor(k), goal = G.kcal;
  const left = goal - s.kcal, ratio = goal ? s.kcal / goal : 0;
  const yest = items(addDays(k, -1));
  q('#nTab').innerHTML = `
    <div class="mnav">
      <button data-day="-1" aria-label="Jour précédent">‹</button>
      <div class="lbl">${esc(dayLabel(k))}<small>${parseDk(k).toLocaleDateString('fr-FR', {day:'numeric', month:'short', year:'numeric'}).toUpperCase()}</small></div>
      <button data-day="1" aria-label="Jour suivant" ${k >= today() ? 'disabled' : ''}>›</button>
    </div>
    <div class="reactor" id="nReactor" title="Touchez pour un rapport vocal">
      ${J.reactorSVG('n')}
      <div class="core">
        <div class="k">${left >= 0 ? 'RESTANT' : 'DÉPASSEMENT'}</div>
        <div class="v ${left < 0 ? 'neg' : ''}">${fmt(Math.abs(left))}<small> kcal</small></div>
        <div class="s"><b>${fmt(s.kcal)}</b> / ${fmt(goal)} kcal</div>
        ${G.mode === 'adaptive' ? `<div class="r">DÉPENSE ESTIMÉE ${fmt(G.tdee)} KCAL</div>` : G.active ? `<div class="r">DONT +${fmt(G.active)} KCAL ACTIVES</div>` : ''}
      </div>
    </div>
    <div class="macs">${macroBar('p', s.p, G.p)}${macroBar('c', s.c, G.c)}${macroBar('f', s.f, G.f)}</div>
    ${G.mode === 'adaptive' ? `<div class="live-act">${G.r.live && k === today() ? `<div class="la-bar"><i style="width:${Math.min(100, G.r.live.measured / G.r.act * 100)}%"></i></div>
        <div class="la-txt"><span>Activité : <b>${fmt(G.r.live.measured)}</b> kcal mesurées à ${hhmm(G.r.live.at)}</span><span>prévu ${fmt(G.r.act)}</span></div>` : ''}
        <div class="la-btns"><button class="why" data-a="why"><span class="dot"></span><u>Comment est calculé l'objectif ?</u></button>${k === today() && J.appleDoc().syncedAt ? '<button class="why" data-a="sync">↻ Actualiser</button>' : ''}</div></div>`
      : `<button class="why" data-a="goadapt">Objectif fixe · <u>passer à l'objectif adaptatif (Apple Santé)</u></button>`}
    ${MEALS.map(m => {
      const li = list.filter(it => it.meal === m.id), ms = sums(li);
      const canCopy = !li.length && yest.some(it => it.meal === m.id);
      return `<section class="panel meal"><div class="mh"><span class="mi">${m.icon}</span><span class="mn">${m.name.toUpperCase()}</span>
          <span class="mk">${li.length ? fmt(ms.kcal) + ' kcal' : ''}</span><button class="madd" data-add="${m.id}" aria-label="Ajouter">+</button></div>
        ${li.map(itemRow).join('')}
        ${!li.length ? `<div class="mempty">${canCopy ? `<button class="chip" data-copy="${m.id}">↺ Reprendre ${m.name.toLowerCase()} d'hier</button>` : '<span>Rien pour l\'instant</span>'}</div>` : ''}
      </section>`;
    }).join('')}
    ${list.length ? '<p class="hint">Touchez un aliment pour changer la quantité · glissez ← pour le supprimer.</p>' : ''}`;
  J.setArc(q('#nReactor'), ratio, ratio > 1.1 ? '#ff4d3d' : ratio > 1 ? '#ffb347' : '#4dffc3');
}

function renderHist(){
  const G = goalsFor(today()), days = [];
  for (let i = histRange - 1; i >= 0; i--) { const k = addDays(today(), -i); days.push({k, s:sums(items(k)), n:items(k).length, goal:goalK(k)}); }
  const logged = days.filter(d => d.n);
  const avg = key => logged.length ? logged.reduce((a, d) => a + d.s[key], 0) / logged.length : 0;
  const max = Math.max(G.kcal * 1.3, ...days.map(d => d.s.kcal), 1);
  let streak = 0; for (let i = 0; ; i++) { const k = addDays(today(), -i); if (items(k).length) streak++; else if (i > 0 || items(today()).length) break; else continue; if (i > 365) break; }
  const onTarget = logged.filter(d => Math.abs(d.s.kcal - d.goal) <= d.goal * .1).length;
  q('#nTab').innerHTML = `
    <div class="seg range" id="nRange" style="margin-top:12px"><button data-range="7" class="${histRange === 7 ? 'on' : ''}">7 JOURS</button><button data-range="30" class="${histRange === 30 ? 'on' : ''}">30 JOURS</button></div>
    <div class="kpis">
      <div class="kpi"><div class="k">MOYENNE</div><div class="v">${fmt(avg('kcal'))}<small> kcal</small></div></div>
      <div class="kpi"><div class="k">DANS LA CIBLE</div><div class="v">${onTarget}/${logged.length}<small> j</small></div></div>
      <div class="kpi"><div class="k">SÉRIE</div><div class="v">${streak}<small> j</small></div></div>
    </div>
    <section class="panel"><div class="ph"><span>CALORIES</span><span>objectif ${G.mode === 'adaptive' ? 'du jour ' : ''}${fmt(G.kcal)}</span></div>
      <div class="hbars ${histRange === 30 ? 'dense' : ''}">${days.map(d => {
        const r = d.goal ? d.s.kcal / d.goal : 0, cls = !d.n ? '' : Math.abs(r - 1) <= .1 ? 'ok' : r > 1.1 ? 'over' : 'under';
        return `<button class="hb" data-goday="${d.k}"><div class="hv">${d.n && histRange === 7 ? fmt(d.s.kcal) : ''}</div><div class="ht"><i class="${cls}" style="height:${d.s.kcal / max * 100}%"></i><span class="goal" style="bottom:${G.kcal / max * 100}%"></span></div>
          <div class="hd">${histRange === 7 ? parseDk(d.k).toLocaleDateString('fr-FR', {weekday:'short'}).slice(0, 2) : (parseDk(d.k).getDate() % 5 === 1 ? parseDk(d.k).getDate() : '')}</div></button>`; }).join('')}</div>
      <p class="note pad"><i class="lgd ok"></i>dans la cible (±10 %) <i class="lgd under"></i>en dessous <i class="lgd over"></i>au-dessus</p>
    </section>
    ${weightPanel()}
    <section class="panel"><div class="ph"><span>MACROS MOYENNES</span><span>${logged.length} jour${logged.length > 1 ? 's' : ''} saisi${logged.length > 1 ? 's' : ''}</span></div>
      <div class="macs pad">${macroBar('p', avg('p'), G.p)}${macroBar('c', avg('c'), G.c)}${macroBar('f', avg('f'), G.f)}</div>
    </section>
    <section class="panel"><div class="ph"><span>JOURNAL</span><span></span></div>
      ${[...days].reverse().filter(d => d.n).map(d => `<button class="hrow" data-goday="${d.k}"><span>${esc(dayLabel(d.k))}</span><span class="m">P ${fmt(d.s.p)} · G ${fmt(d.s.c)} · L ${fmt(d.s.f)}</span><b>${fmt(d.s.kcal)} kcal</b></button>`).join('') || '<div class="empty">Aucun jour saisi sur la période.</div>'}
    </section>`;
}

function weightPanel(){
  const wm = weightMap(), ks = Object.keys(wm).filter(k => k >= addDays(today(), -60)).sort();
  if (!ks.length) return `<section class="panel"><div class="ph"><span>POIDS</span><span></span></div><div class="empty">Aucune pesée. Elles permettent d'adapter votre objectif à votre dépense réelle.<br><button class="chip" data-a="weigh" style="margin-top:10px">+ AJOUTER UNE PESÉE</button></div></section>`;
  const W = 320, H = 120, span = Math.max(14, Math.round((parseDk(today()) - parseDk(ks[0])) / 864e5)), t0 = parseDk(addDays(today(), -span));
  const pts = ks.map(k => ({k, x:(parseDk(k) - t0) / 864e5 * 60 / span, y:wm[k]}));
  const min = Math.min(...pts.map(p => p.y)) - .5, max = Math.max(...pts.map(p => p.y)) + .5;
  const X = x => 8 + x / 60 * (W - 16), Y = y => H - 14 - (y - min) / (max - min) * (H - 28);
  // tendance sur 21 jours (régression linéaire)
  const rec = pts.filter(p => p.k >= addDays(today(), -21)).map(p => ({x:(parseDk(p.k) - t0) / 864e5, y:p.y})); let trend = '';
  if (rec.length >= 2 && rec[rec.length - 1].x - rec[0].x >= 6) {
    const mx = avg(rec.map(p => p.x)), my = avg(rec.map(p => p.y));
    const sl = rec.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / rec.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    trend = `Tendance : <b>${sl * 7 > 0 ? '+' : ''}${g1(sl * 7)} kg / semaine</b>`;
  }
  const last = pts[pts.length - 1];
  return `<section class="panel"><div class="ph"><span>POIDS</span><button class="chip sm" data-a="weigh">+ PESÉE</button></div>
    <div class="wnow"><b>${g1(last.y)} kg</b><span>${esc(dayLabel(last.k))}${trend ? ' · ' + trend : ''}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="wchart">
      <polyline points="${pts.map(p => X(p.x) + ',' + Y(p.y)).join(' ')}" fill="none" stroke="#4dffc3" stroke-width="2" style="filter:drop-shadow(0 0 4px #4dffc3)"/>
      ${pts.map(p => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2.6" fill="#4dffc3"/>`).join('')}
      <text x="8" y="${H - 2}" class="ax">−${span} j</text><text x="${W - 8}" y="${H - 2}" text-anchor="end" class="ax">aujourd'hui</text>
    </svg></section>`;
}

function renderObj(){
  const adaptive = S().mode === 'adaptive';
  const modeSeg = `<div class="seg mode" id="oMode"><button data-mode="adaptive" class="${adaptive ? 'on' : ''}">ADAPTATIF</button><button data-mode="fixed" class="${adaptive ? '' : 'on'}">FIXE</button></div>`;
  if (adaptive) return renderAdaptive(modeSeg);
  renderFixed(modeSeg);
}
function profileFields(){
  const pr = S().profile || {}, lw = latestWeight();
  return `<div class="calcf">
    <div class="seg" id="pSex"><button data-v="h" class="${pr.sex !== 'f' ? 'on' : ''}">HOMME</button><button data-v="f" class="${pr.sex === 'f' ? 'on' : ''}">FEMME</button></div>
    <div class="three">
      <label>Âge<input id="pAge" inputmode="numeric" value="${pr.age || ''}" placeholder="ans" autocomplete="off"></label>
      <label>Taille<input id="pCm" inputmode="numeric" value="${pr.cm || ''}" placeholder="cm" autocomplete="off"></label>
      <label>Poids<input id="pKg" inputmode="decimal" value="${lw ? g1(lw.kg) : pr.kg || ''}" placeholder="kg" autocomplete="off"></label>
    </div>
    <label class="sel">Activité habituelle <small>(utilisée seulement sans données Apple)</small><select id="pAct">
      ${[[1.2, 'Sédentaire'], [1.375, 'Légère (1 à 3 séances / sem.)'], [1.55, 'Modérée (3 à 5 séances / sem.)'], [1.725, 'Élevée (6 à 7 séances / sem.)'], [1.9, 'Très élevée']]
        .map(([v, l]) => `<option value="${v}" ${+(pr.act || 1.375) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  </div>`;
}
function renderAdaptive(modeSeg){
  if (!profileOk()) {
    q('#nTab').innerHTML = modeSeg + `
      <section class="panel"><div class="ph"><span>VOTRE PROFIL</span><span></span></div>
        <p class="note pad">Pour calculer votre dépense réelle, j'ai besoin de quelques informations. Votre activité sera ensuite mesurée chaque jour par Apple Santé.</p>
        ${profileFields()}
        <div class="pad"><button class="btn primary" data-a="saveprofile">ACTIVER L'OBJECTIF ADAPTATIF</button></div>
      </section>`;
    return;
  }
  const G = goalsFor(today()), r = G.r, cal = G.cal, lw = latestWeight();
  const appleDays = Array.from({length:7}, (_, i) => appleDay(addDays(today(), -i - 1)).energy > 0).filter(Boolean).length;
  const weeks4 = G.rate * 4;
  q('#nTab').innerHTML = modeSeg + `
    <div class="ohero">
      <small>OBJECTIF D'AUJOURD'HUI</small>
      <b>${fmt(G.kcal)} <span>kcal</span></b>
      <div class="omac"><span style="--mc:${MAC.p.c}">P ${G.p} g</span><span style="--mc:${MAC.c.c}">G ${G.c} g</span><span style="--mc:${MAC.f.c}">L ${G.f} g</span></div>
      <button class="lnk" data-a="why">Voir le détail du calcul ›</button>
    </div>
    <section class="panel"><div class="ph"><span>RYTHME VISÉ</span><span>${kgw(G.rate)}</span></div>
      <div class="rates">${RATES.map(([v, l]) => `<button data-rate="${v}" class="${v === G.rate ? 'on' : ''}"><b>${v > 0 ? '+' : v < 0 ? '−' : ''}${String(Math.abs(v)).replace('.', ',')}</b><small>${l}</small></button>`).join('')}</div>
      <p class="note pad">${G.rate ? `Soit environ <b>${weeks4 > 0 ? '+' : '−'}${g1(Math.abs(weeks4))} kg en 4 semaines</b> (${G.delta > 0 ? '+' : '−'}${fmt(Math.abs(G.delta))} kcal / jour).` : 'Apports alignés sur votre dépense : poids stable.'}
        ${G.floored ? '<br><span class="warn">Plancher de sécurité atteint : objectif limité pour rester au-dessus du minimum recommandé.</span>' : ''}</p>
    </section>
    <section class="panel"><div class="ph"><span>SOURCES</span><span></span></div>
      <div class="srcs">
        <div class="src ${appleDays ? 'ok' : ''}"><span></span><div><b>Activité Apple Santé</b><small>${appleDays ? `${appleDays} jour${appleDays > 1 ? 's' : ''} mesuré${appleDays > 1 ? 's' : ''} sur 7 · moyenne ${fmt(activeExpected(today()) || 0)} kcal` : 'Pas encore de données : niveau déclaré utilisé'}</small></div>${appleDays ? '' : '<button class="chip sm" data-a="guide">CONNECTER</button>'}</div>
        <div class="src ${r.basal ? 'ok' : 'mid'}"><span></span><div><b>Métabolisme de base</b><small>${r.basal ? `Mesuré par Apple : ${fmt(r.base)} kcal / jour` : `Calculé (Mifflin-St Jeor) : ${fmt(r.bmr)} kcal · facultatif : ajoutez l'énergie au repos au raccourci`}</small></div></div>
        <div class="src ${lw ? 'ok' : ''}"><span></span><div><b>Poids</b><small>${lw ? `${g1(lw.kg)} kg · ${esc(dayLabel(lw.k))}${lw.apple ? ' (Apple)' : ''} · ${cal.weighIns} pesée${cal.weighIns > 1 ? 's' : ''} sur 5 sem.` : 'Aucune pesée'}</small></div><button class="chip sm" data-a="weigh">+ PESÉE</button></div>
        <div class="src ${cal.ok ? 'ok' : 'mid'}"><span></span><div><b>Calibration</b><small>${cal.ok ? `Dépense réelle observée ${fmt(cal.observed)} kcal · correction ${cal.factor >= 1 ? '+' : '−'}${Math.round(Math.abs(cal.factor - 1) * 100)} %` : `En apprentissage : ${Math.min(cal.days, 10)}/10 jours de repas complets et ${Math.min(cal.weighIns, 3)}/3 pesées sur 10 jours`}</small></div></div>
      </div>
    </section>
    <section class="panel"><div class="ph"><span>PROFIL</span><span></span></div>${profileFields()}</section>`;
}
function renderFixed(modeSeg){
  const G = S().goals, fromMac = G.p * 4 + G.c * 4 + G.f * 9, pr = S().profile || {};
  const pct = k => fromMac ? Math.round(G[k] * (k === 'f' ? 9 : 4) / fromMac * 100) : 0;
  q('#nTab').innerHTML = modeSeg + `
    <section class="panel"><div class="ph"><span>OBJECTIFS QUOTIDIENS</span><span></span></div>
      <div class="ogrid">
        <label class="okcal">Calories<input id="oKcal" inputmode="numeric" value="${G.kcal}"><small>kcal / jour</small></label>
        <label style="--mc:${MAC.p.c}">Protéines<input id="oP" inputmode="numeric" value="${G.p}"><small>g · ${pct('p')} %</small></label>
        <label style="--mc:${MAC.c.c}">Glucides<input id="oC" inputmode="numeric" value="${G.c}"><small>g · ${pct('c')} %</small></label>
        <label style="--mc:${MAC.f.c}">Lipides<input id="oF" inputmode="numeric" value="${G.f}"><small>g · ${pct('f')} %</small></label>
      </div>
      <p class="note pad ${Math.abs(fromMac - G.kcal) > G.kcal * .08 ? 'warn' : ''}">Vos macros représentent <b>${fmt(fromMac)} kcal</b> (1 g de protéines ou glucides = 4 kcal, 1 g de lipides = 9 kcal).
        ${Math.abs(fromMac - G.kcal) > G.kcal * .08 ? ` Écart avec l'objectif : ${fmt(fromMac - G.kcal)} kcal. <button class="linkbtn" data-a="fitkcal">Aligner les calories sur les macros</button>` : ''}</p>
      <div class="toggle pad"><span>Ajouter mes calories actives<small>L'énergie dépensée (Apple Santé) augmente le budget du jour</small></span><label class="sw"><input type="checkbox" id="oActive" ${S().addActive ? 'checked' : ''}><i></i></label></div>
    </section>
    <section class="panel"><div class="ph"><span>CALCULER MES BESOINS</span><span>Mifflin-St Jeor</span></div>
      <div class="calcf">
        <div class="seg" id="cSex"><button data-v="h" class="${pr.sex !== 'f' ? 'on' : ''}">HOMME</button><button data-v="f" class="${pr.sex === 'f' ? 'on' : ''}">FEMME</button></div>
        <div class="three">
          <label>Âge<input id="cAge" inputmode="numeric" value="${pr.age || ''}" placeholder="ans"></label>
          <label>Poids<input id="cKg" inputmode="decimal" value="${pr.kg || ''}" placeholder="kg"></label>
          <label>Taille<input id="cCm" inputmode="numeric" value="${pr.cm || ''}" placeholder="cm"></label>
        </div>
        <label class="sel">Activité<select id="cAct">
          ${[[1.2, 'Sédentaire (bureau, peu de sport)'], [1.375, 'Légère (sport 1 à 3 fois / semaine)'], [1.55, 'Modérée (sport 3 à 5 fois / semaine)'], [1.725, 'Élevée (sport 6 à 7 fois / semaine)'], [1.9, 'Très élevée (travail physique + sport)']]
            .map(([v, l]) => `<option value="${v}" ${+pr.act === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="sel">Objectif<select id="cGoal">
          ${[['cut', 'Perte de poids (−20 %)'], ['mild', 'Perte douce (−10 %)'], ['keep', 'Maintien'], ['bulk', 'Prise de masse (+10 %)']]
            .map(([v, l]) => `<option value="${v}" ${(pr.goal || 'keep') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn" data-a="calc">CALCULER</button>
        <div id="cOut"></div>
      </div>
    </section>`;
}

function render(){
  if (!root) return;
  $$('#nTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({jour:renderJour, hist:renderHist, obj:renderObj})[tab]();
}

/* ============================================================
   Ajout d'aliments
   ============================================================ */
const FIXED = `
  <button class="fab" id="nAddBtn" aria-label="Ajouter un aliment">+</button>

  <div class="sheet nut" id="nAdd" role="dialog" aria-label="Ajouter un aliment">
    <div class="grab"></div>
    <div id="nStepSearch">
      <h2>AJOUTER UN ALIMENT</h2>
      <div class="seg meals" id="aMeal">${MEALS.map(m => `<button data-v="${m.id}">${m.short}</button>`).join('')}</div>
      <div class="sbar"><input id="aQ" placeholder="Rechercher : riz, poulet, skyr…" autocomplete="off" enterkeyhint="search"><button class="scan" id="aScan" aria-label="Scanner un code-barres">${ICON_SCAN}</button></div>
      <div id="aRes"></div>
      <button class="btn ghost" id="aCustom">+ CRÉER UN ALIMENT</button>
    </div>

    <div id="nStepQty" hidden>
      <button class="back" id="qBack">‹ Retour</button>
      <div class="qhead"><div><h3 id="qName"></h3><p id="qSub"></p></div><button class="fav" id="qFav" aria-label="Favori">${ICON_STAR}</button></div>
      <div class="field amtfield"><input id="qG" class="big" inputmode="decimal" autocomplete="off"><span class="cur">g</span></div>
      <div class="qchips" id="qChips"></div>
      <div class="qprev" id="qPrev"></div>
      <div class="seg meals" id="qMeal">${MEALS.map(m => `<button data-v="${m.id}">${m.short}</button>`).join('')}</div>
      <button class="btn primary" id="qSave">AJOUTER</button>
      <button class="btn danger" id="qDel" hidden>SUPPRIMER</button>
    </div>

    <div id="nStepCustom" hidden>
      <button class="back" id="cBack">‹ Retour</button>
      <h2>NOUVEL ALIMENT</h2>
      <p class="note">Valeurs indiquées sur l'emballage, <b>pour 100 g</b>.</p>
      <div class="field"><label>NOM</label><input id="fName" maxlength="60" autocomplete="off" placeholder="Ex : Wrap maison"></div>
      <div class="two">
        <div class="field"><label>KCAL / 100 G</label><input id="fK" inputmode="decimal"></div>
        <div class="field"><label>PORTION (G, FACULTATIF)</label><input id="fS" inputmode="decimal"></div>
      </div>
      <div class="three">
        <div class="field"><label>PROT.</label><input id="fP" inputmode="decimal"></div>
        <div class="field"><label>GLUC.</label><input id="fC" inputmode="decimal"></div>
        <div class="field"><label>LIP.</label><input id="fF" inputmode="decimal"></div>
      </div>
      <button class="btn primary" id="fSave">ENREGISTRER L'ALIMENT</button>
    </div>
  </div>

  <div class="sheet nut" id="nWhy" role="dialog" aria-label="Détail de l'objectif"><div class="grab"></div><div id="nWhyB"></div></div>

  <div class="sheet nut" id="nWeigh" role="dialog" aria-label="Pesée">
    <div class="grab"></div>
    <h2>NOUVELLE PESÉE</h2>
    <p class="note">Pesez-vous de préférence le matin, à jeun, dans les mêmes conditions. 2 à 3 pesées par semaine suffisent.</p>
    <div class="field amtfield"><input id="wKg" class="big" inputmode="decimal" autocomplete="off" placeholder="0,0"><span class="cur">kg</span></div>
    <div class="field"><label>DATE</label><input id="wDate" type="date"></div>
    <button class="btn primary" id="wSave">ENREGISTRER</button>
    <div id="wList"></div>
  </div>

  <div class="scanner" id="nScan" hidden>
    <video id="sVideo" playsinline muted autoplay></video>
    <div class="sframe"><span></span></div>
    <p class="stxt" id="sTxt">Placez le code-barres dans le cadre</p>
    <div class="sbtns"><input id="sCode" inputmode="numeric" placeholder="ou tapez le code" autocomplete="off"><button class="btn" id="sGo">OK</button></div>
    <button class="btn ghost" id="sClose">ANNULER</button>
  </div>`;

let addMeal = 'dej', pick = null;   // pick = {food, item?}
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; };
const foodKey = f => f.code || (f.src + ':' + f.name);

function setSeg(sel, v){ $$(sel + ' button', fixed).forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
function openAdd(meal){
  addMeal = meal || (day === today() ? defaultMeal() : 'dej');
  setSeg('#aMeal', addMeal);
  fq('#aQ').value = '';
  step('search'); renderResults();
  J.openSheet(fq('#nAdd'));
  loadCiqual().then(() => { if (fq('#aQ').value) renderResults(); });
}
function step(name){
  fq('#nStepSearch').hidden = name !== 'search';
  fq('#nStepQty').hidden = name !== 'qty';
  fq('#nStepCustom').hidden = name !== 'custom';
  fq('#nAdd').scrollTop = 0;
}

/* résultats : favoris / récents (sans recherche) puis CIQUAL + Open Food Facts */
let offTimer = null, offSeq = 0, offResults = null, offQuery = '';
function foodRow(f, i, group){
  const p = f.per100;
  return `<button class="fres" data-g="${group}" data-i="${i}">
    ${f.img ? `<img src="${esc(f.img)}" alt="" loading="lazy">` : `<span class="fsrc ${f.src}">${f.src === 'ciqual' ? 'BASE' : f.src === 'perso' ? 'PERSO' : 'PRODUIT'}</span>`}
    <span class="fi"><b>${esc(f.name)}</b><small>${f.brand ? esc(f.brand) + ' · ' : ''}P ${g1(p.p)} · G ${g1(p.c)} · L ${g1(p.f)}</small></span>
    <span class="fk">${fmt(p.kcal)}<small>kcal/100g</small></span></button>`;
}
let groups = {};
function renderResults(){
  const qv = fq('#aQ').value.trim();
  const out = [];
  groups = {};
  if (!qv) {
    groups.fav = S().favs.slice(0, 20);
    groups.rec = S().recents.filter(r => !S().favs.some(f => foodKey(f) === foodKey(r))).slice(0, 15);
    groups.perso = S().foods;
    if (groups.fav.length) out.push('<h4>★ FAVORIS</h4>' + groups.fav.map((f, i) => foodRow(f, i, 'fav')).join(''));
    if (groups.rec.length) out.push('<h4>RÉCENTS</h4>' + groups.rec.map((f, i) => foodRow(f, i, 'rec')).join(''));
    if (groups.perso.length) out.push('<h4>MES ALIMENTS</h4>' + groups.perso.map((f, i) => foodRow(f, i, 'perso')).join(''));
    if (!out.length) out.push('<p class="note center">Cherchez un aliment ou scannez un code-barres.<br>Vos aliments récents apparaîtront ici.</p>');
  } else {
    const nq = norm(qv);
    groups.perso = S().foods.filter(f => norm(f.name).includes(nq));
    groups.base = searchCiqual(qv);
    groups.off = offQuery === qv && offResults ? offResults : [];
    if (groups.perso.length) out.push('<h4>MES ALIMENTS</h4>' + groups.perso.map((f, i) => foodRow(f, i, 'perso')).join(''));
    out.push('<h4>ALIMENTS DE BASE <small>CIQUAL</small></h4>' + (groups.base.length ? groups.base.map((f, i) => foodRow(f, i, 'base')).join('') : `<p class="note">${ciqual ? 'Aucun aliment de base.' : 'Chargement…'}</p>`));
    out.push('<h4>PRODUITS <small>OPEN FOOD FACTS</small></h4>' + (offQuery !== qv || !offResults ? '<p class="note loading">Recherche en cours…</p>'
      : groups.off.length ? groups.off.map((f, i) => foodRow(f, i, 'off')).join('') : '<p class="note">Aucun produit trouvé.</p>'));
  }
  fq('#aRes').innerHTML = out.join('');
}
function searchOff(qv){
  clearTimeout(offTimer);
  if (qv.length < 2) return;
  offTimer = setTimeout(async () => {
    const my = ++offSeq;
    try {
      const {items: list} = await J.api('GET', '/api/food/search?q=' + encodeURIComponent(qv));
      if (my !== offSeq) return;
      offResults = list.map(f => Object.assign(f, {src:'off'})); offQuery = qv;
    } catch(e) { if (my === offSeq) { offResults = []; offQuery = qv; } }
    if (fq('#aQ').value.trim() === qv) renderResults();
  }, 450);
}

/* quantité */
function openQty(food, item){
  pick = {food, item:item || null};
  fq('#qName').textContent = food.name;
  fq('#qSub').textContent = (food.brand ? food.brand + ' · ' : '') + `${fmt(food.per100.kcal)} kcal / 100 g` + (food.src === 'ciqual' ? ' · CIQUAL' : food.src === 'off' ? ' · Open Food Facts' : '');
  const last = S().recents.find(r => foodKey(r) === foodKey(food));
  fq('#qG').value = item ? item.g : last && last.lastG ? last.lastG : food.serving || 100;
  const chips = [50, 100, 150, 200, 250];
  fq('#qChips').innerHTML = (food.serving ? `<button data-g="${food.serving}">1 portion · ${fmt(food.serving)} g</button>` : '') + chips.map(g => `<button data-g="${g}">${g} g</button>`).join('');
  setSeg('#qMeal', item ? item.meal : addMeal);
  fq('#qSave').textContent = item ? 'ENREGISTRER' : 'AJOUTER';
  fq('#qDel').hidden = !item;
  fq('#qBack').hidden = !!item;
  fq('#qFav').classList.toggle('on', S().favs.some(f => foodKey(f) === foodKey(food)));
  updatePrev();
  step('qty');
  if (!fq('#nAdd').classList.contains('show')) J.openSheet(fq('#nAdd'));
}
function updatePrev(){
  const g = num(fq('#qG').value) || 0, p = pick.food.per100;
  const v = k => p[k] * g / 100;
  fq('#qPrev').innerHTML = `<div class="pk"><b>${fmt(v('kcal'))}</b><small>KCAL</small></div>` +
    ['p', 'c', 'f'].map(k => `<div style="--mc:${MAC[k].c}"><b>${g1(v(k))} g</b><small>${MAC[k].short}</small></div>`).join('');
}
function remember(food, g){
  const clean = {name:food.name, brand:food.brand || '', per100:food.per100, src:food.src, code:food.code || null, serving:food.serving || null, img:food.img || null};
  S().recents = [Object.assign({}, clean, {lastG:g}), ...S().recents.filter(r => foodKey(r) !== foodKey(food))].slice(0, 40);
}
function saveQty(){
  const g = num(fq('#qG').value);
  if (!(g > 0)) { J.toast('Quantité invalide'); return; }
  const meal = $('#qMeal button.on', fixed).dataset.v;
  const f = pick.food;
  if (pick.item) {
    Object.assign(pick.item, {g, meal});
    J.toast('Quantité mise à jour');
  } else {
    const d = S().days[day] = S().days[day] || {items:[]};
    d.items.push({id:uid(), meal, name:f.name, brand:f.brand || '', g, per100:f.per100, src:f.src, code:f.code || null});
    J.toast(`${f.name.split(',')[0]} ajouté · ${fmt(f.per100.kcal * g / 100)} kcal`);
  }
  remember(f, g); prune();
  J.haptic(); save(); J.closeSheet(); render(); J.say(status(day));
}
function removeItem(it){
  const snap = JSON.stringify(S().days[day]);
  S().days[day].items = S().days[day].items.filter(x => x !== it);
  J.haptic(); save(); render();
  J.toast('Aliment retiré', {action:'ANNULER', onAction:() => { S().days[day] = JSON.parse(snap); save(); render(); }});
}

/* ============================================================
   Scanner de code-barres
   ============================================================ */
let stream = null, scanning = false, zxingReader = null, detLoop = null;
function loadZxing(){
  if (window.ZXing) return Promise.resolve();
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
}
async function openScanner(){
  J.closeSheet();
  const box = fq('#nScan'); box.hidden = false; fq('#sCode').value = ''; fq('#sTxt').textContent = 'Placez le code-barres dans le cadre';
  scanning = true;
  const video = fq('#sVideo');
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment', width:{ideal:1280}, height:{ideal:720}}, audio:false});
    video.srcObject = stream; await video.play();
  } catch(e) { fq('#sTxt').textContent = 'Caméra indisponible : autorisez-la dans Réglages, ou tapez le code ci-dessous.'; return; }
  if ('BarcodeDetector' in window) {
    const det = new BarcodeDetector({formats:['ean_13', 'ean_8', 'upc_a', 'upc_e']});
    detLoop = async () => {
      if (!scanning) return;
      try { const r = await det.detect(video); if (r.length) return found(r[0].rawValue); } catch(e) {}
      requestAnimationFrame(detLoop);
    };
    detLoop();
  } else {
    try {
      await loadZxing();
      const hints = new Map(); hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints, 300);
      zxingReader.decodeFromVideoElementContinuously(video, (res) => { if (res && scanning) found(res.getText()); });
    } catch(e) { fq('#sTxt').textContent = 'Lecteur indisponible : tapez le code ci-dessous.'; }
  }
}
function stopScanner(){
  scanning = false;
  if (zxingReader) { try { zxingReader.reset(); } catch(e) {} zxingReader = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  detLoop = null;
  if (fixed) fq('#nScan').hidden = true;
}
async function found(code){
  if (!scanning) return;
  scanning = false; J.haptic();
  fq('#sTxt').textContent = 'Code ' + code + ' · recherche…';
  try {
    const {item} = await J.api('GET', '/api/food/code/' + code);
    stopScanner();
    openQty(Object.assign(item, {src:'off'}));
  } catch(e) {
    fq('#sTxt').textContent = (e.status === 404 ? 'Produit inconnu d\'Open Food Facts' : 'Erreur réseau') + ' · réessayez ou créez l\'aliment';
    setTimeout(() => { if (stream) { scanning = true; fq('#sTxt').textContent = 'Placez le code-barres dans le cadre'; if (detLoop) detLoop(); } }, 2500);
  }
}

function openWhy(){
  const G = goalsFor(day), r = G.r, cal = G.cal;
  const row = (l, v, sub, cls = '') => `<div class="wrow ${cls}"><span>${l}${sub ? `<small>${sub}</small>` : ''}</span><b>${v}</b></div>`;
  fq('#nWhyB').innerHTML = `
    <h2>CALCUL DE L'OBJECTIF</h2>
    <p class="note">${esc(dayLabel(day))} · recalculé chaque jour à partir d'Apple Santé.</p>
    ${row('Métabolisme de base', fmt(r.base) + ' kcal', r.basal ? 'énergie au repos mesurée par Apple (moyenne 14 j)' : `formule Mifflin-St Jeor · ${g1(G.kg)} kg, ${S().profile.cm} cm, ${S().profile.age} ans`)}
    ${row('+ Activité', fmt(r.act) + ' kcal', (r.apple ? 'Apple Santé · ' : '') + r.src)}
    ${row('+ Digestion', fmt(r.tef) + ' kcal', 'environ 10 % de la dépense')}
    ${row('= Dépense estimée', fmt(r.tdee) + ' kcal', '', 'tot')}
    ${row('× Calibration', (cal.factor >= 1 ? '+' : '−') + Math.round(Math.abs(cal.factor - 1) * 100) + ' %', cal.ok ? `apports réels vs évolution du poids sur ${cal.days} jours` : 'en apprentissage (repas + pesées sur 10 jours minimum)')}
    ${row(G.delta < 0 ? '− Déficit visé' : G.delta > 0 ? '+ Surplus visé' : 'Rythme', (G.delta ? fmt(Math.abs(G.delta)) + ' kcal' : '0'), kgw(G.rate) + ' · ' + rateLabel(G.rate).toLowerCase())}
    ${row('= Objectif', fmt(G.kcal) + ' kcal', G.floored ? 'limité au plancher de sécurité' : '', 'goal')}
    <div class="wmac">
      <div style="--mc:${MAC.p.c}"><b>${G.p} g</b><small>PROTÉINES</small><i>${G.rate < 0 ? 2 : 1.8} g / kg</i></div>
      <div style="--mc:${MAC.f.c}"><b>${G.f} g</b><small>LIPIDES</small><i>27 % des kcal</i></div>
      <div style="--mc:${MAC.c.c}"><b>${G.c} g</b><small>GLUCIDES</small><i>le reste</i></div>
    </div>
    <p class="note">L'activité du jour = ce qu'Apple a déjà mesuré + ce qu'il vous reste habituellement à dépenser d'ici ce soir. À chaque synchronisation, l'objectif se met à jour : si vous bougez plus que d'habitude il augmente, si la journée est calme il baisse. En fin de journée, seule la mesure réelle compte. Avec vos repas et vos pesées, Jarvis corrige aussi le calcul sur la durée.</p>`;
  J.openSheet(fq('#nWhy'));
}
function openWeigh(){
  const lw = latestWeight();
  fq('#wKg').value = lw ? g1(lw.kg) : ''; fq('#wDate').value = today();
  const ks = Object.keys(S().weights).sort().reverse().slice(0, 6);
  fq('#wList').innerHTML = ks.length ? '<p class="note" style="margin-top:14px">Dernières pesées manuelles</p>' + ks.map(k => `<div class="wl"><span>${esc(dayLabel(k))}</span><b>${g1(S().weights[k])} kg</b><button data-wdel="${k}">✕</button></div>`).join('') : '';
  J.openSheet(fq('#nWeigh'));
  J.focusAfterOpen(fq('#wKg'));
}

/* ============================================================
   Calculateur de besoins
   ============================================================ */
function calc(){
  const sex = $('#cSex button.on', root).dataset.v, age = num(q('#cAge').value), kg = num(q('#cKg').value), cm = num(q('#cCm').value);
  const act = +q('#cAct').value, goal = q('#cGoal').value;
  if (!(age > 10 && kg > 30 && cm > 120)) { J.toast('Renseignez âge, poids et taille'); return; }
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'h' ? 5 : -161);
  const tdee = bmr * act;
  const kcal = Math.round(tdee * ({cut:.8, mild:.9, keep:1, bulk:1.1})[goal] / 10) * 10;
  const p = Math.round(kg * (goal === 'cut' || goal === 'mild' ? 2 : 1.8));
  const f = Math.round(kcal * .27 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  S().profile = {sex, age, kg, cm, act, goal}; save();
  q('#cOut').innerHTML = `<div class="cres">
    <p>Métabolisme de base <b>${fmt(bmr)} kcal</b> · dépense totale estimée <b>${fmt(tdee)} kcal</b></p>
    <div class="cgrid"><div><b>${fmt(kcal)}</b><small>KCAL</small></div><div style="--mc:${MAC.p.c}"><b>${p} g</b><small>PROT</small></div><div style="--mc:${MAC.c.c}"><b>${c} g</b><small>GLUC</small></div><div style="--mc:${MAC.f.c}"><b>${f} g</b><small>LIP</small></div></div>
    <button class="btn primary" data-apply="${kcal},${p},${c},${f}">APPLIQUER CES OBJECTIFS</button>
    <p class="note">Estimation indicative : ajustez selon l'évolution de votre poids sur 2 à 3 semaines.</p></div>`;
}

/* ============================================================
   Branchements
   ============================================================ */
function bind(){
  root.addEventListener('click', e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { J.haptic(); tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const dd = e.target.closest('[data-day]'); if (dd) { J.haptic(); day = addDays(day, +dd.dataset.day); if (day > today()) day = today(); render(); J.say(status(day)); return; }
    if (e.target.closest('#nReactor')) { const t = J.greeting() + ' ' + spoken(day); J.say(t); J.speak(t); return; }
    const ad = e.target.closest('[data-add]'); if (ad) { J.haptic(); openAdd(ad.dataset.add); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const src = items(addDays(day, -1)).filter(it => it.meal === cp.dataset.copy);
      const d = S().days[day] = S().days[day] || {items:[]};
      src.forEach(it => d.items.push(Object.assign({}, it, {id:uid()})));
      J.haptic(); save(); render(); J.toast(`${src.length} aliment${src.length > 1 ? 's' : ''} repris d'hier`); J.say(status(day)); return;
    }
    const rg = e.target.closest('[data-range]'); if (rg) { histRange = +rg.dataset.range; render(); return; }
    const gd = e.target.closest('[data-goday]'); if (gd) { day = gd.dataset.goday; tab = 'jour'; render(); window.scrollTo(0, 0); return; }
    const sx = e.target.closest('#cSex button'); if (sx) { $$('#cSex button', root).forEach(b => b.classList.toggle('on', b === sx)); return; }
    const ap = e.target.closest('[data-apply]');
    if (ap) { const [kcal, p, c, f] = ap.dataset.apply.split(',').map(Number); S().goals = {kcal, p, c, f}; save(); render(); J.toast('Objectifs mis à jour'); J.say(`Objectifs enregistrés : ${fmt(kcal)} kcal, ${p} grammes de protéines.`); return; }
    const md = e.target.closest('[data-mode]'); if (md) { S().mode = md.dataset.mode; save(); J.haptic(); render(); return; }
    const rt = e.target.closest('[data-rate]'); if (rt) { S().plan.rate = +rt.dataset.rate; save(); J.haptic(); render(); J.say(`Rythme : ${rateLabel(S().plan.rate).toLowerCase()}. Objectif du jour : ${fmt(goalK(today()))} kcal.`); return; }
    const ps = e.target.closest('#pSex button'); if (ps) { $$('#pSex button', root).forEach(b => b.classList.toggle('on', b === ps)); if (profileOk()) { S().profile.sex = ps.dataset.v; save(); render(); } return; }
    const a = e.target.closest('[data-a]');
    if (a && a.dataset.a === 'why') return openWhy();
    if (a && a.dataset.a === 'weigh') return openWeigh();
    if (a && a.dataset.a === 'guide') return J.openGuide();
    if (a && a.dataset.a === 'sync') { location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Jarvis'); return; }
    if (a && a.dataset.a === 'goadapt') { tab = 'obj'; S().mode = 'adaptive'; save(); render(); window.scrollTo(0, 0); return; }
    if (a && a.dataset.a === 'saveprofile') {
      const age = num(q('#pAge').value), cm = num(q('#pCm').value), kg = num(q('#pKg').value);
      if (!(age > 10 && cm > 120 && kg > 30)) { J.toast('Renseignez âge, taille et poids'); return; }
      S().profile = {sex:$('#pSex button.on', root).dataset.v, age, cm, kg, act:+q('#pAct').value};
      if (!latestWeight()) S().weights[today()] = kg;
      save(); render(); J.say(`Objectif adaptatif activé : ${fmt(goalK(today()))} kcal aujourd'hui.`); return;
    }
    if (a && a.dataset.a === 'calc') return calc();
    if (a && a.dataset.a === 'fitkcal') { const G = S().goals; G.kcal = G.p * 4 + G.c * 4 + G.f * 9; save(); render(); return; }
    const row = e.target.closest('.srow');
    if (row) { const it = items(day).find(x => x.id === row.dataset.id); if (it) openQty({name:it.name, brand:it.brand, per100:it.per100, src:it.src, code:it.code}, it); }
  });
  root.addEventListener('change', e => {
    const G = S().goals, map = {oKcal:'kcal', oP:'p', oC:'c', oF:'f'};
    if (map[e.target.id]) { const n = Math.round(num(e.target.value)); if (n >= 0) { G[map[e.target.id]] = n; save(); render(); } }
    if (e.target.id === 'oActive') { S().addActive = e.target.checked; save(); }
    /* profil modifié directement depuis l'onglet (mode adaptatif actif) */
    if (['pAge', 'pCm', 'pKg', 'pAct'].includes(e.target.id) && profileOk()) {
      const p = S().profile, v = num(e.target.value);
      if (e.target.id === 'pAge' && v > 10) p.age = v;
      if (e.target.id === 'pCm' && v > 120) p.cm = v;
      if (e.target.id === 'pAct') p.act = +e.target.value;
      if (e.target.id === 'pKg' && v > 30) { p.kg = v; S().weights[today()] = v; }
      save(); render();
    }
  });

  /* glisser un aliment vers la gauche = supprimer */
  J.swipeRows(root, {left: row => { const it = items(day).find(x => x.id === row.dataset.id); if (it) removeItem(it); }});

  /* feuille d'ajout */
  fq('#nAddBtn').addEventListener('click', () => { J.haptic(); openAdd(); });
  fq('#aMeal').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { addMeal = b.dataset.v; setSeg('#aMeal', addMeal); } });
  fq('#aQ').addEventListener('input', e => { const v = e.target.value.trim(); if (v !== offQuery) offResults = null; renderResults(); searchOff(v); });
  fq('#aRes').addEventListener('click', e => {
    const b = e.target.closest('.fres'); if (!b) return;
    const f = groups[b.dataset.g][+b.dataset.i];
    J.haptic(); openQty(f);
  });
  fq('#aScan').addEventListener('click', openScanner);
  fq('#aCustom').addEventListener('click', () => { ['fName', 'fK', 'fS', 'fP', 'fC', 'fF'].forEach(id => fq('#' + id).value = ''); fq('#fName').value = fq('#aQ').value.trim(); step('custom'); });
  fq('#cBack').addEventListener('click', () => step('search'));
  fq('#qBack').addEventListener('click', () => { step('search'); renderResults(); });
  fq('#qG').addEventListener('input', updatePrev);
  fq('#qChips').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) { fq('#qG').value = b.dataset.g; updatePrev(); J.haptic(); } });
  fq('#qMeal').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSeg('#qMeal', b.dataset.v); });
  fq('#qFav').addEventListener('click', () => {
    const f = pick.food, k = foodKey(f), on = S().favs.some(x => foodKey(x) === k);
    S().favs = on ? S().favs.filter(x => foodKey(x) !== k) : [{name:f.name, brand:f.brand || '', per100:f.per100, src:f.src, code:f.code || null, serving:f.serving || null, img:f.img || null}, ...S().favs];
    fq('#qFav').classList.toggle('on', !on); J.haptic(); save();
  });
  fq('#qSave').addEventListener('click', saveQty);
  fq('#qDel').addEventListener('click', () => { const it = pick.item; J.closeSheet(); removeItem(it); });
  fq('#fSave').addEventListener('click', () => {
    const name = fq('#fName').value.trim(), k = num(fq('#fK').value);
    if (!name || !(k >= 0)) { J.toast('Nom et calories requis'); return; }
    const f = {name, brand:'', src:'perso', per100:{kcal:Math.round(k), p:num(fq('#fP').value) || 0, c:num(fq('#fC').value) || 0, f:num(fq('#fF').value) || 0}, serving:num(fq('#fS').value) || null, id:uid()};
    S().foods.unshift(f); save();
    openQty(f);
  });

  /* pesée */
  fq('#wSave').addEventListener('click', () => {
    const kg = num(fq('#wKg').value), d = fq('#wDate').value || today();
    if (!(kg > 25 && kg < 300)) { J.toast('Poids invalide'); return; }
    S().weights[d] = Math.round(kg * 10) / 10;
    if (S().profile) S().profile.kg = S().weights[d];
    J.haptic(); save(); J.closeSheet(); render(); J.toast(`Pesée enregistrée : ${g1(kg)} kg`);
  });
  fq('#wList').addEventListener('click', e => { const b = e.target.closest('[data-wdel]'); if (!b) return; delete S().weights[b.dataset.wdel]; save(); openWeigh(); render(); });

  /* scanner */
  fq('#sClose').addEventListener('click', () => { stopScanner(); openAdd(addMeal); });
  fq('#sGo').addEventListener('click', () => { const c = fq('#sCode').value.replace(/\D/g, ''); if (c.length >= 8) { scanning = true; found(c); } else J.toast('Code-barres incomplet'); });
}

function spoken(k){
  const list = items(k), s = sums(list), G = goalsFor(k), goal = G.kcal;
  if (!list.length) return 'Aucun repas enregistré pour le moment.';
  const left = goal - s.kcal;
  return `Vous avez consommé ${fmt(s.kcal)} calories sur ${fmt(goal)}. ` + (left >= 0 ? `Il vous en reste ${fmt(left)}. ` : `Objectif dépassé de ${fmt(-left)}. `) +
    `Protéines : ${fmt(s.p)} grammes sur ${fmt(G.p)}.`;
}

/* ---------- déclaration du module ---------- */
J.module({
  id: 'nutrition',
  code: '03',
  order: 15,
  name: 'Nutrition',
  tagline: 'Calories, macros et repas',
  accent: '#4dffc3',
  cls: 'nut',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21c-4 0-7-3.5-7-8 0-3 2-5 4.5-5 1.2 0 1.8.5 2.5.5s1.3-.5 2.5-.5C17 8 19 10 19 13c0 4.5-3 8-7 8z"/><path d="M12 8c0-2 1-4 3-5"/></svg>',

  init(){
    st = J.store('nutrition', DEFAULTS);
    st.onChange(() => render());
    J.store('apple', {days:{}}).onChange(() => {   // nouvelles données Apple : l'objectif se recalcule
      calCache = null;
      if (root && !J.sheetOpen()) { render(); if (tab === 'jour' && S().mode === 'adaptive') J.say(`Données Apple reçues. Objectif du jour : ${fmt(goalK(day))} kcal.`); }
    });
  },
  summary(){
    const s = sums(items(today()));
    return items(today()).length ? `<b>${fmt(s.kcal)}</b> / ${fmt(goalK(today()))} kcal<br>Prot. ${fmt(s.p)} / ${goalsFor(today()).p} g` : 'Rien de saisi aujourd\'hui';
  },
  brief(){
    const list = items(today()); if (!list.length) return '';
    const left = goalK(today()) - sums(list).kcal;
    return left >= 0 ? `Il vous reste ${fmt(left)} kcal aujourd'hui.` : '';
  },
  report(){ return spoken(today()); },
  stat(){
    const k = today(), list = items(k), s = sums(list), goal = goalK(k), left = goal - s.kcal;
    if (!list.length) return {label:'CALORIES', value:fmt(goal) + '<small> kcal</small>', sub:'rien de saisi aujourd\'hui', ratio:0};
    return {label:'CALORIES', value:(left >= 0 ? fmt(left) : '+' + fmt(-left)) + `<small> ${left >= 0 ? 'restantes' : 'kcal'}</small>`, sub:`${fmt(s.kcal)} / ${fmt(goal)} · prot. ${fmt(s.p)} g`, ratio:s.kcal / goal};
  },
  briefingSpeech(){
    const list = items(today()); if (!list.length) return '';
    const s = sums(list), left = goalK(today()) - s.kcal;
    return `Côté nutrition, ${fmt(s.kcal)} calories consommées, ${left >= 0 ? 'il en reste ' + fmt(left) : 'objectif dépassé'}.`;
  },

  mount(body, fx){
    root = body; fixed = fx;
    root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED;
    day = today(); tab = 'jour';
    bind(); render();
    J.say(status(day));
    loadCiqual();
  },
  onShow(){ render(); J.say(status(day)); },
  unmount(){ stopScanner(); root = null; fixed = null; },
});
})();
