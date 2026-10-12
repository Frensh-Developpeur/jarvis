/* ============================================================
   Module 01 — Finances
   Revenus / dépenses prévus et effectués, opérations mensuelles.
   ============================================================ */
'use strict';
(() => {
const {$, $$, esc, eur, uid, r2} = J;
const CATS = {
  out: ['Logement','Courses','Transport','Abonnements','Factures','Restaurants','Loisirs','Shopping','Santé','Épargne','Crédit','Autre'],
  in:  ['Salaire','Prime','Remboursement','Aide / CAF','Vente','Cadeau','Autre']
};

/* ---------- dates ---------- */
const mk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
const ym = k => k.split('-').map(Number);
const shift = (k, n) => { const [y,m] = ym(k); return mk(new Date(y, m-1+n, 1)); };
const dim = k => { const [y,m] = ym(k); return new Date(y, m, 0).getDate(); };
const mLabel = k => { const [y,m] = ym(k); return new Date(y, m-1, 1).toLocaleDateString('fr-FR', {month:'long', year:'numeric'}); };
const thisMonth = () => mk(new Date());

let st = null;              // document synchronisé {tx, rec}
let root = null, fixed = null;
let cur = thisMonth(), filter = 'all';
const S = () => st.data;
const save = () => st.save();

/* les opérations mensuelles créent une vraie opération la première fois qu'un mois est consulté */
function materialize(k){
  let changed = false;
  for (const r of S().rec) {
    if (r.from > k || (r.until && r.until < k) || r.skips.includes(k)) continue;
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
    pending: list.filter(t => !t.done).length
  };
}
function status(T){
  if (!T.list.length) return 'Aucune donnée pour ce mois. Ajoutez votre salaire et vos dépenses prévues pour commencer.';
  const left = r2(T.inc - T.out);
  if (T.inc === 0) return 'Je ne détecte aucun revenu ce mois-ci. ' + eur(T.out) + ' de dépenses enregistrées.';
  if (left < 0) return 'Alerte : les dépenses prévues dépassent les revenus de ' + eur(-left) + '. Je recommande des ajustements.';
  const ratio = T.out / T.inc;
  if (ratio > .9) return 'Marge critique : il ne restera que ' + eur(left) + '. Prudence recommandée.';
  if (ratio > .75) return 'Situation sous contrôle, mais la marge est réduite. Reste prévu : ' + eur(left) + '.';
  return 'Tous les systèmes sont nominaux. Marge confortable de ' + eur(left) + ' en fin de mois.';
}
function spoken(k){
  const T = totals(k), left = r2(T.inc - T.out);
  if (!T.list.length) return `Aucune opération enregistrée pour ${mLabel(k)}.`;
  return `Pour ${mLabel(k)}, vous avez ${eur(T.inc)} de revenus et ${eur(T.out)} de dépenses. ` +
    (left >= 0 ? `Il vous restera ${eur(left)}.` : `Vous serez à découvert de ${eur(-left)}.`) +
    (T.pending ? ` ${T.pending} opération${T.pending > 1 ? 's' : ''} encore à venir.` : '');
}

/* ---------- interface ---------- */
const TEMPLATE = `
  <div class="month">
    <button data-m="-1" aria-label="Mois précédent">‹</button>
    <div class="lbl" id="fMonth"></div>
    <button data-m="1" aria-label="Mois suivant">›</button>
  </div>
  <div class="reactor" id="fReactor" title="Touchez pour un rapport vocal">
    ${J.reactorSVG('f')}
    <div class="core">
      <div class="k">RESTE PRÉVU</div>
      <div class="v" id="fLeft">0 €</div>
      <div class="s">Réel : <b id="fReal">0 €</b></div>
      <div class="r" id="fRatio"></div>
    </div>
  </div>
  <div class="stats">
    <div class="stat in"><div class="k">REVENUS</div><div class="v" id="fIn"></div><div class="s" id="fInD"></div></div>
    <div class="stat out"><div class="k">DÉPENSES</div><div class="v" id="fOut"></div><div class="s" id="fOutD"></div></div>
    <div class="stat left"><div class="k">À VENIR</div><div class="v" id="fPend"></div><div class="s">opérations</div></div>
  </div>
  <div class="filters" id="fFilters">
    <button data-f="all">TOUT</button><button data-f="plan">PRÉVU</button><button data-f="done">EFFECTUÉ</button>
  </div>
  <section class="panel"><div class="ph"><span>REVENUS</span><span id="fTIn"></span></div><div id="fListIn"></div></section>
  <section class="panel"><div class="ph"><span>DÉPENSES</span><span id="fTOut"></span></div><div id="fListOut"></div></section>
  <section class="panel" id="fCatPanel"><div class="ph"><span>ANALYSE PAR CATÉGORIE</span><span></span></div><div id="fCats"></div></section>`;

const FIXED = `
  <button class="fab" id="fAdd" aria-label="Ajouter une opération">+</button>
  <div class="sheet fin" id="fEdit" role="dialog" aria-label="Opération">
    <div class="grab"></div>
    <h2 id="eTitle">NOUVELLE OPÉRATION</h2>
    <div class="seg" id="eType"><button data-v="out">DÉPENSE</button><button data-v="in">REVENU</button></div>
    <div class="field"><label>MONTANT (€)</label><input id="eAmt" class="big" inputmode="decimal" placeholder="0,00" autocomplete="off"></div>
    <div class="field"><label>LIBELLÉ</label><input id="eLbl" placeholder="Ex : Loyer, Salaire…" autocomplete="off" maxlength="60"></div>
    <div class="two">
      <div class="field"><label>CATÉGORIE</label><select id="eCat"></select></div>
      <div class="field"><label>JOUR</label><input id="eDay" type="number" inputmode="numeric" min="1" max="31"></div>
    </div>
    <div class="toggle"><span>Déjà effectué<small>Passé sur le compte</small></span><label class="sw"><input type="checkbox" id="eDone"><i></i></label></div>
    <div class="toggle"><span>Tous les mois<small>Revient automatiquement chaque mois</small></span><label class="sw"><input type="checkbox" id="eRec"><i></i></label></div>
    <div class="toggle" id="eFutureRow"><span>Modifier aussi les mois suivants<small>Sinon, seulement ce mois-ci</small></span><label class="sw"><input type="checkbox" id="eFuture"><i></i></label></div>
    <button class="btn primary" id="eSave">ENREGISTRER</button>
    <button class="btn danger" id="eDel">SUPPRIMER</button>
    <div id="eDelAsk">
      <p class="note">C'est une opération mensuelle. Que dois-je supprimer ?</p>
      <button class="btn danger" id="eDelOne">CE MOIS SEULEMENT</button>
      <button class="btn danger" id="eDelAll">CE MOIS ET LES SUIVANTS</button>
      <button class="btn ghost" id="eDelCancel">ANNULER</button>
    </div>
  </div>`;

const q = s => $(s, root);
const fq = s => $(s, fixed);

function rowHTML(t){
  const plan = !t.done ? '<span class="tag plan">PRÉVU</span>' : '';
  const rec = t.recId ? '<span class="tag">↻</span>' : '';
  return `<div class="row ${t.done ? '' : 'planned'}" data-id="${t.id}">
    <button class="chk ${t.done ? 'on' : ''}" data-act="toggle" aria-label="Marquer effectué"></button>
    <div class="info"><div class="l">${esc(t.label)}${rec}${plan}</div><div class="m">${esc(t.cat)} · le ${t.day}</div></div>
    <div class="amt ${t.type}">${t.type === 'in' ? '+' : '−'}${eur(t.amount)}</div></div>`;
}
function render(){
  if (!root) return;
  const T = totals(cur);
  const left = r2(T.inc - T.out), real = r2(T.incD - T.outD), today = thisMonth();
  q('#fMonth').innerHTML = esc(mLabel(cur)) + '<small>' + (cur === today ? 'MOIS EN COURS' : cur < today ? 'ARCHIVE' : 'PRÉVISION') + '</small>';
  const lv = q('#fLeft'); lv.textContent = eur(left); lv.classList.toggle('neg', left < 0);
  q('#fReal').textContent = eur(real);
  const ratio = T.inc > 0 ? T.out / T.inc : (T.out > 0 ? 1 : 0);
  J.setArc(q('#fReactor'), ratio);
  q('#fRatio').textContent = T.inc > 0 ? Math.round(ratio * 100) + '% ENGAGÉ' : '';
  q('#fIn').textContent = eur(T.inc);   q('#fInD').textContent = 'reçu ' + eur(T.incD);
  q('#fOut').textContent = eur(T.out);  q('#fOutD').textContent = 'payé ' + eur(T.outD);
  q('#fPend').textContent = T.pending;
  $$('#fFilters button', root).forEach(b => b.classList.toggle('on', b.dataset.f === filter));

  const show = T.list.filter(t => filter === 'all' || (filter === 'done' ? t.done : !t.done)).sort((a,b) => a.day - b.day || b.amount - a.amount);
  const ins = show.filter(t => t.type === 'in'), outs = show.filter(t => t.type === 'out');
  q('#fListIn').innerHTML  = ins.length  ? ins.map(rowHTML).join('')  : '<div class="empty">Aucun revenu' + (filter === 'all' ? ' — touchez + pour ajouter votre salaire' : '') + '</div>';
  q('#fListOut').innerHTML = outs.length ? outs.map(rowHTML).join('') : '<div class="empty">Aucune dépense' + (filter === 'all' ? ' — touchez + pour en ajouter' : '') + '</div>';
  q('#fTIn').textContent = eur(r2(ins.reduce((a,t) => a + t.amount, 0)));
  q('#fTOut').textContent = eur(r2(outs.reduce((a,t) => a + t.amount, 0)));

  const byCat = {};
  T.list.filter(t => t.type === 'out').forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const cats = Object.entries(byCat).sort((a,b) => b[1] - a[1]), max = cats.length ? cats[0][1] : 1;
  q('#fCatPanel').hidden = !cats.length;
  q('#fCats').innerHTML = cats.map(([c,v]) =>
    `<div class="cat"><div class="t"><span>${esc(c)}</span><span>${eur(r2(v))} · ${T.out ? Math.round(v / T.out * 100) : 0}%</span></div><div class="bar"><i style="width:${v / max * 100}%"></i></div></div>`).join('');
  return T;
}
const goMonth = n => { J.haptic(); cur = shift(cur, n); J.say(status(render())); };

/* ---------- éditeur ---------- */
let editing = null, eType = 'out';
function setType(v){
  eType = v;
  $$('#eType button', fixed).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const sel = fq('#eCat'), keep = sel.value;
  sel.innerHTML = CATS[v].map(c => `<option>${esc(c)}</option>`).join('');
  if (CATS[v].includes(keep)) sel.value = keep;
}
function openEditor(t){
  editing = t || null;
  fq('#eTitle').textContent = t ? 'MODIFIER L\'OPÉRATION' : 'NOUVELLE OPÉRATION';
  setType(t ? t.type : 'out');
  fq('#eAmt').value = t ? String(t.amount).replace('.', ',') : '';
  fq('#eLbl').value = t ? t.label : '';
  fq('#eCat').value = t ? t.cat : CATS.out[0];
  fq('#eDay').value = t ? t.day : (cur === thisMonth() ? new Date().getDate() : 1);
  fq('#eDone').checked = t ? t.done : false;
  fq('#eRec').checked = t ? !!t.recId : false;
  fq('#eFutureRow').hidden = !(t && t.recId);
  fq('#eFuture').checked = false;
  fq('#eDel').hidden = !t; fq('#eDelAsk').hidden = true; fq('#eSave').hidden = false;
  J.openSheet(fq('#fEdit'));
  if (!t) setTimeout(() => fq('#eAmt').focus(), 300);
}
function saveEditor(){
  const amount = r2(parseFloat(fq('#eAmt').value.replace(/\s/g, '').replace(',', '.')));
  if (!(amount > 0)) { J.toast('Montant invalide'); fq('#eAmt').focus(); return; }
  const label = fq('#eLbl').value.trim() || fq('#eCat').value;
  const day = Math.min(Math.max(parseInt(fq('#eDay').value) || 1, 1), dim(cur));
  const data = {type:eType, label, amount, day, cat:fq('#eCat').value};
  const done = fq('#eDone').checked, wantRec = fq('#eRec').checked;
  const D = S();
  if (!editing) {
    const t = Object.assign({id:uid(), month:cur, done}, data);
    if (wantRec) { const r = Object.assign({id:uid(), from:cur, skips:[]}, data); D.rec.push(r); t.recId = r.id; }
    D.tx.push(t);
    J.toast(eType === 'in' ? 'Revenu enregistré' : 'Dépense enregistrée');
  } else {
    const t = editing;
    Object.assign(t, data, {done});
    const r = t.recId && D.rec.find(x => x.id === t.recId);
    if (r && !wantRec) {
      r.until = shift(cur, -1);
      D.tx = D.tx.filter(x => !(x.recId === r.id && x.month > cur && !x.done));
      delete t.recId;
    } else if (r && fq('#eFuture').checked) {
      Object.assign(r, data);
      D.tx.filter(x => x.recId === r.id && x.month > cur && !x.done).forEach(x => Object.assign(x, data, {day:Math.min(data.day, dim(x.month))}));
    } else if (!r && wantRec) {
      const nr = Object.assign({id:uid(), from:cur, skips:[]}, data); D.rec.push(nr); t.recId = nr.id;
    }
    J.toast('Modifications enregistrées');
  }
  J.haptic(); save(); J.closeSheet(); render();
}
function del(mode){
  const D = S();
  if (mode === 'one' && editing.recId) { const r = D.rec.find(x => x.id === editing.recId); if (r && !r.skips.includes(cur)) r.skips.push(cur); }
  if (mode === 'all') {
    const id = editing.recId, r = D.rec.find(x => x.id === id);
    if (r) r.until = shift(cur, -1);
    D.tx = D.tx.filter(x => !(x.recId === id && x.month > cur && !x.done));
  }
  D.tx = D.tx.filter(x => x !== editing);
  save(); J.closeSheet(); render();
  J.toast(mode === 'all' ? 'Récurrence arrêtée' : mode === 'one' ? 'Supprimé pour ce mois' : 'Opération supprimée');
}

/* ---------- déclaration du module ---------- */
J.module({
  id: 'finances',
  code: '01',
  name: 'Finances',
  tagline: 'Comptes, budget et dépenses prévues',
  accent: '#3fe0ff',
  cls: 'fin',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>',

  init(){
    st = J.store('finances', {tx:[], rec:[]});
    st.onChange(() => render());
  },
  summary(){
    const T = totals(thisMonth()), left = r2(T.inc - T.out);
    if (!T.list.length) return 'Aucune opération ce mois';
    return `Reste prévu <b>${eur(left)}</b><br>${T.pending} opération${T.pending > 1 ? 's' : ''} à venir`;
  },
  brief(){
    const T = totals(thisMonth());
    if (!T.list.length) return '';
    const left = r2(T.inc - T.out);
    return left >= 0 ? `Il vous reste ${eur(left)} prévus ce mois-ci.` : `Attention, budget dépassé de ${eur(-left)} ce mois-ci.`;
  },
  report(){ return spoken(thisMonth()); },

  mount(body, fx){
    root = body; fixed = fx;
    root.innerHTML = TEMPLATE; fixed.innerHTML = FIXED;
    cur = thisMonth(); filter = 'all';
    J.say(status(render()));

    $$('[data-m]', root).forEach(b => b.addEventListener('click', () => goMonth(+b.dataset.m)));
    q('#fFilters').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { filter = b.dataset.f; render(); } });
    q('#fReactor').addEventListener('click', () => { const t = J.greeting() + ' ' + spoken(cur); J.say(t); J.speak(t); });
    root.addEventListener('click', e => {
      const row = e.target.closest('.row'); if (!row) return;
      const t = S().tx.find(x => x.id === row.dataset.id); if (!t) return;
      if (e.target.closest('[data-act="toggle"]')) { t.done = !t.done; save(); render(); J.haptic(); }
      else openEditor(t);
    });
    /* glisser à gauche/droite = changer de mois */
    let sx = null, sy = null;
    root.addEventListener('touchstart', e => { sx = J.fromEdge() ? null : e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive:true});
    root.addEventListener('touchend', e => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 50) goMonth(dx < 0 ? 1 : -1);
    }, {passive:true});

    fq('#fAdd').addEventListener('click', () => openEditor());
    fq('#eType').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setType(b.dataset.v); });
    fq('#eSave').addEventListener('click', saveEditor);
    fq('#eDel').addEventListener('click', () => {
      if (editing.recId) { fq('#eDelAsk').hidden = false; fq('#eDel').hidden = true; fq('#eSave').hidden = true; }
      else del('single');
    });
    fq('#eDelCancel').addEventListener('click', () => { fq('#eDelAsk').hidden = true; fq('#eDel').hidden = false; fq('#eSave').hidden = false; });
    fq('#eDelOne').addEventListener('click', () => del('one'));
    fq('#eDelAll').addEventListener('click', () => del('all'));
  },
  unmount(){ root = null; fixed = null; },
});
})();
