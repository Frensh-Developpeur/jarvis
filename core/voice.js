/* ============================================================
   J.A.R.V.I.S. — moteur de voix
   1. le serveur génère la phrase (Workers AI, voix française)
   2. voix de repli uniquement : on baisse le ton sans changer le débit
      (WSOLA + rééchantillonnage) pour la rendre plus grave
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
const hours = h => (h === 1 || h === 21 ? words(h).replace(/un$/, 'une') : words(h)) + (h > 1 ? ' heures' : ' heure');
function speakable(text){
  return text
    .replace(/\b([01]?\d|2[0-3])\s?h\s?([0-5]\d)\b/g, (_, h, m) => hours(+h) + ' ' + words(+m))      // 18h30 → dix-huit heures trente
    .replace(/\b([01]?\d|2[0-3])\s?h\b(?!\/)/g, (_, h) => hours(+h))                                  // 18 h → dix-huit heures
    .replace(/(\d)\s?kcal\b/g, '$1 kilocalories').replace(/(\d)\s?kg\b/g, '$1 kilos').replace(/(\d)\s?g\b/g, '$1 grammes')
    .replace(/(\d)\s?km\b/g, '$1 kilomètres').replace(/(\d)\s?ml\b/gi, '$1 millilitres').replace(/(\d)\s?L\b/g, '$1 litres').replace(/(\d)\s?min\b/g, '$1 minutes')
    .replace(/(\d)\s?[×x]\s?(\d)/g, '$1 fois $2')
    .replace(new RegExp(NUM + '(?:,(\\d{1,2}))?\\s?€', 'g'), (_, i, c) => {
      const e = parseInt(i.replace(/[\s  ]/g, ''), 10), cents = c ? parseInt(c.padEnd(2, '0'), 10) : 0;
      return (e < 0 ? 'moins ' : '') + words(e) + (Math.abs(e) > 1 ? ' euros' : ' euro') + (cents ? ' et ' + words(cents) + ' centimes' : '');
    })
    .replace(new RegExp(NUM + '\\s?%', 'g'), (_, i) => words(parseInt(i.replace(/\D/g, ''), 10)) + ' pour cent')
    .replace(/\d{1,3}(?:[\u00a0\u202f ]\d{3})+(?!\d)/g, n => words(parseInt(n.replace(/\D/g, ''), 10)))   // 5 432 → cinq mille…
    .replace(/\b(\d+)[,.](\d+)\b/g, (_, i, d) => words(+i) + ' virgule ' + (d.startsWith('0') ? 'zéro ' + words(+d) : words(+d)))   // 78,4 → soixante-dix-huit virgule quatre
    .replace(/\b\d+\b/g, n => words(parseInt(n, 10)))
    .replace(/[«»"*_#]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
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
/* Chaîne « Jarvis du film » : voix propre, légèrement filtrée comme dans un casque,
   brillance numérique, miroitement synthétique discret, stéréo large et petite pièce. */
function buildChain(ac){
  const bq = (type, f, g = 0, q = 0.707) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.gain.value = g; n.Q.value = q; return n; };
  const gain = v => { const g = ac.createGain(); g.gain.value = v; return g; };
  const input = gain(1);

  // égalisation
  const hp = bq('highpass', 130);
  const warm = bq('lowshelf', 220, 1.5);
  const mud = bq('peaking', 420, -2.5, 1.2);
  const presence = bq('peaking', 3000, 3, .9);
  const air = bq('highshelf', 7000, 3.5);
  const lp = bq('lowpass', 11500);
  input.connect(hp); hp.connect(warm); warm.connect(mud); mud.connect(presence); presence.connect(air); air.connect(lp);

  // légère saturation numérique en parallèle (le « grain » électronique)
  const shaper = ac.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
  shaper.curve = curve; shaper.oversample = '4x';
  const satBand = bq('bandpass', 2500, 0, .7);
  const satOut = gain(.08);
  lp.connect(satBand); satBand.connect(shaper); shaper.connect(satOut);

  // timbre métallique : filtre en peigne très court
  const comb = ac.createDelay(.05); comb.delayTime.value = .0045;
  const fb = gain(.3), combOut = gain(.06);
  lp.connect(comb); comb.connect(fb); fb.connect(comb); comb.connect(combOut);

  // miroitement synthétique : copie très proche, lentement modulée (effet flanger doux)
  const dbl = ac.createDelay(.05); dbl.delayTime.value = .0035;
  const lfo = ac.createOscillator(); lfo.frequency.value = .22;
  const depth = gain(.0012);
  lfo.connect(depth); depth.connect(dbl.delayTime); lfo.start();
  const dblOut = gain(.14);
  lp.connect(dbl); dbl.connect(dblOut);

  // somme mono puis image stéréo : un côté légèrement retardé (effet Haas)
  const mono = gain(1);
  lp.connect(mono); satOut.connect(mono); combOut.connect(mono); dblOut.connect(mono);
  const merger = ac.createChannelMerger(2);
  const left = gain(1), right = gain(1);
  const haas = ac.createDelay(.05); haas.delayTime.value = .011;
  const widthOut = gain(.28);
  mono.connect(left); mono.connect(right);
  mono.connect(haas); haas.connect(widthOut); widthOut.connect(right);
  left.connect(merger, 0, 0); right.connect(merger, 0, 1);

  // petite pièce (le labo)
  const verb = ac.createConvolver(); verb.buffer = impulse(ac, .9, 3.5);
  const verbHp = bq('highpass', 350);
  const verbOut = gain(.1);
  mono.connect(verbHp); verbHp.connect(verb); verb.connect(verbOut);

  const bus = gain(1);
  merger.connect(bus); verbOut.connect(bus);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = .004; comp.release.value = .18;
  const out = gain(1.3);
  const analyser = ac.createAnalyser(); analyser.fftSize = 1024;
  bus.connect(comp); comp.connect(out); out.connect(analyser); analyser.connect(ac.destination);
  return {input, analyser, combOut, dblOut, verbOut, presence, warm, air, satOut, widthOut, hp};
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

/* Intensité des effets selon la voix :
   - ElevenLabs : voix déjà masculine et naturelle → juste une touche « IA »
   - Cloudflare (repli) : voix féminine → ton baissé + effets plus marqués */
const FX = {
  eleven: {comb:0,   dbl:0,   verb:.07, presence:2, warm:1,   air:2.5, sat:0,   width:.16, hp:110, rate:1},   // voix propre : le peigne et le dédoublement la rendaient « bizarre »
  melo:   {comb:.16, dbl:.22, verb:.14, presence:4, warm:3,   air:2,   sat:.05, width:.2,  hp:90,  rate:PITCH},
};
function setFx(engine){
  const f = FX[engine] || FX.eleven, t = ctx.currentTime, c = chain;
  c.combOut.gain.setValueAtTime(f.comb, t); c.dblOut.gain.setValueAtTime(f.dbl, t);
  c.verbOut.gain.setValueAtTime(f.verb, t); c.presence.gain.setValueAtTime(f.presence, t);
  c.warm.gain.setValueAtTime(f.warm, t);    c.air.gain.setValueAtTime(f.air, t);
  c.satOut.gain.setValueAtTime(f.sat, t);   c.widthOut.gain.setValueAtTime(f.width, t);
  c.hp.frequency.setValueAtTime(f.hp, t);
  return f;
}

const cache = new Map();   // texte -> {buf, engine}
async function render(text, voice){
  const key = voice + '|' + text;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(J.API + '/api/tts', {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + J.token()},
    body:JSON.stringify({text, voice}),
  });
  if (!res.ok) throw new Error('tts ' + res.status);
  const engine = res.headers.get('X-Voice-Engine') || 'melo';
  const raw = await ctx.decodeAudioData(await res.arrayBuffer());
  let buf = raw;
  if (engine === 'melo') {
    const y = stretch(raw.getChannelData(0), PITCH, raw.sampleRate);
    buf = ctx.createBuffer(1, y.length, raw.sampleRate);
    buf.getChannelData(0).set(y);
  }
  const out = {buf, engine};
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
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

let doneCb = null;   // fin de la phrase en cours (J.speak renvoie une promesse : true = dite jusqu'au bout)
const finish = ok => { const f = doneCb; doneCb = null; if (f) f(ok); };
function stop(){
  finish(false);
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
  u.onend = () => finish(true); u.onerror = () => finish(false);
  speechSynthesis.speak(u);
}

let seq = 0;
J.speak = (text) => {
  const p = J.prefs && J.prefs();
  if (!p || !p.voice) return Promise.resolve(false);
  stop();
  const done = new Promise(res => { doneCb = res; });
  speakNow(text, p);
  return done;
};
async function speakNow(text, p){
  const spoken = speakable(text);
  if (p.voiceMode === 'iphone' || !J.token()) { if (!('speechSynthesis' in window)) finish(false); fallback(spoken); return; }
  audio();                         // doit être appelé pendant le toucher (exigence iOS)
  const my = ++seq;
  J.$$('.view.active .reactor').forEach(el => el.classList.add('thinking'));
  try {
    const {buf, engine} = await render(spoken, p.voiceName || 'george');
    if (my !== seq) return;        // une autre phrase a été demandée entre-temps (stop() a déjà conclu)
    const fx = setFx(engine);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = fx.rate;
    src.connect(chain.input);
    src.onended = () => { if (current === src) { current = null; meter(false); finish(true); } };
    current = src; src.start(); meter(true);
  } catch(e) {
    if (my === seq) { if (!('speechSynthesis' in window)) finish(false); fallback(spoken); }
  } finally {
    J.$$('.reactor.thinking').forEach(el => el.classList.remove('thinking'));
  }
}
J.stopSpeaking = stop;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); });
})();
