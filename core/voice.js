/* ============================================================
   J.A.R.V.I.S. — moteur de voix
   1. le serveur génère la phrase (Workers AI, voix française)
   2. on baisse le ton sans changer le débit (WSOLA + rééchantillonnage) :
      la voix devient plus grave et plus masculine
   3. chaîne d'effets « assistant IA » : chaleur, présence, léger dédoublement,
      timbre métallique discret, petite réverbération
   4. le réacteur réagit au volume pendant que Jarvis parle
   Repli automatique sur la voix de l'iPhone si le serveur est injoignable.
   ============================================================ */
'use strict';
(() => {
const PITCH = 0.76;          // facteur de hauteur (0.76 ≈ -4,7 demi-tons)

/* ---------- nombres en toutes lettres (la synthèse lit mal « 1 110,00 € ») ---------- */
const U = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
const T = ['','','vingt','trente','quarante','cinquante','soixante','soixante','quatre-vingt','quatre-vingt'];
function lt100(n){
  if (n < 20) return U[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7 || t === 9) return T[t] + (t === 7 && u === 1 ? ' et ' : '-') + U[10 + u];
  if (u === 0) return t === 8 ? 'quatre-vingts' : T[t];
  if (u === 1 && t < 8) return T[t] + ' et un';
  return T[t] + '-' + U[u];
}
function lt1000(n, plural = true){
  const h = Math.floor(n / 100), r = n % 100;
  let s = h > 1 ? U[h] + ' cent' + (r === 0 && plural ? 's' : '') : h === 1 ? 'cent' : '';
  if (r) s += (s ? ' ' : '') + lt100(r);
  return s || 'zéro';
}
function words(n){
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const m = Math.floor(n / 1e6), k = Math.floor((n % 1e6) / 1000), r = n % 1000;
  const out = [];
  if (m) out.push(lt1000(m) + ' million' + (m > 1 ? 's' : ''));
  if (k) out.push(k === 1 ? 'mille' : lt1000(k, false) + ' mille');
  if (r) out.push(lt1000(r));
  return out.join(' ');
}
const NUM = '(-?\\d{1,3}(?:[\\s\\u00a0\\u202f]\\d{3})*|-?\\d+)';
function speakable(text){
  return text
    .replace(new RegExp(NUM + '(?:,(\\d{1,2}))?\\s?€', 'g'), (_, i, c) => {
      const e = parseInt(i.replace(/[\s  ]/g, ''), 10), cents = c ? parseInt(c.padEnd(2, '0'), 10) : 0;
      return (e < 0 ? 'moins ' : '') + words(e) + (Math.abs(e) > 1 ? ' euros' : ' euro') + (cents ? ' et ' + words(cents) + ' centimes' : '');
    })
    .replace(new RegExp(NUM + '\\s?%', 'g'), (_, i) => words(parseInt(i.replace(/\D/g, ''), 10)) + ' pour cent')
    .replace(/\b\d+\b/g, n => words(parseInt(n, 10)))
    .replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim();
}
J.speakable = speakable;

/* ---------- audio ---------- */
let ctx = null, chain = null, current = null, meterRaf = 0;
function audio(){
  if (!ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch(e) {}   // joue même en mode silencieux (on a touché pour l'entendre)
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    chain = buildChain(ctx);
  }
  if (ctx.state !== 'running') ctx.resume();
  return ctx;
}

function impulse(ac, seconds, decay){
  const len = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function buildChain(ac){
  const input = ac.createGain();
  const hp = Object.assign(ac.createBiquadFilter(), {type:'highpass'}); hp.frequency.value = 85;
  const warm = Object.assign(ac.createBiquadFilter(), {type:'lowshelf'}); warm.frequency.value = 220; warm.gain.value = 3;
  const mud = Object.assign(ac.createBiquadFilter(), {type:'peaking'}); mud.frequency.value = 450; mud.Q.value = 1.2; mud.gain.value = -2;
  const presence = Object.assign(ac.createBiquadFilter(), {type:'peaking'}); presence.frequency.value = 3200; presence.Q.value = .9; presence.gain.value = 4;
  const lp = Object.assign(ac.createBiquadFilter(), {type:'lowpass'}); lp.frequency.value = 9500;
  input.connect(hp); hp.connect(warm); warm.connect(mud); mud.connect(presence); presence.connect(lp);

  const mix = ac.createGain();
  const dry = ac.createGain(); dry.gain.value = .9; lp.connect(dry); dry.connect(mix);

  // timbre métallique : filtre en peigne très court
  const comb = ac.createDelay(.05); comb.delayTime.value = .0065;
  const fb = ac.createGain(); fb.gain.value = .32;
  const combOut = ac.createGain(); combOut.gain.value = .16;
  lp.connect(comb); comb.connect(fb); fb.connect(comb); comb.connect(combOut); combOut.connect(mix);

  // dédoublement « IA » : copie légèrement retardée et modulée
  const dbl = ac.createDelay(.1); dbl.delayTime.value = .016;
  const lfo = ac.createOscillator(); lfo.frequency.value = .35;
  const depth = ac.createGain(); depth.gain.value = .0018;
  lfo.connect(depth); depth.connect(dbl.delayTime); lfo.start();
  const dblOut = ac.createGain(); dblOut.gain.value = .22;
  lp.connect(dbl); dbl.connect(dblOut); dblOut.connect(mix);

  // petite pièce
  const verb = ac.createConvolver(); verb.buffer = impulse(ac, 1.1, 3.2);
  const verbHp = Object.assign(ac.createBiquadFilter(), {type:'highpass'}); verbHp.frequency.value = 300;
  const verbOut = ac.createGain(); verbOut.gain.value = .14;
  lp.connect(verbHp); verbHp.connect(verb); verb.connect(verbOut); verbOut.connect(mix);

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = .004; comp.release.value = .18;
  const out = ac.createGain(); out.gain.value = 1.35;
  const analyser = ac.createAnalyser(); analyser.fftSize = 1024;
  mix.connect(comp); comp.connect(out); out.connect(analyser); analyser.connect(ac.destination);
  return {input, analyser};
}

/* WSOLA : change la durée sans changer la hauteur.
   On compresse la durée par PITCH puis on relit à la vitesse PITCH → même durée, voix plus grave. */
function stretch(x, alpha, sr){
  const N = Math.round(sr * .046) & ~1, Hs = N >> 2, Ha = Hs / alpha, tol = Hs;
  const w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
  const outLen = Math.ceil(x.length * alpha) + N, y = new Float32Array(outLen), norm = new Float32Array(outLen);
  let prev = 0;
  for (let k = 0; ; k++) {
    const target = Math.round(k * Ha), op = k * Hs;
    if (target + N + tol >= x.length || op + N >= outLen) break;
    let best = 0, bestC = -Infinity;
    if (k > 0) {
      const nat = prev + Hs;
      for (let d = -tol; d <= tol; d += 4) {
        const p = target + d; if (p < 0) continue;
        let c = 0; for (let i = 0; i < N; i += 8) c += x[p + i] * x[nat + i];
        if (c > bestC) { bestC = c; best = d; }
      }
    }
    const p = Math.max(0, target + best);
    for (let i = 0; i < N; i++) { y[op + i] += x[p + i] * w[i]; norm[op + i] += w[i]; }
    prev = p;
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) y[i] /= norm[i];
  return y;
}

const cache = new Map();   // texte -> AudioBuffer traité
async function render(text){
  if (cache.has(text)) return cache.get(text);
  const res = await fetch(J.API + '/api/tts', {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + J.token()},
    body:JSON.stringify({text}),
  });
  if (!res.ok) throw new Error('tts ' + res.status);
  const raw = await ctx.decodeAudioData(await res.arrayBuffer());
  const y = stretch(raw.getChannelData(0), PITCH, raw.sampleRate);
  const buf = ctx.createBuffer(1, y.length, raw.sampleRate);
  buf.getChannelData(0).set(y);
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  cache.set(text, buf);
  return buf;
}

/* le réacteur de la vue active pulse avec la voix */
function meter(on){
  cancelAnimationFrame(meterRaf);
  const els = J.$$('.view.active .reactor');
  if (!on) { els.forEach(el => { el.classList.remove('speaking'); el.style.removeProperty('--lvl'); }); return; }
  els.forEach(el => el.classList.add('speaking'));
  const data = new Uint8Array(chain.analyser.fftSize);
  let smooth = 0;
  const tick = () => {
    chain.analyser.getByteTimeDomainData(data);
    let s = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; s += v * v; }
    smooth = smooth * .6 + Math.min(1, Math.sqrt(s / data.length) * 4) * .4;
    els.forEach(el => el.style.setProperty('--lvl', smooth.toFixed(3)));
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
}

function stop(){
  if (current) { try { current.onended = null; current.stop(); } catch(e) {} current = null; }
  meter(false);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function fallback(text){
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR'; u.rate = .98; u.pitch = .85;
  const v = speechSynthesis.getVoices().filter(v => v.lang.startsWith('fr'));
  const pick = v.find(v => /Thomas/i.test(v.name) && /amélior|enhanced|premium/i.test(v.name)) || v.find(v => /Thomas|Daniel|Nicolas/i.test(v.name)) || v[0];
  if (pick) u.voice = pick;
  speechSynthesis.speak(u);
}

let seq = 0;
J.speak = async (text) => {
  const p = J.prefs && J.prefs();
  if (!p || !p.voice) return;
  stop();
  const spoken = speakable(text);
  if (p.voiceMode === 'iphone' || !J.token()) { fallback(spoken); return; }
  audio();                         // doit être appelé pendant le toucher (exigence iOS)
  const my = ++seq;
  J.$$('.view.active .reactor').forEach(el => el.classList.add('thinking'));
  try {
    const buf = await render(spoken);
    if (my !== seq) return;        // une autre phrase a été demandée entre-temps
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = PITCH;
    src.connect(chain.input);
    src.onended = () => { if (current === src) { current = null; meter(false); } };
    current = src; src.start(); meter(true);
  } catch(e) {
    if (my === seq) fallback(spoken);
  } finally {
    J.$$('.reactor.thinking').forEach(el => el.classList.remove('thinking'));
  }
};
J.stopSpeaking = stop;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); });
})();
