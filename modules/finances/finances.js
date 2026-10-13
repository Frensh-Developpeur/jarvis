/* ============================================================
   Module 01 — Finances
   Solde du compte et projection, opérations prévues / pointées,
   récurrences (mensuelles, trimestrielles, annuelles), budgets par
   catégorie, objectifs d'épargne, analyses et export.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, eur, uid, r2} = J;

/* ---------- catégories ---------- */
const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const DOTS = P('<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>');
const CAT = {
  out: {
    'Logement':    {c:'#3fe0ff', i:P('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>')},
    'Courses':     {c:'#4dffc3', i:P('<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>')},
    'Transport':   {c:'#ffb347', i:P('<path d="M5 16v-5l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/>')},
    'Abonnements': {c:'#b98cff', i:P('<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M10 9l5 2.5-5 2.5z"/>')},
    'Factures':    {c:'#ffe066', i:P('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>')},
    'Restaurants': {c:'#ff8a5c', i:P('<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2"/><path d="M17 22V2c-2 1-3 4-3 8h3"/>')},
    'Loisirs':     {c:'#ff5f8f', i:P('<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 12h4M9 10v4"/><path d="M16 11h.01M18 13h.01"/>')},
    'Shopping':    {c:'#5c9dff', i:P('<path d="M6 7h12l-1 14H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>')},
    'Santé':       {c:'#ff4d6d', i:P('<path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11z"/>')},
    'Épargne':     {c:'#4dffc3', i:P('<path d="M4 11a7 6 0 0 1 13-3h2v3l2 1v3h-2.5a7 6 0 0 1-2.5 2.5V20h-3v-2h-3v2H7v-3a6 6 0 0 1-3-6z"/><path d="M15 10.5h.01"/>')},
    'Crédit':      {c:'#ff9f43', i:P('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>')},
    'Autre':       {c:'#8aa7b8', i:DOTS},
  },
  in: {
    'Salaire':       {c:'#4dffc3', i:P('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>')},
    'Prime':         {c:'#ffe066', i:P('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>')},
    'Remboursement': {c:'#3fe0ff', i:P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')},
    'Aide / CAF':    {c:'#b98cff', i:P('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>')},
    'Vente':         {c:'#ffb347', i:P('<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.3"/>')},
    'Cadeau':        {c:'#ff5f8f', i:P('<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 4s0 4 4 4zM12 8s1.5-5 4-4 0 4-4 4z"/>')},
    'Autre':         {c:'#8aa7b8', i:DOTS},
  },
};
const catMeta = (type, c) => CAT[type][c] || CAT[type].Autre;
const catIcon = (type, c, cls = '') => { const m = catMeta(type, c); return `<span class="ci ${cls}" style="--cc:${m.c}">${m.i}</span>`; };
const EVERY = {1:'tous les mois', 3:'tous les 3 mois', 12:'tous les ans'};

/* ---------- dates ---------- */
const mk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
const ym = k => k.split('-').map(Number);
const shift = (k, n) => { const [y,m] = ym(k); return mk(new Date(y, m-1+n, 1)); };
const dim = k => { const [y,m] = ym(k); return new Date(y, m, 0).getDate(); };
const between = (a, b) => { const [y1,m1] = ym(a), [y2,m2] = ym(b); return (y2-y1) * 12 + (m2-m1); };
const mLabel = k => { const [y,m] = ym(k); return new Date(y, m-1, 1).toLocaleDateString('fr-FR', {month:'long', year:'numeric'}); };
const mShort = k => { const [y,m] = ym(k); return new Date(y, m-1, 1).toLocaleDateString('fr-FR', {month:'short'}).replace('.', ''); };
const dateOf = (k, d) => { const [y,m] = ym(k); return new Date(y, m-1, d); };
const iso = (k, d) => k + '-' + String(d).padStart(2, '0');
const thisMonth = () => mk(new Date());
const todayD = () => new Date().getDate();

/* ---------- état ---------- */
let st = null, root = null, fixed = null;
let cur = thisMonth(), tab = 'mois', filter = 'all', selDay = null, selCat = null, query = '', searchOpen = false;
const S = () => st.data;
const save = () => st.save();
const DEFAULTS = {tx:[], rec:[], budgets:{}, goals:[], anchor:null};

/* les opérations récurrentes créent une vraie opération la première fois qu'un mois est consulté */
function materialize(k){
  let changed = false;
  for (const r of S().rec) {
    if (r.from > k || (r.until && r.until < k) || r.skips.includes(k)) continue;
    if ((r.every || 1) > 1 && between(r.from, k) % r.every) continue;
    if (S().tx.some(t => t.recId === r.id && t.month === k)) continue;
    S().tx.push({id:uid(), month:k, type:r.type, label:r.label, amount:r.amount, day:Math.min(r.day, dim(k)), cat:r.cat, done:false, recId:r.id});
    changed = true;
  }
  if (changed) save();
}
function totals(k){
  materialize(k);
  const list = S().tx.filter(t => t.month === k);
  const sum = f => r2(list.filter(f).reduce((a,t) => a + t.amount, 0));
  return {
    list,
    inc: sum(t => t.type === 'in'), out: sum(t => t.type === 'out'),
    incD: sum(t => t.type === 'in' && t.done), outD: sum(t => t.type === 'out' && t.done),
    pending: list.filter(t => !t.done).length,
  };
}

/* ---------- solde du compte ----------
   anchor = solde au début d'un mois de référence. Les mois passés et futurs sont
   déduits en ajoutant (ou retirant) toutes leurs opérations. */
function balanceStart(k){
  const a = S().anchor; if (!a) return null;
  let b = a.amount, n = 0;
  if (k >= a.month) for (let m = a.month; m < k && n < 48; m = shift(m, 1), n++) { const T = totals(m); b += T.inc - T.out; }
  else for (let m = k; m < a.month && n < 48; m = shift(m, 1), n++) { const T = totals(m); b -= T.inc - T.out; }
  return r2(b);
}
function balanceNow(){
  const k = thisMonth(), s = balanceStart(k); if (s === null) return null;
  const T = totals(k); return r2(s + T.incD - T.outD);
}
function balanceEnd(k){
  const s = balanceStart(k); if (s === null) return null;
  const T = totals(k); return r2(s + T.inc - T.out);
}
function setBalance(amount){
  const k = thisMonth(), T = totals(k);
  S().anchor = {month:k, amount:r2(amount - (T.incD - T.outD))};
  save();
}

/* ---------- budgets ---------- */
const spentCat = (k, c) => r2(totals(k).list.filter(t => t.type === 'out' && t.cat === c).reduce((a, t) => a + t.amount, 0));
function budgetAlerts(k){
  const out = [];
  for (const [c, b] of Object.entries(S().budgets)) {
    if (!b) continue;
    const s = spentCat(k, c), r = s / b;
    if (r >= 1) out.push({lvl:'red', c, txt:`Budget ${c} dépassé de ${eur(r2(s - b))}`});
    else if (r >= .85) out.push({lvl:'gold', c, txt:`Budget ${c} à ${Math.round(r * 100)} %`});
  }
  return out;
}
const perDay = (k, T) => {
  if (k !== thisMonth()) return null;
  const daysLeft = dim(k) - todayD() + 1;
  const end = balanceEnd(k);
  const base = end !== null ? Math.min(end, T.inc - T.out) : T.inc - T.out;
  return {daysLeft, value:r2(Math.max(0, base) / daysLeft)};
};

/* ---------- messages de Jarvis ---------- */
function status(k){
  const T = totals(k);
  if (!T.list.length) return 'Aucune donnée pour ce mois. Ajoutez votre salaire et vos dépenses prévues pour commencer.';
  const left = r2(T.inc - T.out), end = balanceEnd(k), alerts = budgetAlerts(k);
  if (end !== null && end < 0) return `Alerte : découvert prévu de ${eur(-end)} en fin de mois. Je recommande des ajustements.`;
  if (alerts.some(a => a.lvl === 'red')) return alerts.find(a => a.lvl === 'red').txt + '. Un peu de retenue serait de mise.';
  if (T.inc === 0) return 'Je ne détecte aucun revenu ce mois-ci. ' + eur(T.out) + ' de dépenses enregistrées.';
  if (left < 0) return 'Les dépenses prévues dépassent les revenus de ' + eur(-left) + '.';
  const r = T.out / T.inc, pd = perDay(k, T);
  const tail = pd ? ` Soit environ ${eur(pd.value)} par jour jusqu'à la fin du mois.` : '';
  if (r > .9) return `Marge critique : il ne restera que ${eur(left)}.` + tail;
  if (r > .75) return `Situation sous contrôle, marge réduite : ${eur(left)} de reste.` + tail;
  return `Tous les systèmes sont nominaux. ${eur(left)} de marge ce mois-ci.` + tail;
}
function spoken(k){
  const T = totals(k), left = r2(T.inc - T.out), now = k === thisMonth() ? balanceNow() : null, end = balanceEnd(k);
  if (!T.list.length) return `Aucune opération enregistrée pour ${mLabel(k)}.`;
  return (now !== null ? `Votre solde actuel est de ${eur(now)}. ` : '') +
    `Pour ${mLabel(k)}, ${eur(T.inc)} de revenus et ${eur(T.out)} de dépenses. ` +
    (end !== null ? `Solde prévu en fin de mois : ${eur(end)}.` : left >= 0 ? `Il vous restera ${eur(left)}.` : `Déficit de ${eur(-left)}.`) +
    (T.pending ? ` ${T.pending} opération${T.pending > 1 ? 's' : ''} encore à venir.` : '');
}

/* ============================================================
   Interface
   ============================================================ */
const q = s => $(s, root);
const fq = s => $(s, fixed);

const TEMPLATE = `
  <div class="utabs" id="fTabs">
    <button data-tab="mois">MOIS</button><button data-tab="analyse">ANALYSE</button><button data-tab="budgets">BUDGETS</button><button data-tab="fixes">FIXES</button>
  </div>
  <div class="mnav" id="fMonthBar">
    <button data-m="-1" aria-label="Mois précédent">‹</button>
    <div class="lbl" id="fMonth"></div>
    <button data-m="1" aria-label="Mois suivant">›</button>
  </div>
  <div id="fTab"></div>`;
const ICON_SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

/* ---------- onglet MOIS ---------- */
function rowHTML(t){
  const late = !t.done && t.month === thisMonth() && t.day < todayD();
  return `<div class="srow" data-id="${t.id}">
    <div class="sbg"><span class="l">${t.done ? '↺ PRÉVU' : '✓ POINTER'}</span><button class="sact" type="button">Supprimer</button></div>
    <div class="row ${t.done ? '' : 'planned'}">
      ${catIcon(t.type, t.cat)}
      <div class="info"><div class="l">${esc(t.label)}${t.recId ? '<span class="rc">↻</span>' : ''}</div>
        <div class="m">${esc(t.cat)}${t.note ? ' · ' + esc(t.note) : ''}${late ? ' · <span class="lt">en retard</span>' : !t.done ? ' · <span class="pl">prévu</span>' : ''}</div></div>
      <div class="amt ${t.type}">${t.type === 'in' ? '+' : '−'}${eur(t.amount)}</div>
      <button class="ck ${t.done ? 'on' : ''}" data-a="toggle" aria-label="${t.done ? 'Marquer comme prévu' : 'Pointer'}"></button>
    </div></div>`;
}
function groupByDay(list){
  const groups = new Map();
  list.forEach(t => { const key = t.month + '|' + t.day; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(t); });
  return [...groups.entries()].map(([key, items]) => {
    const [k, d] = key.split('|'); const date = dateOf(k, +d);
    const isToday = k === thisMonth() && +d === todayD();
    const net = r2(items.reduce((a, t) => a + (t.type === 'in' ? t.amount : -t.amount), 0));
    const label = isToday ? "Aujourd'hui" : date.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric'}) + (k !== cur ? ' ' + mShort(k) : '');
    return `<div class="dgroup ${isToday ? 'today' : ''}"><div class="dh"><span>${label}</span><span class="${net >= 0 ? 'pos' : ''}">${net >= 0 ? '+' : '−'}${eur(Math.abs(net))}</span></div><div class="dcard">${items.map(rowHTML).join('')}</div></div>`;
  }).join('');
}
function renderMois(){
  const k = cur, T = totals(k), today = thisMonth();
  const left = r2(T.inc - T.out), now = k === today ? balanceNow() : null, start = balanceStart(k), end = balanceEnd(k);
  const ratio = T.inc > 0 ? T.out / T.inc : (T.out > 0 ? 1 : 0), pd = perDay(k, T);
  const hasBal = S().anchor !== null;
  const mainK = hasBal ? (k === today ? 'Solde actuel' : k < today ? 'Solde en fin de mois' : 'Solde prévu') : 'Reste prévu ce mois';
  const mainV = hasBal ? (k === today ? now : end) : left;
  const sub = [];
  if (hasBal && k === today) sub.push(`Fin de mois <b class="${end < 0 ? 'neg' : ''}">${eur(end)}</b>`);
  if (hasBal && k !== today) sub.push(`Début de mois <b>${eur(start)}</b>`);
  if (pd && T.list.length) sub.push(`≈ <b>${eur(pd.value)}</b> / jour`);
  const barCol = ratio >= 1 ? 'var(--red)' : ratio > .85 ? 'var(--gold)' : 'var(--cyan)';

  // une seule alerte : la plus importante
  let alert = '';
  const late = k === today ? T.list.filter(t => !t.done && t.day < todayD()) : [];
  const bAl = budgetAlerts(k);
  if (end !== null && end < 0) alert = `<div class="alert red"><span>Découvert prévu en fin de mois : ${eur(-end)}</span></div>`;
  else if (late.length) alert = `<div class="alert gold"><span>${late.length} opération${late.length > 1 ? 's' : ''} à pointer</span><button data-a="pointall">TOUT POINTER</button></div>`;
  else if (bAl.length) alert = `<div class="alert ${bAl[0].lvl}"><span>${esc(bAl[0].txt)}</span></div>`;

  let list = query ? S().tx.filter(t => (t.label + ' ' + t.cat + ' ' + (t.note || '')).toLowerCase().includes(query.toLowerCase())) : T.list;
  if (!query) {
    if (filter !== 'all') list = list.filter(t => filter === 'done' ? t.done : !t.done);
    if (selCat) list = list.filter(t => t.cat === selCat);
  }
  list = [...list].sort((a, b) => query ? (b.month.localeCompare(a.month) || b.day - a.day) : (a.day - b.day || (a.type === 'in' ? -1 : 1) || b.amount - a.amount));

  q('#fTab').innerHTML = `
    <div class="hero">
      <div class="htop"><span>${mainK}</span><button class="hspk" data-a="speak" aria-label="Rapport vocal">${ICON_SPK}</button></div>
      <div class="hv ${mainV < 0 ? 'neg' : ''}" ${k === today ? 'data-a="balance"' : ''}>${eur(mainV)}</div>
      ${sub.length ? `<div class="hs">${sub.join('<i>·</i>')}</div>` : ''}
      ${!hasBal && k === today ? '<button class="hset" data-a="balance">Suivre le solde de mon compte ›</button>' : ''}
      ${T.inc || T.out ? `<div class="hbar"><i style="width:${Math.min(100, ratio * 100)}%;background:${barCol}"></i></div>
      <div class="hbl"><span>${T.inc ? Math.round(ratio * 100) + ' % des revenus dépensés' : 'Aucun revenu ce mois'}</span><span>${T.pending ? T.pending + ' à venir' : ''}</span></div>` : ''}
    </div>
    <div class="duo">
      <div><small>REVENUS</small><b class="pos">+${eur(T.inc)}</b><span>reçu ${eur(T.incD)}</span></div>
      <div><small>DÉPENSES</small><b>−${eur(T.out)}</b><span>payé ${eur(T.outD)}</span></div>
    </div>
    ${alert}
    <div class="lhead">
      <div class="seg sm" id="fFilt"><button data-f="all" class="${filter === 'all' ? 'on' : ''}">TOUT</button><button data-f="plan" class="${filter === 'plan' ? 'on' : ''}">PRÉVU</button><button data-f="done" class="${filter === 'done' ? 'on' : ''}">POINTÉ</button></div>
      <button class="icon-btn sm ${searchOpen ? 'on' : ''}" data-a="search" aria-label="Rechercher"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></button>
    </div>
    <div class="searchbar" ${searchOpen ? '' : 'hidden'}><input id="fSearch" placeholder="Rechercher dans tous les mois…" value="${esc(query)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></div>
    ${selCat ? `<button class="clear" data-a="clearsel">${esc(selCat)} ✕</button>` : ''}
    <div class="tlist">
      ${list.length ? groupByDay(list) : `<div class="empty">${query ? 'Aucun résultat.' : T.list.length ? 'Rien pour ce filtre.' : 'Aucune opération ce mois-ci.<br>Touchez <b>+</b> pour ajouter votre salaire et vos dépenses prévues.'}</div>`}
    </div>`;
  if (!ls_tip() && T.list.length) { J.toast('Astuce : glissez une opération ← pour la supprimer, → pour la pointer'); ls_tip(true); }
}
function ls_tip(set){ try { if (set) localStorage.setItem('jarvis.tip.swipe', '1'); return !!localStorage.getItem('jarvis.tip.swipe'); } catch(e) { return true; } }

/* ---------- onglet ANALYSE ---------- */
function donut(parts, total){
  const r = 46, C = 2 * Math.PI * r; let off = 0;
  const segs = parts.map(p => { const len = p.v / total * C; const s = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${p.c}" stroke-width="13" stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; });
  return `<svg viewBox="0 0 120 120" class="donut"><circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(63,224,255,.08)" stroke-width="13"/>${segs.join('')}</svg>`;
}
function renderAnalyse(){
  const k = cur, T = totals(k);
  const byCat = {};
  T.list.filter(t => t.type === 'out').forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const parts = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({c:catMeta('out', c).c, v, name:c}));

  // 6 mois
  const months = []; for (let i = 5; i >= 0; i--) months.push(shift(k, -i));
  const series = months.map(m => { const t = totals(m); return {m, inc:t.inc, out:t.out}; });
  const max6 = Math.max(1, ...series.map(s => Math.max(s.inc, s.out)));
  const W = 320, H = 150, bw = 16, gap = W / 6;
  const bars6 = series.map((s, i) => {
    const x = i * gap + gap / 2, hi = s.inc / max6 * (H - 34), ho = s.out / max6 * (H - 34), net = r2(s.inc - s.out);
    return `<rect x="${x - bw - 1}" y="${H - 20 - hi}" width="${bw}" height="${hi}" rx="3" fill="url(#gIn)"/>
      <rect x="${x + 1}" y="${H - 20 - ho}" width="${bw}" height="${ho}" rx="3" fill="url(#gOut)"/>
      <text x="${x}" y="${H - 6}" text-anchor="middle" class="ax ${s.m === k ? 'cur' : ''}">${mShort(s.m).toUpperCase()}</text>
      ${s.inc || s.out ? `<text x="${x}" y="${Math.max(10, H - 26 - Math.max(hi, ho))}" text-anchor="middle" class="nv ${net < 0 ? 'neg' : ''}">${net >= 0 ? '+' : '−'}${Math.abs(net) >= 1000 ? (Math.abs(net) / 1000).toFixed(1).replace('.', ',') + 'k' : Math.round(Math.abs(net))}</text>` : ''}`;
  }).join('');

  // dépenses cumulées par jour : ce mois vs mois précédent
  const cum = m => { const t = totals(m), out = []; let acc = 0; for (let d = 1; d <= dim(m); d++) { acc += t.list.filter(x => x.type === 'out' && x.day === d).reduce((a, x) => a + x.amount, 0); out.push(acc); } return out; };
  const c1 = cum(k), c0 = cum(shift(k, -1)), cmax = Math.max(1, ...c1, ...c0), CH = 120;
  const pts = arr => arr.map((v, i) => `${(i / 30) * W},${CH - 10 - v / cmax * (CH - 24)}`).join(' ');
  const nowX = k === thisMonth() ? ((todayD() - 1) / 30) * W : null;

  const days = k === thisMonth() ? todayD() : dim(k);
  const outDone = T.list.filter(t => t.type === 'out' && (t.done || k < thisMonth())).reduce((a, t) => a + t.amount, 0);
  const biggest = T.list.filter(t => t.type === 'out').sort((a, b) => b.amount - a.amount)[0];
  const rate = T.inc > 0 ? Math.round((T.inc - T.out) / T.inc * 100) : null;
  let compare = '';
  if (c0[c0.length - 1]) {
    const d = Math.min(c1.length, k === thisMonth() ? todayD() : c1.length) - 1;
    const diff = r2(c1[d] - (c0[Math.min(d, c0.length - 1)] || 0));
    compare = diff > 0 ? `À date, vous avez dépensé <b>${eur(diff)}</b> de plus que le mois dernier.` : `À date, vous avez dépensé <b>${eur(-diff)}</b> de moins que le mois dernier.`;
  }

  q('#fTab').innerHTML = !T.list.length ? '<section class="panel"><div class="empty">Pas encore de données pour ce mois.</div></section>' : `
    <div class="kpis">
      <div class="kpi"><div class="k">TAUX D'ÉPARGNE</div><div class="v ${rate !== null && rate < 0 ? 'neg' : ''}">${rate !== null ? rate + ' %' : '—'}</div></div>
      <div class="kpi"><div class="k">DÉPENSE / JOUR</div><div class="v">${eur(r2(outDone / days))}</div></div>
      <div class="kpi"><div class="k">OPÉRATIONS</div><div class="v">${T.list.length}</div></div>
    </div>
    <section class="panel"><div class="ph"><span>RÉPARTITION DES DÉPENSES</span><span>${eur(T.out)}</span></div>
      ${parts.length ? `<div class="donutwrap">${donut(parts, T.out)}<div class="dc"><b>${eur(T.out)}</b><small>DÉPENSES</small></div></div>
      <div class="legend">${parts.map(p => { const b = S().budgets[p.name];
        return `<div class="lg" data-cat="${esc(p.name)}">${catIcon('out', p.name, 'sm')}<span class="n">${esc(p.name)}</span><span class="p">${Math.round(p.v / T.out * 100)} %</span><span class="a">${eur(r2(p.v))}</span>
          ${b ? `<div class="lbar"><i style="width:${Math.min(100, p.v / b * 100)}%;background:${p.v > b ? 'var(--red)' : p.c}"></i></div><div class="lb">${p.v > b ? 'dépassé de ' + eur(r2(p.v - b)) : 'budget ' + eur(b)}</div>` : ''}</div>`; }).join('')}</div>`
      : '<div class="empty">Aucune dépense.</div>'}
    </section>
    <section class="panel"><div class="ph"><span>6 DERNIERS MOIS</span><span><i class="lgd in"></i>revenus <i class="lgd out"></i>dépenses</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="chart"><defs>
        <linearGradient id="gIn" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1fae86"/><stop offset="1" stop-color="#4dffc3"/></linearGradient>
        <linearGradient id="gOut" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b8322a"/><stop offset="1" stop-color="#ff4d3d"/></linearGradient></defs>${bars6}</svg>
    </section>
    <section class="panel"><div class="ph"><span>DÉPENSES CUMULÉES</span><span><i class="lgd cur"></i>${mShort(k)} <i class="lgd prev"></i>${mShort(shift(k, -1))}</span></div>
      <svg viewBox="0 0 ${W} ${CH}" class="chart">
        <polyline points="${pts(c0)}" fill="none" stroke="rgba(108,151,171,.7)" stroke-width="1.5" stroke-dasharray="4 4"/>
        <polyline points="${pts(c1)}" fill="none" stroke="#3fe0ff" stroke-width="2.2" style="filter:drop-shadow(0 0 4px #3fe0ff)"/>
        ${nowX !== null ? `<line x1="${nowX}" x2="${nowX}" y1="8" y2="${CH - 8}" stroke="rgba(255,179,71,.6)" stroke-dasharray="2 3"/>` : ''}
        <text x="2" y="${CH - 1}" class="ax">1</text><text x="${W - 2}" y="${CH - 1}" text-anchor="end" class="ax">${dim(k)}</text>
      </svg>
      <p class="note pad">${compare}${biggest ? ` Plus grosse dépense : <b>${esc(biggest.label)}</b> (${eur(biggest.amount)}).` : ''}</p>
    </section>
    <button class="btn ghost" data-a="csv">EXPORTER LE MOIS (CSV)</button>`;
}

/* ---------- onglet BUDGETS ---------- */
function ring(ratio, color, size = 64){
  const r = 26, C = 2 * Math.PI * r, v = Math.max(0, Math.min(ratio, 1));
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}"><circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(63,224,255,.1)" stroke-width="6"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${v * C} ${C}" transform="rotate(-90 32 32)" style="filter:drop-shadow(0 0 3px ${color})"/>
    <text x="32" y="36" text-anchor="middle" class="rt">${Math.round(ratio * 100)}%</text></svg>`;
}
function renderBudgets(){
  const k = cur, B = S().budgets;
  const cats = Object.keys(CAT.out);
  const totB = Object.values(B).reduce((a, b) => a + (b || 0), 0);
  const totS = Object.keys(B).filter(c => B[c]).reduce((a, c) => a + spentCat(k, c), 0);
  const goals = S().goals;
  q('#fTab').innerHTML = `
    <section class="panel"><div class="ph"><span>BUDGETS DU MOIS</span><span>${totB ? eur(r2(totS)) + ' / ' + eur(totB) : 'touchez pour définir'}</span></div>
      ${totB ? `<div class="btot"><div class="bar"><i style="width:${Math.min(100, totS / totB * 100)}%;${totS > totB ? 'background:var(--red)' : ''}"></i></div></div>` : ''}
      <div class="blines">${cats.map(c => {
        const b = B[c] || 0, s = spentCat(k, c), m = catMeta('out', c), r = b ? s / b : 0;
        const col = !b ? 'var(--muted)' : r >= 1 ? 'var(--red)' : r >= .85 ? 'var(--gold)' : m.c;
        return `<button class="bl" data-budget="${esc(c)}">${catIcon('out', c, 'sm')}<span class="n">${esc(c)}</span>
          <span class="a">${s ? eur(s) : '—'}<small>${b ? ' / ' + eur(b) : ' · sans budget'}</small></span>
          ${b ? `<div class="lbar"><i style="width:${Math.min(100, r * 100)}%;background:${col}"></i></div>` : ''}</button>`; }).join('')}</div>
    </section>
    <section class="panel"><div class="ph"><span>OBJECTIFS D'ÉPARGNE</span><span>${goals.length ? eur(r2(goals.reduce((a, g) => a + g.saved, 0))) + ' épargnés' : ''}</span></div>
      <div class="goals">${goals.map(g => {
        const r = g.target ? g.saved / g.target : 0;
        let need = '';
        if (g.deadline && g.saved < g.target) { const n = Math.max(1, between(thisMonth(), g.deadline.slice(0, 7)) + 1); need = `${eur(r2((g.target - g.saved) / n))} / mois pendant ${n} mois`; }
        return `<div class="goal">${ring(r, r >= 1 ? '#4dffc3' : g.color || '#3fe0ff')}
          <div class="gi"><b>${esc(g.name)}</b><span>${eur(g.saved)} / ${eur(g.target)}</span><small>${r >= 1 ? 'Objectif atteint ✓' : need || 'Reste ' + eur(r2(g.target - g.saved))}</small></div>
          <div class="ga"><button class="mini" data-goaladd="${g.id}">+ €</button><button class="mini ghost" data-goaledit="${g.id}">⋯</button></div></div>`; }).join('') ||
        '<div class="empty">Aucun objectif. Vacances, voiture, fonds d\'urgence…</div>'}</div>
      <button class="btn ghost sm" data-a="newgoal">+ NOUVEL OBJECTIF</button>
    </section>`;
}

/* ---------- onglet FIXES (récurrences) ---------- */
function nextOcc(r){
  let k = thisMonth();
  for (let i = 0; i < 24; i++, k = shift(k, 1)) {
    if (r.from > k || (r.until && r.until < k) || r.skips.includes(k)) continue;
    if ((r.every || 1) > 1 && between(r.from, k) % r.every) continue;
    const day = Math.min(r.day, dim(k));
    const t = S().tx.find(x => x.recId === r.id && x.month === k);
    if (k === thisMonth() && (day < todayD() || (t && t.done))) continue;
    return dateOf(k, day);
  }
  return null;
}
function renderFixes(){
  const active = S().rec.filter(r => !r.until || r.until >= thisMonth());
  const monthly = r => r.amount / (r.every || 1);
  const inc = r2(active.filter(r => r.type === 'in').reduce((a, r) => a + monthly(r), 0));
  const out = r2(active.filter(r => r.type === 'out').reduce((a, r) => a + monthly(r), 0));
  const subs = r2(active.filter(r => r.type === 'out' && r.cat === 'Abonnements').reduce((a, r) => a + monthly(r), 0));
  const line = r => { const n = nextOcc(r);
    return `<button class="fx" data-rec="${r.id}">${catIcon(r.type, r.cat, 'sm')}<span class="n">${esc(r.label)}<small>le ${r.day} · ${EVERY[r.every || 1]}${n ? ' · prochain ' + n.toLocaleDateString('fr-FR', {day:'numeric', month:'short'}) : ''}</small></span>
      <span class="a ${r.type}">${r.type === 'in' ? '+' : '−'}${eur(r.amount)}</span></button>`; };
  const ins = active.filter(r => r.type === 'in').sort((a, b) => a.day - b.day), outs = active.filter(r => r.type === 'out').sort((a, b) => b.amount / (b.every || 1) - a.amount / (a.every || 1));
  q('#fTab').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">REVENUS FIXES</div><div class="v pos">${eur(inc)}</div></div>
      <div class="kpi"><div class="k">CHARGES FIXES</div><div class="v negc">${eur(out)}</div></div>
      <div class="kpi"><div class="k">RESTE / MOIS</div><div class="v ${inc - out < 0 ? 'neg' : ''}">${eur(r2(inc - out))}</div></div>
    </div>
    ${subs ? `<p class="note center">Abonnements : <b>${eur(subs)}</b> par mois, soit <b>${eur(r2(subs * 12))}</b> par an.</p>` : ''}
    <section class="panel"><div class="ph"><span>REVENUS RÉCURRENTS</span><span>${ins.length}</span></div>${ins.map(line).join('') || '<div class="empty">Aucun. Ajoutez votre salaire avec « Récurrent ».</div>'}</section>
    <section class="panel"><div class="ph"><span>CHARGES RÉCURRENTES</span><span>${outs.length}</span></div>${outs.map(line).join('') || '<div class="empty">Aucune. Loyer, abonnements, assurances…</div>'}</section>
    <p class="hint">Montants trimestriels et annuels ramenés au mois dans les totaux.</p>`;
}

function render(){
  if (!root) return;
  $$('#fTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const today = thisMonth();
  q('#fMonthBar').hidden = tab === 'fixes';
  q('#fMonth').innerHTML = esc(mLabel(cur)) + '<small>' + (cur === today ? 'MOIS EN COURS' : cur < today ? 'ARCHIVE' : 'PRÉVISION') + '</small>';
  ({mois:renderMois, analyse:renderAnalyse, budgets:renderBudgets, fixes:renderFixes})[tab]();
}
const goMonth = n => { J.haptic(); cur = shift(cur, n); selDay = null; selCat = null; render(); J.say(status(cur)); };

/* ============================================================
   Actions
   ============================================================ */
const findTx = id => S().tx.find(x => x.id === id);
function snapshot(){ return JSON.stringify({tx:S().tx, rec:S().rec, goals:S().goals}); }
function restore(snap){ const d = JSON.parse(snap); S().tx = d.tx; S().rec = d.rec; S().goals = d.goals; save(); render(); }
function toggleDone(t){ t.done = !t.done; J.haptic(); save(); render(); }
function removeTx(t, mode = 'single'){
  const snap = snapshot(), D = S();
  if ((mode === 'one' || mode === 'single') && t.recId) { const r = D.rec.find(x => x.id === t.recId); if (r && !r.skips.includes(t.month)) r.skips.push(t.month); }
  if (mode === 'all') { const r = D.rec.find(x => x.id === t.recId); if (r) r.until = shift(t.month, -1); D.tx = D.tx.filter(x => !(x.recId === t.recId && x.month > t.month && !x.done)); }
  D.tx = D.tx.filter(x => x !== t);
  J.haptic(); save(); render();
  J.toast(mode === 'all' ? 'Récurrence arrêtée' : 'Opération supprimée', {action:'ANNULER', onAction:() => restore(snap)});
}

/* calcul dans le champ montant : « 12,5+8 » → 20,50 */
function parseAmount(v){
  const s = String(v).replace(/\s/g, '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!s || !/^[\d.+\-*/()]+$/.test(s)) return NaN;
  try { const n = Function('"use strict";return (' + s + ')')(); return isFinite(n) ? r2(n) : NaN; } catch(e) { return NaN; }
}

/* ---------- feuilles ---------- */
const FIXED = `
  <button class="fab" id="fAdd" aria-label="Ajouter une opération">+</button>

  <div class="sheet fin" id="fEdit" role="dialog" aria-label="Opération">
    <div class="grab"></div>
    <h2 id="eTitle">NOUVELLE OPÉRATION</h2>
    <div class="seg" id="eType"><button data-v="out">DÉPENSE</button><button data-v="in">REVENU</button></div>
    <div class="field amtfield"><input id="eAmt" class="big" inputmode="decimal" placeholder="0,00" autocomplete="off"><span class="cur">€</span><div class="calc" id="eCalc"></div></div>
    <div class="field"><label>LIBELLÉ</label><input id="eLbl" placeholder="Ex : Loyer, Salaire…" autocomplete="off" maxlength="60"></div>
    <div class="sugg hscroll" id="eSugg"></div>
    <div class="field"><label>CATÉGORIE</label><div class="catgrid" id="eCats"></div></div>
    <div class="two">
      <div class="field"><label>DATE</label><input id="eDate" type="date"></div>
      <div class="field"><label>NOTE</label><input id="eNote" placeholder="Facultatif" maxlength="80" autocomplete="off"></div>
    </div>
    <div class="toggle"><span>Déjà pointé<small>Passé sur le compte</small></span><label class="sw"><input type="checkbox" id="eDone"><i></i></label></div>
    <div class="toggle"><span>Récurrent<small>Revient automatiquement</small></span><label class="sw"><input type="checkbox" id="eRec"><i></i></label></div>
    <div class="seg every" id="eEvery"><button data-v="1">MENSUEL</button><button data-v="3">TRIMESTRIEL</button><button data-v="12">ANNUEL</button></div>
    <div class="toggle" id="eFutureRow"><span>Appliquer aux prochaines échéances<small>Sinon, seulement celle-ci</small></span><label class="sw"><input type="checkbox" id="eFuture"><i></i></label></div>
    <div class="field" id="eGoalRow"><label>OBJECTIF D'ÉPARGNE</label><select id="eGoal"></select></div>
    <button class="btn primary" id="eSave">ENREGISTRER</button>
    <div class="two" id="eMore"><button class="btn ghost" id="eDup">DUPLIQUER</button><button class="btn danger" id="eDel">SUPPRIMER</button></div>
    <div id="eDelAsk">
      <p class="note">C'est une opération récurrente. Que dois-je supprimer ?</p>
      <button class="btn danger" id="eDelOne">CETTE ÉCHÉANCE SEULEMENT</button>
      <button class="btn danger" id="eDelAll">CELLE-CI ET LES SUIVANTES</button>
      <button class="btn ghost" id="eDelCancel">ANNULER</button>
    </div>
  </div>

  <div class="sheet fin" id="fBal" role="dialog" aria-label="Solde">
    <div class="grab"></div>
    <h2>SOLDE DU COMPTE</h2>
    <p class="note">Indiquez le solde affiché par votre banque <b>aujourd'hui</b>. Je calculerai le solde réel au fil des opérations pointées et la projection de fin de mois.</p>
    <div class="field amtfield"><input id="bAmt" class="big" inputmode="decimal" placeholder="0,00" autocomplete="off"><span class="cur">€</span></div>
    <button class="btn primary" id="bSave">ENREGISTRER</button>
    <button class="btn ghost" id="bClear">NE PLUS SUIVRE LE SOLDE</button>
  </div>

  <div class="sheet fin" id="fBud" role="dialog" aria-label="Budget">
    <div class="grab"></div>
    <h2 id="budTitle">BUDGET</h2>
    <p class="note" id="budNote"></p>
    <div class="field amtfield"><input id="budAmt" class="big" inputmode="decimal" placeholder="0" autocomplete="off"><span class="cur">€</span></div>
    <button class="btn primary" id="budSave">ENREGISTRER</button>
    <button class="btn ghost" id="budClear">SUPPRIMER LE BUDGET</button>
  </div>

  <div class="sheet fin" id="fGoal" role="dialog" aria-label="Objectif">
    <div class="grab"></div>
    <h2 id="gTitle">OBJECTIF D'ÉPARGNE</h2>
    <div class="field"><label>NOM</label><input id="gName" placeholder="Ex : Vacances au Japon" maxlength="40" autocomplete="off"></div>
    <div class="two">
      <div class="field"><label>MONTANT VISÉ (€)</label><input id="gTarget" inputmode="decimal" autocomplete="off"></div>
      <div class="field"><label>DÉJÀ ÉPARGNÉ (€)</label><input id="gSaved" inputmode="decimal" autocomplete="off"></div>
    </div>
    <div class="field"><label>ÉCHÉANCE (FACULTATIF)</label><input id="gDeadline" type="month"></div>
    <div class="field"><label>COULEUR</label><div class="colors" id="gColors"></div></div>
    <button class="btn primary" id="gSave">ENREGISTRER</button>
    <button class="btn danger" id="gDel">SUPPRIMER L'OBJECTIF</button>
  </div>

  <div class="sheet fin" id="fContrib" role="dialog" aria-label="Versement">
    <div class="grab"></div>
    <h2 id="cTitle">VERSEMENT</h2>
    <div class="field amtfield"><input id="cAmt" class="big" inputmode="decimal" placeholder="0,00" autocomplete="off"><span class="cur">€</span></div>
    <div class="toggle"><span>Enregistrer dans le budget<small>Ajoute une opération « Épargne » pointée ce mois-ci</small></span><label class="sw"><input type="checkbox" id="cAsTx" checked><i></i></label></div>
    <button class="btn primary" id="cSave">VERSER</button>
    <button class="btn ghost" id="cWithdraw">RETIRER CE MONTANT</button>
  </div>`;

/* ---------- éditeur d'opération ---------- */
let editing = null, eType = 'out', eCat = null, eEvery = 1;
function setType(v){
  eType = v;
  $$('#eType button', fixed).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (!CAT[v][eCat]) eCat = v === 'in' ? 'Salaire' : 'Courses';
  renderCats(); renderSugg(); goalRow();
}
function renderCats(){
  fq('#eCats').innerHTML = Object.entries(CAT[eType]).map(([c, m]) =>
    `<button class="cat ${c === eCat ? 'on' : ''}" data-c="${esc(c)}" style="--cc:${m.c}">${m.i}<span>${esc(c)}</span></button>`).join('');
}
function setEvery(v){ eEvery = +v; $$('#eEvery button', fixed).forEach(b => b.classList.toggle('on', +b.dataset.v === eEvery)); }
/* suggestions : libellés déjà utilisés, les plus fréquents d'abord */
function renderSugg(){
  const typed = fq('#eLbl').value.trim().toLowerCase();
  const map = new Map();
  S().tx.filter(t => t.type === eType).forEach(t => {
    const key = t.label.toLowerCase(); const e = map.get(key) || {label:t.label, cat:t.cat, n:0}; e.n++; e.cat = t.cat; map.set(key, e);
  });
  const list = [...map.values()].filter(e => !typed || (e.label.toLowerCase().includes(typed) && e.label.toLowerCase() !== typed)).sort((a, b) => b.n - a.n).slice(0, 8);
  fq('#eSugg').innerHTML = list.map(e => `<button data-s="${esc(e.label)}" style="--cc:${catMeta(eType, e.cat).c}">${catMeta(eType, e.cat).i}${esc(e.label)}</button>`).join('');
  fq('#eSugg').hidden = !list.length || !!editing;
}
function goalRow(){
  const show = eType === 'out' && eCat === 'Épargne' && S().goals.length > 0 && !editing;
  fq('#eGoalRow').hidden = !show;
  if (show && !fq('#eGoal').options.length) fq('#eGoal').innerHTML = '<option value="">— aucun —</option>' + S().goals.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
}
function updateCalc(){
  const v = fq('#eAmt').value, n = parseAmount(v);
  fq('#eCalc').textContent = /[+\-*/x×÷]/.test(v.replace(/^[-−]/, '')) && !isNaN(n) ? '= ' + eur(n) : '';
}
function recRowsVisibility(){
  const on = fq('#eRec').checked;
  fq('#eEvery').hidden = !on;
  fq('#eFutureRow').hidden = !(editing && editing.recId && on);
}
function openEditor(t, preset){
  editing = t || null;
  fq('#eTitle').textContent = t ? 'MODIFIER L\'OPÉRATION' : 'NOUVELLE OPÉRATION';
  const r = t && t.recId ? S().rec.find(x => x.id === t.recId) : null;
  eCat = t ? t.cat : (preset && preset.cat) || null;
  fq('#eGoal').innerHTML = '';
  setType(t ? t.type : (preset && preset.type) || 'out');
  fq('#eAmt').value = t ? String(t.amount).replace('.', ',') : '';
  fq('#eLbl').value = t ? t.label : '';
  fq('#eNote').value = t ? t.note || '' : '';
  const day = t ? t.day : (cur === thisMonth() ? todayD() : 1);
  fq('#eDate').value = iso(t ? t.month : cur, day);
  fq('#eDone').checked = t ? t.done : cur === thisMonth();
  fq('#eRec').checked = !!r;
  setEvery(r ? r.every || 1 : 1);
  fq('#eFuture').checked = false;
  recRowsVisibility();
  fq('#eMore').hidden = !t; fq('#eDelAsk').hidden = true; fq('#eSave').hidden = false;
  updateCalc(); renderSugg(); goalRow();
  J.openSheet(fq('#fEdit'));
  if (!t) J.focusAfterOpen(fq('#eAmt'));
}
/* modification d'une récurrence depuis l'onglet FIXES : on édite sa prochaine échéance */
function openRec(r){
  let k = thisMonth();
  for (let i = 0; i < 24; i++, k = shift(k, 1)) {
    totals(k);
    const t = S().tx.find(x => x.recId === r.id && x.month === k && !x.done);
    if (t) { openEditor(t); fq('#eFuture').checked = true; return; }
  }
  J.toast('Aucune échéance à venir');
}
function saveEditor(){
  const amount = parseAmount(fq('#eAmt').value);
  if (!(amount > 0)) { J.toast('Montant invalide'); fq('#eAmt').focus(); return; }
  const dv = fq('#eDate').value || iso(cur, 1);
  const month = dv.slice(0, 7), day = +dv.slice(8, 10);
  const label = fq('#eLbl').value.trim() || eCat;
  const note = fq('#eNote').value.trim();
  const data = {type:eType, label, amount, day, cat:eCat};
  const done = fq('#eDone').checked, wantRec = fq('#eRec').checked;
  const D = S();
  if (!editing) {
    const t = Object.assign({id:uid(), month, done}, data, note ? {note} : {});
    if (wantRec) { const r = Object.assign({id:uid(), from:month, skips:[], every:eEvery}, data); D.rec.push(r); t.recId = r.id; }
    D.tx.push(t);
    const gid = fq('#eGoalRow').hidden ? '' : fq('#eGoal').value;
    if (gid) { const g = D.goals.find(x => x.id === gid); if (g) g.saved = r2(g.saved + amount); }
    J.toast(eType === 'in' ? 'Revenu enregistré' : 'Dépense enregistrée');
  } else {
    const t = editing, oldMonth = t.month;
    Object.assign(t, data, {done, month});
    if (note) t.note = note; else delete t.note;
    const r = t.recId && D.rec.find(x => x.id === t.recId);
    if (r && !wantRec) {
      r.until = shift(oldMonth, -1);
      D.tx = D.tx.filter(x => !(x.recId === r.id && x.month > oldMonth && !x.done));
      delete t.recId;
    } else if (r && fq('#eFuture').checked) {
      Object.assign(r, {type:data.type, label:data.label, amount:data.amount, day:data.day, cat:data.cat, every:eEvery});
      D.tx.filter(x => x.recId === r.id && x.month > oldMonth && !x.done).forEach(x => Object.assign(x, {type:data.type, label:data.label, amount:data.amount, cat:data.cat, day:Math.min(data.day, dim(x.month))}));
    } else if (!r && wantRec) {
      const nr = Object.assign({id:uid(), from:month, skips:[], every:eEvery}, data); D.rec.push(nr); t.recId = nr.id;
    }
    J.toast('Modifications enregistrées');
  }
  if (month !== cur && tab === 'mois') cur = month;
  J.haptic(); save(); J.closeSheet(); render();
}

/* ---------- solde, budgets, objectifs ---------- */
function openBalance(){
  const now = balanceNow();
  fq('#bAmt').value = now !== null ? String(now).replace('.', ',') : '';
  fq('#bClear').hidden = now === null;
  J.openSheet(fq('#fBal'));
  J.focusAfterOpen(fq('#bAmt'));
}
let budCat = null;
function openBudget(c){
  budCat = c;
  fq('#budTitle').textContent = 'BUDGET · ' + c.toUpperCase();
  let s = 0, n = 0;
  for (let i = 1; i <= 3; i++) { const m = shift(thisMonth(), -i); if (totals(m).list.length) { s += spentCat(m, c); n++; } }
  const avg = n ? r2(s / n) : 0;
  fq('#budNote').innerHTML = `Plafond mensuel pour <b>${esc(c)}</b>. ${avg ? `Vous dépensez en moyenne <b>${eur(avg)}</b> par mois.` : ''} Je vous préviens à 85 % et en cas de dépassement.`;
  fq('#budAmt').value = S().budgets[c] ? String(S().budgets[c]).replace('.', ',') : '';
  fq('#budClear').hidden = !S().budgets[c];
  J.openSheet(fq('#fBud'));
  J.focusAfterOpen(fq('#budAmt'));
}
const GOAL_COLORS = ['#3fe0ff', '#4dffc3', '#ffb347', '#ff5f8f', '#b98cff', '#ffe066'];
let goalEditing = null, goalColor = GOAL_COLORS[0];
function openGoal(g){
  goalEditing = g || null;
  fq('#gTitle').textContent = g ? 'MODIFIER L\'OBJECTIF' : 'NOUVEL OBJECTIF';
  fq('#gName').value = g ? g.name : '';
  fq('#gTarget').value = g ? String(g.target).replace('.', ',') : '';
  fq('#gSaved').value = g ? String(g.saved).replace('.', ',') : '';
  fq('#gDeadline').value = g && g.deadline ? g.deadline.slice(0, 7) : '';
  goalColor = g ? g.color || GOAL_COLORS[0] : GOAL_COLORS[S().goals.length % GOAL_COLORS.length];
  fq('#gColors').innerHTML = GOAL_COLORS.map(c => `<button data-col="${c}" class="${c === goalColor ? 'on' : ''}" style="--cc:${c}"></button>`).join('');
  fq('#gDel').hidden = !g;
  J.openSheet(fq('#fGoal'));
}
let contribGoal = null;
function openContrib(g){
  contribGoal = g;
  fq('#cTitle').textContent = 'VERSEMENT · ' + g.name.toUpperCase();
  fq('#cAmt').value = '';
  J.openSheet(fq('#fContrib'));
  J.focusAfterOpen(fq('#cAmt'));
}

/* ---------- export CSV ---------- */
async function exportCsv(){
  const T = totals(cur);
  const rows = [['Date', 'Type', 'Libellé', 'Catégorie', 'Montant', 'Statut', 'Note']]
    .concat([...T.list].sort((a, b) => a.day - b.day).map(t => [iso(t.month, t.day), t.type === 'in' ? 'Revenu' : 'Dépense', t.label, t.cat,
      (t.type === 'in' ? '' : '-') + String(t.amount).replace('.', ','), t.done ? 'Pointé' : 'Prévu', t.note || '']));
  const csv = '﻿' + rows.map(r => r.map(v => /[;"\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(';')).join('\n');
  const file = new File([csv], `jarvis-finances-${cur}.csv`, {type:'text/csv'});
  try {
    if (navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file], title:'Finances ' + mLabel(cur)});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
  } catch(e) {}
}

/* ============================================================
   Branchements
   ============================================================ */
function bind(){
  /* clics (délégation) */
  root.addEventListener('click', e => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { J.haptic(); tab = tb.dataset.tab; searchOpen = false; query = ''; render(); window.scrollTo(0, 0); return; }
    const m = e.target.closest('[data-m]'); if (m) return goMonth(+m.dataset.m);
    if (e.target.closest('[data-a="speak"]')) { const t = J.greeting() + ' ' + spoken(cur); J.say(t); J.speak(t); return; }
    const a = e.target.closest('[data-a]');
    if (a) {
      const act = a.dataset.a;
      if (act === 'toggle') { const t = findTx(a.closest('.srow').dataset.id); if (t) toggleDone(t); return; }
      if (act === 'balance') return openBalance();
      if (act === 'pointall') {
        const late = totals(cur).list.filter(t => !t.done && t.day < todayD()), snap = snapshot();
        late.forEach(t => t.done = true); save(); render();
        J.toast(`${late.length} opération${late.length > 1 ? 's' : ''} pointée${late.length > 1 ? 's' : ''}`, {action:'ANNULER', onAction:() => restore(snap)});
        return;
      }
      if (act === 'search') { searchOpen = !searchOpen; if (!searchOpen) query = ''; render(); if (searchOpen) setTimeout(() => q('#fSearch').focus(), 50); return; }
      if (act === 'clearsel') { selDay = null; selCat = null; render(); return; }
      if (act === 'csv') return exportCsv();
      if (act === 'newgoal') return openGoal();
    }
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; render(); return; }
    const d = e.target.closest('[data-d]'); if (d) { J.haptic(); selDay = selDay === +d.dataset.d ? null : +d.dataset.d; render(); return; }
    const c = e.target.closest('[data-cat]');
    if (c && tab === 'mois') { selCat = selCat === c.dataset.cat ? null : c.dataset.cat; render(); return; }
    if (c && tab === 'analyse') { tab = 'mois'; selCat = c.dataset.cat; render(); window.scrollTo(0, 0); return; }
    const bu = e.target.closest('[data-budget]'); if (bu) return openBudget(bu.dataset.budget);
    const ga = e.target.closest('[data-goaladd]'); if (ga) return openContrib(S().goals.find(g => g.id === ga.dataset.goaladd));
    const ge = e.target.closest('[data-goaledit]'); if (ge) return openGoal(S().goals.find(g => g.id === ge.dataset.goaledit));
    const rc = e.target.closest('[data-rec]'); if (rc) return openRec(S().rec.find(r => r.id === rc.dataset.rec));
    const row = e.target.closest('.srow'); if (row) { const t = findTx(row.dataset.id); if (t) openEditor(t); }
  });
  root.addEventListener('input', e => {
    if (e.target.id !== 'fSearch') return;
    query = e.target.value; const pos = e.target.selectionStart;
    render(); const i = q('#fSearch'); i.focus(); i.setSelectionRange(pos, pos);
  });

  /* glisser une ligne : → pointer, ← supprimer (comme dans Mail ou Rappels) */
  J.swipeRows(root, {
    right: row => { const t = findTx(row.dataset.id); if (t) toggleDone(t); },
    left: row => {
      const t = findTx(row.dataset.id); if (!t) return;
      if (t.recId) { render(); openEditor(t); fq('#eDel').click(); }   // récurrente : on demande quoi supprimer
      else removeTx(t);
    },
  });

  /* éditeur */
  fq('#fAdd').addEventListener('click', () => { J.haptic(); openEditor(); });
  fq('#eType').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setType(b.dataset.v); });
  fq('#eCats').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; eCat = b.dataset.c; J.haptic(); renderCats(); goalRow(); });
  fq('#eEvery').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setEvery(b.dataset.v); });
  fq('#eRec').addEventListener('change', recRowsVisibility);
  fq('#eAmt').addEventListener('input', updateCalc);
  fq('#eLbl').addEventListener('input', renderSugg);
  fq('#eSugg').addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const last = [...S().tx].reverse().find(t => t.type === eType && t.label === b.dataset.s);
    fq('#eLbl').value = b.dataset.s;
    if (last) { eCat = last.cat; renderCats(); if (!fq('#eAmt').value) fq('#eAmt').value = String(last.amount).replace('.', ','); }
    J.haptic(); renderSugg(); goalRow(); updateCalc();
  });
  fq('#eSave').addEventListener('click', saveEditor);
  fq('#eDup').addEventListener('click', () => {
    const t = editing; J.closeSheet();
    setTimeout(() => { openEditor(null, {type:t.type, cat:t.cat}); fq('#eAmt').value = String(t.amount).replace('.', ','); fq('#eLbl').value = t.label; renderSugg(); }, 320);
  });
  fq('#eDel').addEventListener('click', () => {
    if (editing.recId) { fq('#eDelAsk').hidden = false; fq('#eMore').hidden = true; fq('#eSave').hidden = true; }
    else { const t = editing; J.closeSheet(); removeTx(t); }
  });
  fq('#eDelCancel').addEventListener('click', () => { fq('#eDelAsk').hidden = true; fq('#eMore').hidden = false; fq('#eSave').hidden = false; });
  fq('#eDelOne').addEventListener('click', () => { const t = editing; J.closeSheet(); removeTx(t, 'one'); });
  fq('#eDelAll').addEventListener('click', () => { const t = editing; J.closeSheet(); removeTx(t, 'all'); });

  /* solde */
  fq('#bSave').addEventListener('click', () => {
    const n = parseAmount(fq('#bAmt').value);
    if (isNaN(n)) { J.toast('Montant invalide'); return; }
    setBalance(n); J.closeSheet(); render(); J.say(`Solde enregistré : ${eur(n)}. Je suis désormais votre compte au centime près.`);
  });
  fq('#bClear').addEventListener('click', () => { S().anchor = null; save(); J.closeSheet(); render(); });

  /* budgets */
  fq('#budSave').addEventListener('click', () => {
    const n = parseAmount(fq('#budAmt').value);
    if (!(n > 0)) { J.toast('Montant invalide'); return; }
    S().budgets[budCat] = n; save(); J.closeSheet(); render(); J.toast(`Budget ${budCat} : ${eur(n)} / mois`);
  });
  fq('#budClear').addEventListener('click', () => { delete S().budgets[budCat]; save(); J.closeSheet(); render(); });

  /* objectifs */
  fq('#gColors').addEventListener('click', e => { const b = e.target.closest('[data-col]'); if (!b) return; goalColor = b.dataset.col; $$('#gColors button', fixed).forEach(x => x.classList.toggle('on', x === b)); });
  fq('#gSave').addEventListener('click', () => {
    const name = fq('#gName').value.trim(), target = parseAmount(fq('#gTarget').value), saved = parseAmount(fq('#gSaved').value || '0');
    if (!name || !(target > 0)) { J.toast('Nom et montant visé requis'); return; }
    const data = {name, target, saved:isNaN(saved) ? 0 : saved, color:goalColor, deadline:fq('#gDeadline').value || null};
    if (goalEditing) Object.assign(goalEditing, data); else S().goals.push(Object.assign({id:uid()}, data));
    save(); J.closeSheet(); render();
  });
  fq('#gDel').addEventListener('click', () => {
    const snap = snapshot(); S().goals = S().goals.filter(g => g !== goalEditing); save(); J.closeSheet(); render();
    J.toast('Objectif supprimé', {action:'ANNULER', onAction:() => restore(snap)});
  });
  const contrib = sign => {
    const n = parseAmount(fq('#cAmt').value);
    if (!(n > 0)) { J.toast('Montant invalide'); return; }
    const g = contribGoal;
    g.saved = r2(Math.max(0, g.saved + sign * n));
    if (fq('#cAsTx').checked) S().tx.push({id:uid(), month:thisMonth(), type:sign > 0 ? 'out' : 'in', label:'Épargne · ' + g.name, amount:n, day:todayD(), cat:sign > 0 ? 'Épargne' : 'Autre', done:true});
    save(); J.closeSheet(); render();
    J.say(g.saved >= g.target ? `Objectif « ${g.name} » atteint. Félicitations.` : `${eur(n)} ${sign > 0 ? 'versés sur' : 'retirés de'} « ${g.name} ». Encore ${eur(r2(g.target - g.saved))}.`);
  };
  fq('#cSave').addEventListener('click', () => contrib(1));
  fq('#cWithdraw').addEventListener('click', () => contrib(-1));
}

/* ---------- Jarvis qui discute : actions et contexte ---------- */
const nrm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function chatAddTx(type, a){
  const amount = r2(Math.abs(parseFloat(String(a.amount).replace(',', '.'))));
  if (!(amount > 0)) throw new Error('montant manquant');
  const cats = Object.keys(CAT[type]);
  /* les mots du libellé priment sur la catégorie devinée par l'IA */
  const KW = {Transport:/essence|carbur|gasoil|diesel|peage|parking|train|sncf|uber|taxi|bus|metro|navigo|velo|trottinette/, Restaurants:/resto|restaurant|mcdo|burger|kebab|pizza|sushi|cafe|bar |brasserie|livraison|deliveroo|uber ?eats/,
    Courses:/carrefour|leclerc|lidl|auchan|intermarche|super ?u|monoprix|franprix|courses|supermarche|marche|boulangerie/, Abonnements:/netflix|spotify|disney|prime video|abonnement|deezer|youtube|icloud|canal/,
    Santé:/pharmacie|medecin|docteur|dentiste|kine|ophtalmo|mutuelle|hopital/, Loisirs:/cinema|cine |concert|jeu|bowling|musee|sortie|spectacle/, Shopping:/amazon|vetement|zara|h&m|chaussure|fnac|decathlon/,
    Factures:/edf|electricite|engie|gaz|eau |internet|box|free|orange|sfr|bouygues|telephone|forfait/, Logement:/loyer|charges|assurance habitation|syndic/};
  const kwCat = type === 'out' ? Object.keys(KW).find(c => KW[c].test(nrm(' ' + (a.label || '') + ' '))) : null;
  if (kwCat) a.category = kwCat;
  const cat = cats.find(c => nrm(c) === nrm(a.category)) || cats.find(c => nrm(a.category).includes(nrm(c)) || nrm(c).includes(nrm(a.category) || '#')) || (type === 'in' ? 'Autre' : 'Autre');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : null;
  const month = d ? d.slice(0, 7) : thisMonth(), day = d ? +d.slice(8, 10) : todayD();
  const done = !d || d <= mk(new Date()) + '-' + String(todayD()).padStart(2, '0');
  const label = String(a.label || cat).slice(0, 60).replace(/^./, c => c.toUpperCase());
  S().tx.push({id:uid(), month, day, type, label, amount, cat, done});
  save(); render();
  return {text:`${type === 'in' ? 'Revenu' : 'Dépense'} ${eur(amount)} · ${label} (${cat})${d && d !== mk(new Date()) + '-' + String(todayD()).padStart(2, '0') ? ' · ' + d.split('-').reverse().slice(0, 2).join('/') : ''}`, go:'finances'};
}
J.actions = J.actions || {};
J.actions.add_expense = a => chatAddTx('out', a);
J.actions.add_income = a => chatAddTx('in', a);
function chatContext(){
  const k = thisMonth(), T = totals(k), now = balanceNow(), end = balanceEnd(k), d = todayD();
  const soon = T.list.filter(t => !t.done && t.day >= d && t.day <= d + 7).sort((a, b) => a.day - b.day).slice(0, 8).map(t => `${t.day}/${k.slice(5)} ${t.label} ${t.type === 'in' ? '+' : '-'}${t.amount}€`);
  const byCat = {}; T.list.filter(t => t.type === 'out').forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `${c} ${Math.round(v)}€`);
  return `FINANCES (${mLabel(k)}) : ${now !== null ? `solde actuel ${now}€, solde prévu fin de mois ${end}€` : `reste prévu ${r2(T.inc - T.out)}€`} ; revenus ${T.inc}€, dépenses ${T.out}€.` +
    (top.length ? ` Plus grosses catégories : ${top.join(', ')}.` : '') + (soon.length ? ` À venir (7 j) : ${soon.join(' ; ')}.` : '') +
    (budgetAlerts(k).length ? ` Alertes : ${budgetAlerts(k).map(x => x.txt).join(' ; ')}.` : '');
}

/* ---------- déclaration du module ---------- */
J.module({
  id: 'finances',
  code: '01',
  order: 20,
  name: 'Finances',
  tagline: 'Solde, budget, épargne et dépenses prévues',
  accent: '#3fe0ff',
  cls: 'fin',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>',

  init(){
    st = J.store('finances', DEFAULTS);
    st.onChange(() => render());
  },
  summary(){
    const k = thisMonth(), T = totals(k), now = balanceNow();
    if (!T.list.length && now === null) return 'Aucune opération ce mois';
    return now !== null ? `Solde <b>${eur(now)}</b><br>Fin de mois ${eur(balanceEnd(k))}` : `Reste prévu <b>${eur(r2(T.inc - T.out))}</b><br>${T.pending} opération${T.pending > 1 ? 's' : ''} à venir`;
  },
  brief(){
    const k = thisMonth(), T = totals(k);
    if (!T.list.length) return '';
    const end = balanceEnd(k), left = r2(T.inc - T.out);
    if (end !== null) return end >= 0 ? `Solde prévu en fin de mois : ${eur(end)}.` : `Attention, découvert prévu de ${eur(-end)}.`;
    return left >= 0 ? `Il vous reste ${eur(left)} prévus ce mois-ci.` : `Attention, budget dépassé de ${eur(-left)} ce mois-ci.`;
  },
  report(){ return spoken(thisMonth()); },
  chat(){ return chatContext(); },
  stat(){
    const k = thisMonth(), T = totals(k), now = balanceNow(), end = balanceEnd(k), left = r2(T.inc - T.out);
    const short = n => Math.round(n).toLocaleString('fr-FR') + ' €';
    if (now !== null) return {label:'SOLDE', value:short(now), sub:`fin de mois ${short(end)}`, ratio:T.inc ? T.out / T.inc : null};
    if (!T.list.length) return {label:'FINANCES', value:'<small>À configurer</small>', sub:'Ajoutez vos revenus'};
    return {label:'RESTE CE MOIS', value:short(left), sub:`${T.pending} opération${T.pending > 1 ? 's' : ''} à venir`, ratio:T.inc ? T.out / T.inc : null};
  },
  briefing(){
    const k = thisMonth(), T = totals(k), d = todayD();
    if (!T.list.length) return null;
    const due = T.list.filter(t => !t.done && t.day <= d).sort((a, b) => a.day - b.day);
    const soon = T.list.filter(t => !t.done && t.day > d && t.day <= d + 3).sort((a, b) => a.day - b.day);
    const now = balanceNow(), end = balanceEnd(k), left = r2(T.inc - T.out), alerts = budgetAlerts(k);
    if (!due.length && !soon.length && !alerts.length && !(end !== null && end < 0)) return null;   // rien à signaler : pas de carte
    const line = (t, when) => `<li><span class="bt2">${when}</span><span>${esc(t.label)}</span><em class="${t.type}">${t.type === 'in' ? '+' : '−'}${eur(t.amount)}</em></li>`;
    return {order:20, icon:J.modules.find(m => m.id === 'finances').icon, title:'FINANCES · À VENIR', act:'mod:finances', right:'›', body:`
      ${end !== null && end < 0 ? `<p class="bs" style="color:var(--red)">⚠ Découvert prévu : ${eur(-end)}</p>` : ''}
      ${alerts.length ? `<p class="bs" style="color:var(--${alerts[0].lvl === 'red' ? 'red' : 'gold'})">⚠ ${esc(alerts[0].txt)}</p>` : ''}
      ${due.length || soon.length ? '<ul class="blist">' + due.map(t => line(t, t.day === d ? 'AUJ.' : 'RETARD')).join('') + soon.map(t => line(t, 'LE ' + t.day)).join('') + '</ul>' : ''}`};
  },
  briefingSpeech(){
    const k = thisMonth(), T = totals(k), d = todayD();
    if (!T.list.length) return '';
    const todayOps = T.list.filter(t => !t.done && t.day === d);
    const now = balanceNow(), end = balanceEnd(k), left = r2(T.inc - T.out);
    const alert = budgetAlerts(k).find(a => a.lvl === 'red');
    return (todayOps.length ? `Prévu aujourd'hui : ${todayOps.slice(0, 2).map(t => `${t.label}, ${eur(t.amount)}`).join(' ; ')}. ` : '') +
      (now !== null ? `Solde actuel ${eur(now)}, ${eur(end)} prévus en fin de mois.` : left >= 0 ? `Il vous reste ${eur(left)} ce mois-ci.` : `Budget dépassé de ${eur(-left)}.`) +
      (alert ? ' ' + alert.txt + '.' : '');
  },

  mount(body, fx){
    root = body; fixed = fx;
    root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED;
    cur = thisMonth(); tab = 'mois'; filter = 'all'; selDay = null; selCat = null; query = ''; searchOpen = false;
    bind(); render();
    J.say(status(cur));
  },
  onShow(){ render(); J.say(status(cur)); },
  unmount(){ root = null; fixed = null; },
});
})();
