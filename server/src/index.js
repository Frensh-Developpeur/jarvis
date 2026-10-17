/* ============================================================
   J.A.R.V.I.S. — API (Cloudflare Worker + D1)
   Comptes par authenticator (TOTP), inscription sur invitation,
   stockage d'un document JSON par module et par utilisateur.
   ============================================================ */

const SESSION_DAYS = 90;
const INVITE_DAYS = 7;
const MAX_DOC_BYTES = 1_000_000;
const MODULE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

/* Voix ElevenLabs proposées (voix par défaut de la bibliothèque, utilisables avec le compte gratuit) */
const VOICES = {
  // voix françaises natives de la bibliothèque ElevenLabs (ajoutées au compte)
  franck: 'qNJqclOgbiButMcyYv6d',   // grave, calme, narrateur
  textorien: 'y7iM4o9Bpg1N3xVTeCg3', // parisien, posé, « classe »
  lucas: 'odOFTFZU3DvAZ3EV3KHi',    // formel, assuré
  daniel: 'onwK4e9ZLuTAKqWW03F9',   // britannique, posé, autoritaire
  george: 'JBFqnCBsd6RMkjVDRZzb',   // britannique, chaleureux, mature
};
const EL_MODEL = 'eleven_multilingual_v2';   // le plus naturel en français (1 crédit par caractère ; Turbo : plus rapide mais plus plat)
const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';   // mesuré : 1,5 à 4 s (Llama 4 Scout : 5 à 13 s)
const CHAT_SYSTEM = (name, now, calendar) => `Tu es J.A.R.V.I.S., l'intelligence artificielle personnelle de ${name}, comme celle de Tony Stark dans Iron Man : calme, précise, élégante, d'un humour britannique discret et pince-sans-rire. Jamais servile, jamais familière, jamais d'enthousiasme forcé.
Nous sommes le ${now}. Correspondances de dates : ${calendar}
Tu réponds UNIQUEMENT avec un objet JSON : {"reply": "...", "actions": [...]}.
RÈGLES :
- reply : en français, vouvoiement, 1 ou 2 phrases courtes (3 au maximum pour une vraie question). Ta réponse est souvent lue à voix haute : écris comme on parle, naturellement. Pas d'emoji, pas de liste, pas de markdown, pas d'abréviation (« 18 h 30 », « kilocalories », « kilos »).
- Après une action, confirme sobrement sans répéter toute la demande (« C'est noté, ${name}. », « Fait. Le garage, demain à 18 h. »). Appelle l'utilisateur « ${name} » de temps en temps, pas à chaque phrase.
- Ne donne pas de conseils non demandés, SAUF une observation vraiment utile tirée des OBSERVATIONS DE JARVIS quand elle touche au sujet (une seule, en une phrase). Une petite remarque d'esprit est bienvenue de temps en temps, jamais lourde.
- Pour une suggestion (repas, séance, organisation), appuie-toi sur les chiffres du CONTEXTE (calories et protéines restantes, séance conseillée, tâches) et sur la MÉMOIRE, et justifie en quelques mots (« 650 kcal et 45 g de protéines restants : un pavé de saumon, riz et haricots verts »).
- La MÉMOIRE contient ce que l'utilisateur t'a demandé de retenir : tiens-en compte (allergies, préférences, objectifs, proches…) sans la réciter.
- Pour chaque demande d'action de l'utilisateur, ajoute une entrée dans actions (plusieurs demandes = plusieurs actions).
- N'invente JAMAIS de chiffres : ne calcule pas de nouveaux soldes ou totaux après une action (l'application affiche les résultats). Pour une question, réponds uniquement à partir du CONTEXTE ; si l'information n'y est pas, dis-le simplement.
- Montants en euros sous forme de nombre (12.5). Dates au format AAAA-MM-JJ, heures HH:MM.
- INFORMATION MANQUANTE : si une donnée obligatoire manque (montant ou objet d'une dépense ou d'un revenu, titre d'une tâche, poids ; pour un aliment, voir plus bas), ne crée PAS l'action et ne dis pas que c'est fait : pose une question courte dans reply. Quand l'utilisateur répond, crée l'action complète en t'appuyant sur l'historique de la conversation.
- Pour un aliment, si l'utilisateur parle de doses, portions, scoops ou « une barre », mets "portions" (nombre) au lieu de "grams".
- VA AU BOUT DE LA RÉFLEXION, comme un vrai majordome : avant d'agir, demande-toi ce qui changerait vraiment le résultat et que tu ne sais pas. Exemples :
  · « rappelle-moi… » sans heure ou sans jour : demande quand ;
  · une dépense dont le montant ou l'objet n'est pas clair : demande.
  Regroupe tout ce qui manque en UNE seule question courte. Ne demande pas ce qui ne change rien (repas déduit de l'heure ou de « ce soir », catégorie évidente, marque).
- Aliments : ne pose JAMAIS toi-même la question « cru ou cuit » et ne devine jamais l'état. Crée log_food en recopiant les mots de l'utilisateur dans "food" (« riz », « pâtes crues », « poulet grillé »), même si la quantité manque (grams null) : l'application vérifie et pose elle-même les questions (état, quantité).
- Ne demande JAMAIS la date (aujourd'hui par défaut), ni le repas (déduit de l'heure ou des mots « midi », « ce soir »…), ni la catégorie d'une dépense (déduis-la de l'objet). « balles » = euros.
- Quand l'utilisateur répond à ta question, crée l'action COMPLÈTE avec toutes les informations de la conversation (aliment + état + quantité + repas).
- Ce qui est marqué [déjà fait : …] dans l'historique est enregistré : ne le recrée JAMAIS. N'ajoute que ce qui est demandé dans le dernier message (ou la réponse à ta dernière question).
- Si l'utilisateur précise lui-même un détail, crois-le et agis : ne remets jamais en question une précision donnée.
EXEMPLES :
Utilisateur : « ajoute 200 g de riz pour ce soir » → {"reply":"C'est noté.","actions":[{"type":"log_food","food":"riz","grams":200,"portions":null,"meal":"din"}]}
(l'application a demandé « cru ou cuit ? ») Utilisateur : « cuit » → {"reply":"C'est noté.","actions":[{"type":"log_food","food":"riz cuit","grams":200,"portions":null,"meal":"din"}]}
Utilisateur : « 150 g de pâtes crues ce midi » → {"reply":"C'est noté.","actions":[{"type":"log_food","food":"pâtes crues","grams":150,"portions":null,"meal":"dej"}]}
Utilisateur : « retiens que je suis allergique aux arachides » → {"reply":"C'est noté, je m'en souviendrai.","actions":[{"type":"remember","fact":"Allergique aux arachides"}]}
Utilisateur : « mets un minuteur de 12 minutes pour les pâtes » → {"reply":"Minuteur lancé.","actions":[{"type":"timer","minutes":12,"seconds":null,"label":"Pâtes"}]}
Utilisateur : « rappelle-moi d'appeler maman » → {"reply":"Entendu. Pour quand ?","actions":[]}
Utilisateur : « j'ai dépensé 30 balles » → {"reply":"Pour quoi, ${name} ?","actions":[]}
Utilisateur : « essence » → {"reply":"C'est noté.","actions":[{"type":"add_expense","amount":30,"label":"Essence","category":"Transport"}]}
TYPES D'ACTIONS :
{"type":"add_expense","amount":12.5,"label":"Resto midi","category":"Courses|Restaurants|Transport|Loisirs|Shopping|Santé|Abonnements|Factures|Logement|Épargne|Crédit|Autre","date":"AAAA-MM-JJ (facultatif)"}
{"type":"add_income","amount":100,"label":"...","category":"Salaire|Prime|Remboursement|Vente|Cadeau|Autre","date":"facultatif"}
{"type":"add_task","title":"...","due":"AAAA-MM-JJ ou null","time":"HH:MM ou null","priority":0,"lead":null}  (priority 0 à 3 ; lead = minutes de rappel avant l'heure si l'utilisateur le précise, ex. « 10 min avant » → 10, « la veille » → 1440, « pas de rappel » → -1, sinon null)
{"type":"complete_task","title":"mots de la tâche"}
{"type":"log_food","food":"nom de l'aliment (avec la marque si citée)","grams":150,"portions":null,"meal":"pdj|dej|col|din"}
{"type":"log_weight","kg":78.4}
{"type":"log_habit","name":"nom de l'habitude","amount":1}
{"type":"add_note","title":"...","text":"..."}
{"type":"open","module":"finances|nutrition|muscu|taches|habitudes|sante|notes"}  (si l'utilisateur veut voir un écran)
{"type":"briefing"}  (s'il demande le briefing, le point de la journée ou « quoi de neuf »)
{"type":"remember","fact":"le fait à retenir, reformulé à la 3e personne"}  (« retiens que… », « n'oublie pas que je… », une préférence durable)
{"type":"forget","fact":"mots du fait à oublier"}
{"type":"timer","minutes":12,"seconds":null,"label":"Pâtes"}  (minuteur, compte à rebours)
{"type":"undo"}  (« annule », « non, enlève ce que tu viens d'ajouter »)
{"type":"reschedule_overdue","per_day":3}  (« replanifie / répartis mes tâches en retard »)`;
/* Diction « Jarvis » : posée, régulière, pince-sans-rire (stabilité haute, peu d'emphase, débit un peu lent).
   Changer ces réglages → changer aussi le préfixe 'el3' du cache pour régénérer les phrases. */
const EL_BUDGET = 9500;   // crédits par mois (offre gratuite : 10 000) — au-delà, voix Cloudflare
const elCost = text => /turbo|flash/.test(EL_MODEL) ? Math.ceil(text.length / 2) : text.length;   // Turbo / Flash : un demi-crédit par caractère
const month = () => new Date().toISOString().slice(0, 7);
const VOICE_SETTINGS = { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1 };

const now = () => Math.floor(Date.now() / 1000);

/* ---------- IA du chat : Cloudflare d'abord, puis fournisseurs de secours quand le quota gratuit est épuisé ----------
   Secrets facultatifs : GROQ_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY (essayés dans cet ordre). Mêmes consignes, même format JSON. */
const CHAT_SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, actions: { type: 'array', items: { type: 'object' } } }, required: ['reply', 'actions'] };
const FALLBACKS = [
  // Groq : gratuit sans carte, même modèle Llama 3.3 70B que Cloudflare (mêmes réponses), très rapide
  // limites gratuites PAR MODÈLE (1 000 messages / jour, 8 000 jetons / minute) : on passe au suivant quand l'un sature
  { name: 'groq', key: 'GROQ_API_KEY', url: env => env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions', model: env => env.GROQ_MODEL || ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'] },
  // Gemini (Google AI Studio) : offre gratuite Flash, point d'accès compatible OpenAI
  { name: 'gemini', key: 'GEMINI_API_KEY', url: env => env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: env => env.GEMINI_MODEL || ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'] },
  { name: 'mistral', key: 'MISTRAL_API_KEY', url: env => env.MISTRAL_URL || 'https://api.mistral.ai/v1/chat/completions', model: env => env.MISTRAL_MODEL || 'mistral-medium-latest' },
];
let cfOutUntil = 0;   // quota Cloudflare épuisé : on ne le retente qu'après minuit UTC (remise à zéro du quota)
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const parseChat = t => { if (t && typeof t === 'object') return t; try { return JSON.parse(t); } catch { const m = String(t || '').match(/\{[\s\S]*\}/); try { return JSON.parse(m[0]); } catch { return { reply: String(t || ''), actions: [] }; } } };
async function runChat(env, messages, stream) {
  const errors = [];
  if (Date.now() > cfOutUntil) {
    try {
      const out = await env.AI.run(CHAT_MODEL, { messages, max_tokens: 600, temperature: 0.3, stream, response_format: { type: 'json_schema', json_schema: CHAT_SCHEMA } });
      return { out: stream ? out : parseChat(out.response ?? out), provider: 'cloudflare' };
    } catch (e) {
      console.log('chat cloudflare', e.message); errors.push(e.message);
      if (/quota|limit|neuron|allocation|4006/i.test(e.message)) cfOutUntil = nextUtcMidnight();
    }
  }
  for (const p of FALLBACKS) {
    if (!env[p.key]) continue;
    for (const model of [].concat(p.model(env))) {
      try {
        // un fournisseur saturé peut ne jamais répondre : sans réponse en 9 s, on passe au suivant
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
        const r = await fetch(p.url(env), {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: 'Bearer ' + env[p.key], 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ model, messages, max_tokens: 700, temperature: 0.3, stream, response_format: { type: 'json_object' } },
            /gpt-oss|gemini/.test(model) ? { reasoning_effort: 'low' } : /qwen3/.test(model) ? { reasoning_effort: 'none' } : {})),   // réflexion courte : réponse rapide
        });
        clearTimeout(timer);   // en-têtes reçus : le flux peut ensuite durer le temps qu'il faut
        if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
        if (stream) return { out: r.body, provider: p.name + ':' + model };
        const j = await r.json(), c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!c) throw new Error('réponse vide');
        return { out: parseChat(c), provider: p.name + ':' + model };
      } catch (e) { console.log('chat ' + p.name + ' ' + model, e.message.slice(0, 160)); errors.push(p.name + ' : ' + e.message); }
    }
  }
  fail(503, errors.some(m => /quota|limit|neuron|allocation|4006|429/i.test(m)) ? 'Quota quotidien de l\'IA atteint, réessayez demain.' : 'IA momentanément indisponible');
}

/* ---------- voix Gemini : PCM 24 kHz renvoyé par Google, emballé en WAV ---------- */
const GEMINI_STYLE = "Voix française de doublage de film, timbre médium-grave, articulation très nette, phrasé fluide et distingué, ton d'assistant IA courtois et légèrement ironique, rythme assez vif, sans emphase";
async function geminiSpeech(env, text) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent', {
    method: 'POST', signal: ctl.signal,
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: GEMINI_STYLE + ' : ' + text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } } }),
  });
  clearTimeout(timer);
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json(), b64 = j && j.candidates && j.candidates[0] && j.candidates[0].content.parts.find(p => p.inlineData);
  if (!b64) throw new Error('réponse sans audio');
  const pcm = Uint8Array.from(atob(b64.inlineData.data), c => c.charCodeAt(0));
  const wav = new Uint8Array(44 + pcm.length), v = new DataView(wav.buffer), str = (o, t) => [...t].forEach((c, i) => wav[o + i] = c.charCodeAt(0));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

/* flux SSE de Workers AI → texte brut (seulement les morceaux de réponse) */
function sseToText() {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  const piece = line => {
    if (!line.startsWith('data:')) return '';
    const d = line.slice(5).trim(); if (!d || d === '[DONE]') return '';
    try { const j = JSON.parse(d); return (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) ?? j.response ?? ''; } catch { return ''; }
  };
  return new TransformStream({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      const t = lines.map(piece).join(''); if (t) ctrl.enqueue(enc.encode(t));
    },
    flush(ctrl) { const t = piece(buf); if (t) ctrl.enqueue(enc.encode(t)); },
  });
}

/* ---------- utilitaires HTTP ---------- */
function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
async function body(req) {
  try { return await req.json(); } catch { fail(400, 'JSON invalide'); }
}

/* ---------- lecture tolérante des valeurs envoyées par Raccourcis ---------- */
function parisDate() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function toNum(v) {
  if (Array.isArray(v)) { const ns = v.map(toNum).filter(n => n !== null); return ns.length ? ns.reduce((a, b) => a + b, 0) : null; }
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const lines = String(v).split(/\n/).map(l => l.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/)).filter(Boolean);
  if (!lines.length) return null;
  return lines.reduce((a, m) => a + parseFloat(m[0]), 0);   // plusieurs lignes = plusieurs échantillons → somme
}
/* sommeil reçu en heures, minutes ou secondes selon le raccourci → toujours en heures */
function sleepHours(n) {
  if (n > 86400) return null;
  if (n > 1440) return Math.round(n / 360) / 10;   // secondes
  if (n > 24) return Math.round(n / 6) / 10;       // minutes
  return Math.round(n * 10) / 10;                  // heures
}
function toLines(v) {
  const arr = Array.isArray(v) ? v.map(String) : String(v || '').split(/\n/);
  return arr.map(s => s.trim()).filter(Boolean).slice(0, 40).map(s => s.slice(0, 160));
}

/* ---------- Open Food Facts ---------- */
async function offFetch(url, ctx) {
  const key = new Request(url);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const r = await fetch(url, { headers: { 'User-Agent': 'Jarvis/1.0 (assistant personnel ; https://frensh-developpeur.github.io/jarvis/)' } });
  if (!r.ok) fail(r.status === 404 ? 404 : 502, r.status === 404 ? 'Produit introuvable' : 'Open Food Facts indisponible');
  const text = await r.text();
  ctx.waitUntil(caches.default.put(key, new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })));
  return JSON.parse(text);
}
function offItem(p) {
  const n = p.nutriments || {};
  const num = v => (v === undefined || v === null || v === '' || isNaN(+v)) ? null : Math.round(+v * 10) / 10;
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null && num(n.energy_100g) !== null) kcal = Math.round(num(n.energy_100g) / 4.184);
  const name = (p.product_name_fr || p.product_name || '').trim();
  if (!name || kcal === null) return null;
  const brand = Array.isArray(p.brands) ? p.brands.join(', ') : (p.brands || '');
  return {
    name, brand: brand.split(',')[0].trim(), code: p.code || null,
    per100: { kcal: Math.round(kcal), p: num(n.proteins_100g) || 0, c: num(n.carbohydrates_100g) || 0, f: num(n.fat_100g) || 0 },
    serving: num(p.serving_quantity), qty: p.quantity || '', img: p.image_front_small_url || null,
  };
}

/* ---------- envoi Web Push (VAPID + chiffrement aes128gcm, RFC 8291 / 8292) ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
let vapidKey = null;
async function vapidJwt(env, aud) {
  if (!vapidKey) vapidKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: now() + 12 * 3600, sub: 'https://frensh-developpeur.github.io/jarvis/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, enc.encode(head + '.' + claims));
  return head + '.' + claims + '.' + b64u(sig);
}
async function sendPush(env, sub, payload) {
  const enc = new TextEncoder();
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(86); header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65; header.set(asPublic, 21);
  const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
  return fetch(sub.endpoint, { method: 'POST', body: concat(header, ct), headers: {
    TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}` } });
}
async function pushUser(env, userId, msg) {
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').bind(userId).all();
  let sent = 0;
  for (const sub of results) {
    try {
      const r = await sendPush(env, sub, JSON.stringify(msg));
      if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();   // abonnement expiré
      else if (r.ok) sent++;
      else console.log('push', r.status, (await r.text()).slice(0, 200));
    } catch (e) { console.log('push erreur', e.message); }
  }
  return sent;
}
/* ---------- notifications des défis entre amis (désactivables : réglage « Défis entre amis ») ---------- */
async function pushSocial(env, userId, payload) {
  const row = await env.DB.prepare("SELECT json FROM data WHERE user_id = ? AND module = 'core'").bind(userId).first();
  try { const p = JSON.parse(row.json); if (p && p.notif && p.notif.social === false) return 0; } catch {}
  console.log('push social', userId.slice(0, 8), payload.title);
  return pushUser(env, userId, Object.assign({ url: '#/social' }, payload));
}
const SOCIAL_METRIC = { sessions: d => d.s || 0, volume: d => (d.v || 0) / 1000, steps: d => d.st || 0 };
const socialTotal = (sum, metric, from, to) => Object.entries((sum && sum.days) || {}).reduce((a, [k, d]) => k >= from && k <= to ? a + SOCIAL_METRIC[metric](d) : a, 0);
const parisDay = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
/* après la mise à jour du résumé d'un utilisateur : séance terminée → ses amis ; dépassement dans un défi → celui qui est dépassé */
async function socialEvents(env, u, oldSum, newSum, share) {
  const others = (await env.DB.prepare('SELECT s.user_id, u.username, s.share, s.summary FROM social s JOIN users u ON u.id = s.user_id WHERE s.user_id != ?').bind(u.id).all()).results;
  // nouvelle séance (terminée il y a moins de 6 h, pas encore annoncée)
  const seen = new Set(((oldSum && oldSum.sessions) || []).map(x => x.id));
  const fresh = share.muscu ? ((newSum && newSum.sessions) || []).filter(x => !seen.has(x.id) && Date.now() - x.start < 6 * 3600e3) : [];
  if (fresh.length && oldSum && oldSum.sessions) for (const o of others) {
    const x = fresh[0];
    await pushSocial(env, o.user_id, { title: `💪 ${u.username} a terminé « ${x.name} »`, body: `${x.dur} min · ${(x.vol / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t soulevées${x.prs ? ` · 🏆 ${x.prs} record${x.prs > 1 ? 's' : ''}` : ''}. Un 🔥 ?`, tag: 'sess-' + x.id });
  }
  // dépassements dans les défis en cours
  const today = parisDay();
  const chal = (await env.DB.prepare('SELECT c.id, c.title, c.metric, c.start, c.end FROM challenges c JOIN challenge_members m ON m.challenge_id = c.id WHERE m.user_id = ? AND c.start <= ? AND c.end >= ?').bind(u.id, today, today).all()).results;
  for (const c of chal) {
    const key = c.metric === 'steps' ? 'steps' : 'muscu'; if (!share[key]) continue;
    const before = socialTotal(oldSum, c.metric, c.start, today), after = socialTotal(newSum, c.metric, c.start, today);
    if (after <= before) continue;
    const members = new Set((await env.DB.prepare('SELECT user_id FROM challenge_members WHERE challenge_id = ?').bind(c.id).all()).results.map(r => r.user_id));
    for (const o of others) {
      if (!members.has(o.user_id) || !JSON.parse(o.share)[key]) continue;
      const theirs = socialTotal(JSON.parse(o.summary), c.metric, c.start, today);
      if (before <= theirs && after > theirs) await pushSocial(env, o.user_id, { title: `⚡ ${u.username} vient de vous dépasser`, body: `Défi « ${c.title} ». À vous de jouer.`, tag: 'over-' + c.id });
    }
  }
}

async function sendDueNotifications(env) {
  const t = Date.now();
  const { results } = await env.DB.prepare('SELECT user_id, nid, title, body, url FROM notifs WHERE sent = 0 AND at <= ? AND at > ? ORDER BY at LIMIT 100').bind(t, t - 3600e3).all();
  for (const n of results) {
    await env.DB.prepare('UPDATE notifs SET sent = 1 WHERE user_id = ? AND nid = ?').bind(n.user_id, n.nid).run();
    await pushUser(env, n.user_id, { title: n.title, body: n.body, url: n.url, tag: n.nid });
  }
  // ménage : notifications de plus de 2 jours
  await env.DB.prepare('DELETE FROM notifs WHERE at < ?').bind(t - 2 * 864e5).run();
}

/* ---------- crypto ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

async function totpAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, step);           // compteur 64 bits (partie haute à 0 jusqu'en 10889)
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/* Renvoie le pas de temps du code s'il est valide (±30 s de tolérance), sinon null */
async function verifyTotp(secret, code, minStep = 0) {
  if (!/^\d{6}$/.test(code || '')) return null;
  const cur = Math.floor(now() / 30);
  for (const s of [cur, cur - 1, cur + 1]) {
    if (s <= minStep) continue;
    if (await totpAt(secret, s) === code) return s;
  }
  return null;
}

/* ---------- limitation des tentatives ---------- */
async function throttle(env, key, max, windowSec) {
  const t = now();
  const row = await env.DB.prepare('SELECT count, window_start FROM attempts WHERE key = ?').bind(key).first();
  if (row && t - row.window_start < windowSec && row.count >= max) {
    fail(429, `Trop de tentatives. Réessayez dans ${Math.ceil((windowSec - (t - row.window_start)) / 60)} min.`);
  }
}
async function recordFailure(env, key, windowSec) {
  const t = now();
  await env.DB.prepare(`INSERT INTO attempts (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`)
    .bind(key, t, t, windowSec, t, windowSec, t).run();
}
const clearFailures = (env, key) => env.DB.prepare('DELETE FROM attempts WHERE key = ?').bind(key).run();

/* ---------- sessions ---------- */
async function createSession(env, userId) {
  const token = base32(randomBytes(32));
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, t, t + SESSION_DAYS * 86400).run();
  return token;
}
async function auth(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (\S+)$/);
  if (!m) fail(401, 'Non connecté');
  const hash = await sha256(m[1]);
  const row = await env.DB.prepare(`SELECT u.id, u.username, u.is_admin, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(hash).first();
  if (!row || row.expires_at < now()) fail(401, 'Session expirée');
  // prolongation glissante : une session utilisée régulièrement n'expire jamais
  if (row.expires_at - now() < (SESSION_DAYS - 7) * 86400) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now() + SESSION_DAYS * 86400, hash).run();
  }
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin, tokenHash: hash };
}
const userOut = u => ({ username: u.username, isAdmin: !!(u.isAdmin ?? u.is_admin) });

/* ---------- routes ---------- */
const routes = {
  /* Y a-t-il déjà un compte ? (le tout premier inscrit devient admin, sans invitation) */
  'GET /api/status': async (req, env) => {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    return { needsSetup: n.n === 0 };
  },

  /* Étape 1 de l'inscription : génère le secret à mettre dans l'authenticator */
  'POST /api/register/start': async (req, env) => {
    const ip = req.headers.get('CF-Connecting-IP') || 'ip';
    await throttle(env, 'reg:' + ip, 10, 3600);
    const { username, invite } = await body(req);
    if (!USERNAME_RE.test(username || '')) fail(400, "Nom d'utilisateur : 3 à 24 caractères (lettres, chiffres, . _ -)");
    const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    let inv = null;
    if (count > 0) {
      inv = await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind((invite || '').trim().toUpperCase()).first();
      if (!inv || inv.used_by || inv.expires_at < now()) {
        await recordFailure(env, 'reg:' + ip, 3600);
        fail(403, "Code d'invitation invalide ou expiré");
      }
      if (inv.reset_user && inv.reset_user.toLowerCase() !== username.toLowerCase()) fail(403, `Cette invitation sert à réinitialiser le compte « ${inv.reset_user} »`);
    }
    if (existing && !(inv && inv.reset_user)) fail(409, "Ce nom d'utilisateur est déjà pris");
    const secret = base32(randomBytes(20));
    await env.DB.prepare(`INSERT INTO pending (username, totp_secret, invite, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET totp_secret = excluded.totp_secret, invite = excluded.invite, expires_at = excluded.expires_at`)
      .bind(username, secret, inv ? inv.code : null, now() + 900).run();
    const issuer = 'Jarvis';
    return {
      secret,
      otpauth: `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    };
  },

  /* Étape 2 : le premier code de l'authenticator confirme et crée le compte */
  'POST /api/register/confirm': async (req, env) => {
    const ip = req.headers.get('CF-Connecting-IP') || 'ip';
    const { username, code } = await body(req);
    const key = 'regc:' + String(username).toLowerCase();
    await throttle(env, key, 8, 900);
    const p = await env.DB.prepare('SELECT * FROM pending WHERE username = ?').bind(username || '').first();
    if (!p || p.expires_at < now()) fail(400, "Inscription expirée, recommencez");
    const step = await verifyTotp(p.totp_secret, code);
    if (step === null) { await recordFailure(env, key, 900); fail(401, 'Code incorrect. Vérifiez l\'heure de votre téléphone.'); }

    const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
    let inv = null;
    if (count > 0) {
      inv = p.invite && await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(p.invite).first();
      if (!inv || inv.used_by || inv.expires_at < now()) fail(403, "Code d'invitation invalide ou expiré");
    }
    const t = now();
    let userId;
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(p.username).first();
    if (inv && inv.reset_user && existing) {
      userId = existing.id;
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET totp_secret = ?, last_step = ? WHERE id = ?').bind(p.totp_secret, step, userId),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      ]);
    } else {
      if (existing) fail(409, "Ce nom d'utilisateur est déjà pris");
      userId = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO users (id, username, totp_secret, is_admin, last_step, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, p.username, p.totp_secret, count === 0 ? 1 : 0, step, t).run();
    }
    const stmts = [env.DB.prepare('DELETE FROM pending WHERE username = ?').bind(p.username)];
    if (inv) stmts.push(env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').bind(userId, t, inv.code));
    await env.DB.batch(stmts);
    await clearFailures(env, key);
    const user = await env.DB.prepare('SELECT username, is_admin FROM users WHERE id = ?').bind(userId).first();
    return { token: await createSession(env, userId), user: userOut(user) };
  },

  /* identifiants proposés sur l'écran de connexion (comptes sur invitation, le code de l'authenticator reste obligatoire) */
  'GET /api/login/users': async (req, env) => {
    const ip = req.headers.get('CF-Connecting-IP') || 'ip';
    await throttle(env, 'users:' + ip, 30, 3600);
    await recordFailure(env, 'users:' + ip, 3600);
    const { results } = await env.DB.prepare('SELECT username FROM users ORDER BY created_at LIMIT 20').all();
    return { users: results.map(r => r.username) };
  },

  'POST /api/login': async (req, env) => {
    const ip = req.headers.get('CF-Connecting-IP') || 'ip';
    const { username, code } = await body(req);
    const ukey = 'login:' + String(username).toLowerCase(), ikey = 'loginip:' + ip;
    await throttle(env, ukey, 5, 900);
    await throttle(env, ikey, 20, 900);
    const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username || '').first();
    const step = u ? await verifyTotp(u.totp_secret, code, u.last_step) : null;
    if (step === null) {
      await recordFailure(env, ukey, 900); await recordFailure(env, ikey, 900);
      fail(401, 'Identifiant ou code incorrect');
    }
    await env.DB.prepare('UPDATE users SET last_step = ? WHERE id = ?').bind(step, u.id).run();
    await clearFailures(env, ukey);
    return { token: await createSession(env, u.id), user: userOut(u) };
  },

  'POST /api/logout': async (req, env) => {
    const u = await auth(req, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(u.tokenHash).run();
    return { ok: true };
  },

  'GET /api/me': async (req, env) => userOut(await auth(req, env)),

  /* Données : tous les modules d'un coup */
  'GET /api/data': async (req, env) => {
    const u = await auth(req, env);
    const { results } = await env.DB.prepare('SELECT module, json, updated_at FROM data WHERE user_id = ?').bind(u.id).all();
    const modules = {};
    for (const r of results) modules[r.module] = { data: JSON.parse(r.json), updatedAt: r.updated_at };
    return { modules };
  },

  'PUT /api/data/:module': async (req, env, { module }) => {
    const u = await auth(req, env);
    if (!MODULE_RE.test(module)) fail(400, 'Module invalide');
    const text = await req.text();
    if (text.length > MAX_DOC_BYTES) fail(413, 'Données trop volumineuses');
    let parsed; try { parsed = JSON.parse(text); } catch { fail(400, 'JSON invalide'); }
    const updatedAt = Number(parsed.updatedAt) || Date.now();
    await env.DB.prepare(`INSERT INTO data (user_id, module, json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, module) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
      .bind(u.id, module, JSON.stringify(parsed.data ?? null), updatedAt).run();
    return { ok: true, updatedAt };
  },

  /* Synthèse vocale : ElevenLabs si une clé est configurée, sinon voix Cloudflare.
     Chaque phrase générée est gardée en base pour ne jamais consommer le quota deux fois. */
  'POST /api/tts': async (req, env, params, ctx) => {
    const u = await auth(req, env);
    const { text, voice } = await body(req);
    const clean = String(text || '').trim().slice(0, 600);
    if (!clean) fail(400, 'Texte vide');
    // voix « jarvis » : Google Gemini (voix Charon, ton de doublage dicté), puis ElevenLabs, puis la voix Cloudflare
    if (voice === 'jarvis' && env.GEMINI_API_KEY) {
      const gh = await sha256('gem1:Charon:' + clean);
      const gHit = await env.DB.prepare('SELECT engine, mime, audio FROM tts_cache WHERE hash = ?').bind(gh).first();
      if (gHit) return new Response(new Uint8Array(gHit.audio), { headers: { 'Content-Type': gHit.mime, 'X-Voice-Engine': gHit.engine, 'Access-Control-Expose-Headers': 'X-Voice-Engine' } });
      try {
        const wav = await geminiSpeech(env, clean);
        ctx.waitUntil(env.DB.prepare('INSERT OR REPLACE INTO tts_cache (hash, engine, mime, audio, created_at) VALUES (?, ?, ?, ?, ?)').bind(gh, 'gemini', 'audio/wav', wav, now()).run());
        return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'X-Voice-Engine': 'gemini', 'Access-Control-Expose-Headers': 'X-Voice-Engine' } });
      } catch (e) { console.log('voix gemini', e.message); }   // quota ou panne : on continue avec ElevenLabs
    }
    const voiceId = VOICES[voice] || VOICES.george;
    const useEleven = !!env.ELEVENLABS_API_KEY;
    const hash = await sha256((useEleven ? 'el4:' + voiceId + ':' + EL_MODEL : 'melo') + ':' + clean);
    const send = (audio, engine, mime) => new Response(audio, { headers: { 'Content-Type': mime, 'X-Voice-Engine': engine, 'Access-Control-Expose-Headers': 'X-Voice-Engine' } });

    const hit = await env.DB.prepare('SELECT engine, mime, audio FROM tts_cache WHERE hash = ?').bind(hash).first();
    if (hit) return send(new Uint8Array(hit.audio), hit.engine, hit.mime);

    const key = 'tts:' + u.id;
    await throttle(env, key, 120, 3600);
    await recordFailure(env, key, 3600);           // compte chaque génération (120 par heure max)

    let audio = null, engine = 'melo', mime = 'audio/wav';
    const used = useEleven ? ((await env.DB.prepare('SELECT chars FROM usage WHERE month = ?').bind(month()).first()) || {chars: 0}).chars : 0;
    if (useEleven && used + elCost(clean) <= EL_BUDGET) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: clean, model_id: EL_MODEL, language_code: 'fr',
          voice_settings: VOICE_SETTINGS,
        }),
      });
      if (r.ok) {
        audio = new Uint8Array(await r.arrayBuffer()); engine = 'eleven'; mime = 'audio/mpeg';
        ctx.waitUntil(env.DB.prepare('INSERT INTO usage (month, chars) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET chars = chars + excluded.chars')
          .bind(month(), elCost(clean)).run());
      }
      else console.log('ElevenLabs', r.status, (await r.text()).slice(0, 300));   // quota épuisé, clé invalide… → repli
    }
    if (!audio) {
      const out = await env.AI.run('@cf/myshell-ai/melotts', { prompt: clean, lang: 'fr' });
      audio = Uint8Array.from(atob(out.audio), c => c.charCodeAt(0));
    }
    // on ne garde le repli Cloudflare que si ElevenLabs n'est pas configuré (sinon on retentera ElevenLabs)
    if (engine === 'eleven' || !useEleven) {
      ctx.waitUntil(env.DB.prepare('INSERT OR REPLACE INTO tts_cache (hash, engine, mime, audio, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(hash, engine, mime, audio, now()).run());
    }
    return send(audio, engine, mime);
  },

  'GET /api/tts/usage': async (req, env) => {
    await auth(req, env);
    const row = await env.DB.prepare('SELECT chars FROM usage WHERE month = ?').bind(month()).first();
    return { month: month(), chars: row ? row.chars : 0, budget: EL_BUDGET, premium: !!env.ELEVENLABS_API_KEY };
  },

  /* ---------- connexion iPhone (app Raccourcis) ----------
     Le raccourci n'a pas de session : il utilise un lien secret propre à chaque compte. */
  'POST /api/ingest-token': async (req, env) => {
    const u = await auth(req, env);
    const token = base32(randomBytes(20)).toLowerCase();
    await env.DB.prepare('UPDATE users SET ingest_hash = ? WHERE id = ?').bind(await sha256(token), u.id).run();
    return { url: new URL(req.url).origin + '/api/ingest/' + token };
  },

  'POST /api/ingest/:token': async (req, env, { token }) => {
    const u = await env.DB.prepare('SELECT id FROM users WHERE ingest_hash = ?').bind(await sha256(token.toLowerCase())).first();
    if (!u) fail(404, 'Lien inconnu');
    await throttle(env, 'ingest:' + u.id, 120, 3600);
    await recordFailure(env, 'ingest:' + u.id, 3600);
    const text = await req.text();
    if (text.length > 100_000) fail(413, 'Trop volumineux');
    let p = {};
    try { p = JSON.parse(text || '{}'); } catch { fail(400, 'JSON invalide'); }

    const row = await env.DB.prepare("SELECT json FROM data WHERE user_id = ? AND module = 'apple'").bind(u.id).first();
    const doc = row ? JSON.parse(row.json) : {};
    doc.days = doc.days || {};
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : parisDate();
    const d = doc.days[day] = doc.days[day] || {};
    const fields = { steps: 'steps', pas: 'steps', energy: 'energy', calories: 'energy', distance: 'distance',
      sleep: 'sleep', sommeil: 'sleep', heart: 'heart', bpm: 'heart', exercise: 'exercise', flights: 'flights', weight: 'weight', poids: 'weight' };
    for (const [k, target] of Object.entries(fields)) {
      if (p[k] === undefined || p[k] === '') continue;
      const n = toNum(Array.isArray(p[k]) || target !== 'weight' ? p[k] : String(p[k]).split('\n')[0]);   // poids : on garde la 1re valeur (la plus récente)
      if (n !== null) d[target] = target === 'sleep' ? sleepHours(n) : n;
    }
    // énergie au repos d'hier (journée complète) → rangée sur la veille
    const basalIn = p.basal ?? p.repos;
    if (basalIn !== undefined && basalIn !== '') {
      const n = toNum(basalIn);
      if (n !== null && n > 300) {
        const y = new Date(day + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
        const yk = y.toISOString().slice(0, 10);
        doc.days[yk] = Object.assign(doc.days[yk] || {}, { basal: Math.round(n) });
      }
    }
    d.at = Date.now();
    for (const k of ['agenda', 'events', 'calendrier']) if (p[k] !== undefined) { doc.agenda = { date: day, items: toLines(p[k]), at: Date.now() }; break; }
    for (const k of ['reminders', 'rappels']) if (p[k] !== undefined) { doc.reminders = { date: day, items: toLines(p[k]), at: Date.now() }; break; }
    // on ne garde que 60 jours d'historique
    const keep = Object.keys(doc.days).sort().slice(-60);
    doc.days = Object.fromEntries(keep.map(k => [k, doc.days[k]]));
    doc.syncedAt = Date.now();
    await env.DB.prepare(`INSERT INTO data (user_id, module, json, updated_at) VALUES (?, 'apple', ?, ?)
      ON CONFLICT(user_id, module) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
      .bind(u.id, JSON.stringify(doc), Date.now()).run();
    return { ok: true, date: day, recu: d };
  },

  /* ---------- aliments (Open Food Facts, via le serveur : identification + cache) ---------- */
  'GET /api/food/search': async (req, env, params, ctx) => {
    await auth(req, env);
    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return { items: [] };
    const url = 'https://search.openfoodfacts.org/search?page_size=30&langs=fr&q=' + encodeURIComponent(q) +
      '&fields=code,product_name,product_name_fr,brands,nutriments,serving_quantity,quantity,image_front_small_url';
    const data = await offFetch(url, ctx);
    const items = (data.hits || []).map(offItem).filter(Boolean).slice(0, 20);
    return { items };
  },

  'GET /api/food/code/:code': async (req, env, { code }, ctx) => {
    await auth(req, env);
    if (!/^\d{6,14}$/.test(code)) fail(400, 'Code-barres invalide');
    const data = await offFetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=code,product_name,product_name_fr,brands,nutriments,serving_quantity,quantity,image_front_small_url`, ctx);
    const item = data.product && offItem(Object.assign({ code }, data.product));
    if (!item) fail(404, 'Produit introuvable ou sans valeurs nutritionnelles');
    return { item };
  },

  /* ---------- diagnostic : erreurs JavaScript remontées par l'app ---------- */
  'POST /api/log': async (req, env) => {
    const u = await auth(req, env);
    await throttle(env, 'log:' + u.id, 60, 3600);
    await recordFailure(env, 'log:' + u.id, 3600);
    const { msg } = await body(req);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO logs (user_id, at, msg) VALUES (?, ?, ?)').bind(u.id, Date.now(), String(msg || '').slice(0, 2000)),
      env.DB.prepare('DELETE FROM logs WHERE user_id = ? AND id NOT IN (SELECT id FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 200)').bind(u.id, u.id),
    ]);
    return { ok: true };
  },

  /* ---------- notifications push ---------- */
  'GET /api/push/key': async (req, env) => ({ key: env.VAPID_PUBLIC }),

  'POST /api/push/subscribe': async (req, env) => {
    const u = await auth(req, env);
    const { subscription: sub } = await body(req);
    if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) fail(400, 'Abonnement invalide');
    await env.DB.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .bind(sub.endpoint, u.id, sub.keys.p256dh, sub.keys.auth, now()).run();
    return { ok: true };
  },

  'POST /api/push/unsubscribe': async (req, env) => {
    const u = await auth(req, env);
    const { endpoint } = await body(req);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(endpoint || '', u.id).run();
    return { ok: true };
  },

  /* l'app envoie la liste complète des notifications des 7 prochains jours ; on remplace celles pas encore envoyées */
  'PUT /api/push/schedule': async (req, env) => {
    const u = await auth(req, env);
    const { items } = await body(req);
    const t = Date.now();
    const list = (Array.isArray(items) ? items : []).filter(i => i && i.nid && i.at > t - 60e3 && i.at < t + 8 * 864e5).slice(0, 300);
    const stmts = [env.DB.prepare('DELETE FROM notifs WHERE user_id = ? AND sent = 0').bind(u.id)];
    for (const i of list) {
      stmts.push(env.DB.prepare(`INSERT INTO notifs (user_id, nid, at, title, body, url, sent) VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(user_id, nid) DO UPDATE SET at = excluded.at, title = excluded.title, body = excluded.body, url = excluded.url,
        sent = CASE WHEN notifs.at = excluded.at THEN notifs.sent ELSE 0 END`)
        .bind(u.id, String(i.nid).slice(0, 120), Math.round(i.at), String(i.title || 'Jarvis').slice(0, 120), String(i.body || '').slice(0, 300), String(i.url || '').slice(0, 60)));
    }
    await env.DB.batch(stmts);
    return { ok: true, count: list.length };
  },

  'POST /api/push/test': async (req, env) => {
    const u = await auth(req, env);
    const sent = await pushUser(env, u.id, { title: 'J.A.R.V.I.S.', body: 'Notifications opérationnelles. À votre service.', url: '#/' });
    if (!sent) fail(404, 'Aucun appareil abonné');
    return { ok: true, sent };
  },

  /* ---------- Jarvis qui discute (Workers AI, quota gratuit) ---------- */
  'POST /api/chat': async (req, env) => {
    const u = await auth(req, env);
    await throttle(env, 'chat:' + u.id, 200, 86400);
    await recordFailure(env, 'chat:' + u.id, 86400);
    const { messages, context, name, now: clientNow, calendar } = await body(req);
    const history = (Array.isArray(messages) ? messages : []).slice(-8)
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
    if (!history.length || history[history.length - 1].role !== 'user') fail(400, 'Message manquant');
    const system = CHAT_SYSTEM(String(name || 'Monsieur').slice(0, 30), String(clientNow || '').slice(0, 80), String(calendar || '').slice(0, 600)) +
      '\n\nCONTEXTE ACTUEL DE L\'UTILISATEUR (données réelles de ses modules) :\n' + String(context || '').slice(0, 7000);
    const stream = new URL(req.url).searchParams.has('stream');
    const { out, provider } = await runChat(env, [{ role: 'system', content: system }, ...history], stream);
    // streaming : on renvoie le JSON au fil de l'eau, en texte brut (le client affiche la réponse mot à mot)
    const hdr = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-AI-Provider': provider, 'Access-Control-Expose-Headers': 'X-AI-Provider' };
    if (stream) return new Response(out.pipeThrough(sseToText()), { headers: hdr });
    let r = out;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = { reply: r, actions: [] }; } }
    const actions = Array.isArray(r.actions) ? r.actions.filter(a => a && typeof a.type === 'string').slice(0, 8) : [];
    return { reply: String(r.reply || '').slice(0, 1500), actions };
  },

  /* ---------- photo du repas : l'IA reconnaît les aliments et estime les quantités ----------
     Gemini d'abord (gratuit, bon en vision), Workers AI (Llama 4 Scout, multimodal) en secours. */
  'POST /api/food/photo': async (req, env) => {
    const u = await auth(req, env);
    await throttle(env, 'photo:' + u.id, 40, 86400);
    await recordFailure(env, 'photo:' + u.id, 86400);
    const { image } = await body(req);
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(image || '')) || image.length > 2_500_000) fail(400, 'Image invalide');
    const prompt = `Tu analyses la photo d'un repas pour un journal alimentaire français.
Liste chaque aliment visible, avec une estimation réaliste de son poids en grammes TEL QUE SERVI dans l'assiette (donc cuit s'il est cuisiné).
Utilise des noms simples comme dans la table CIQUAL : « riz blanc cuit », « poulet filet sauté », « pâtes cuites », « haricots verts cuits », « frites », « salade verte », « pain baguette », « sauce tomate », « fromage emmental »…
Indique toujours l'état (cuit, cru, frit, grillé, rôti) pour les féculents, viandes et poissons, et le morceau pour une viande (« poulet cuisse rôtie avec peau », « poulet filet grillé », « bœuf steak haché cuit »). Sépare les composants d'un plat (ex. burger : pain, steak haché cuit, fromage, sauce).
Réponds UNIQUEMENT en JSON : {"items":[{"food":"riz blanc cuit","grams":180}],"title":"nom court du plat","note":"remarque éventuelle"}.
Si la photo ne montre pas de nourriture : {"items":[],"note":"explication"}.`;
    const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }];
    const errors = [];
    const clean = r => {
      const items = (Array.isArray(r && r.items) ? r.items : []).map(x => ({ food: String(x.food || '').slice(0, 60).trim(), grams: Math.round(+x.grams || 0) }))
        .filter(x => x.food && x.grams > 0 && x.grams < 2000).slice(0, 12);
      return { items, title: String((r && r.title) || '').slice(0, 60), note: String((r && r.note) || '').slice(0, 200) };
    };
    if (env.GEMINI_API_KEY) for (const model of ['gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
      try {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: 'Bearer ' + env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.2, response_format: { type: 'json_object' }, reasoning_effort: 'low' }),
        });
        clearTimeout(timer);
        if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 160));
        const j = await r.json();
        return { ...clean(parseChat(j.choices[0].message.content)), provider: 'gemini:' + model };
      } catch (e) { console.log('photo ' + model, e.message.slice(0, 160)); errors.push(e.message); }
    }
    try {
      const out = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', { messages, max_tokens: 800, temperature: 0.2 });
      return { ...clean(parseChat(out.response ?? out)), provider: 'cloudflare' };
    } catch (e) { console.log('photo cloudflare', e.message); errors.push(e.message); }
    fail(503, errors.some(m => /quota|limit|429|neuron/i.test(m)) ? 'Quota d\'analyse photo atteint, réessayez plus tard.' : 'Analyse de la photo indisponible pour le moment.');
  },

  /* ---------- défis entre amis ----------
     Chacun choisit ce qu'il partage ; le résumé est calculé sur son téléphone (jamais les données brutes). */
  'PUT /api/social/me': async (req, env, params, ctx) => {
    const u = await auth(req, env);
    const { share, summary } = await body(req);
    const prev = await env.DB.prepare('SELECT summary FROM social WHERE user_id = ?').bind(u.id).first();
    const sh = { muscu: !!(share && share.muscu), steps: !!(share && share.steps) };
    const sum = JSON.stringify(sh.muscu || sh.steps ? summary || {} : {});
    if (sum.length > 30000) fail(413, 'Résumé trop volumineux');
    await env.DB.prepare('INSERT INTO social (user_id, share, summary, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET share = excluded.share, summary = excluded.summary, updated_at = excluded.updated_at')
      .bind(u.id, JSON.stringify(sh), sum, Date.now()).run();
    if (prev) ctx.waitUntil(socialEvents(env, u, JSON.parse(prev.summary), JSON.parse(sum), sh).catch(e => console.log('social events', e.message)));
    return { ok: true };
  },

  'GET /api/social': async (req, env) => {
    const u = await auth(req, env);
    const [friends, kudos, chal, members] = await Promise.all([
      env.DB.prepare('SELECT u.username, s.share, s.summary, s.updated_at FROM social s JOIN users u ON u.id = s.user_id').all(),
      env.DB.prepare('SELECT u.username AS from_user, k.target, k.item FROM kudos k JOIN users u ON u.id = k.user_id WHERE k.created_at > ?').bind(Date.now() - 60 * 864e5).all(),
      env.DB.prepare('SELECT c.id, c.title, c.metric, c.target, c.start, c.end, u.username AS creator FROM challenges c JOIN users u ON u.id = c.creator WHERE c.end >= ? ORDER BY c.end').bind(new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)).all(),
      env.DB.prepare('SELECT m.challenge_id, u.username FROM challenge_members m JOIN users u ON u.id = m.user_id').all(),
    ]);
    return {
      me: u.username,
      friends: friends.results.map(r => ({ username: r.username, share: JSON.parse(r.share), summary: JSON.parse(r.summary), updatedAt: r.updated_at })),
      kudos: kudos.results.map(k => ({ from: k.from_user, target: k.target, item: k.item })),
      challenges: chal.results.map(c => ({ ...c, members: members.results.filter(m => m.challenge_id === c.id).map(m => m.username) })),
    };
  },

  'POST /api/social/kudos': async (req, env, params, ctx) => {
    const u = await auth(req, env);
    const { target, item } = await body(req);
    if (!target || !item || String(item).length > 40) fail(400, 'Réaction invalide');
    const had = await env.DB.prepare('DELETE FROM kudos WHERE user_id = ? AND target = ? AND item = ?').bind(u.id, String(target), String(item)).run();
    if (!had.meta.changes) {
      await env.DB.prepare('INSERT INTO kudos (user_id, target, item, created_at) VALUES (?, ?, ?, ?)').bind(u.id, String(target), String(item), Date.now()).run();
      ctx.waitUntil((async () => {
        const t = await env.DB.prepare('SELECT u.id, s.summary FROM users u LEFT JOIN social s ON s.user_id = u.id WHERE u.username = ?').bind(String(target)).first();
        if (!t || t.id === u.id) return;
        const sess = (((t.summary && JSON.parse(t.summary)) || {}).sessions || []).find(x => x.id === String(item));
        await pushSocial(env, t.id, { title: `🔥 ${u.username} vous félicite`, body: sess ? `Pour votre séance « ${sess.name} ».` : 'Pour votre séance.', tag: 'kudos-' + item });
      })().catch(e => console.log('kudos push', e.message)));
    }
    return { on: !had.meta.changes };
  },

  'POST /api/challenges': async (req, env, params, ctx) => {
    const u = await auth(req, env);
    const { title, metric, target, start, end } = await body(req);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!String(title || '').trim() || !['sessions', 'volume', 'steps'].includes(metric) || !(+target > 0) || !day.test(start) || !day.test(end) || end < start) fail(400, 'Défi invalide');
    if ((Date.parse(end) - Date.parse(start)) / 864e5 > 92) fail(400, 'Un défi dure 3 mois au maximum');
    const id = base32(randomBytes(8)).toLowerCase(), t = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO challenges (id, creator, title, metric, target, start, end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, u.id, String(title).trim().slice(0, 50), metric, +target, start, end, t),
      env.DB.prepare('INSERT INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?, ?, ?)').bind(id, u.id, t),
    ]);
    ctx.waitUntil((async () => {
      const others = (await env.DB.prepare('SELECT id FROM users WHERE id != ?').bind(u.id).all()).results;
      for (const o of others) await pushSocial(env, o.id, { title: `🏆 ${u.username} lance un défi`, body: `« ${String(title).trim().slice(0, 50)} » : vous le relevez ?`, tag: 'chal-' + id });
    })().catch(e => console.log('challenge push', e.message)));
    return { id };
  },

  'POST /api/challenges/:id/join': async (req, env, { id }, ctx) => {
    const u = await auth(req, env);
    const c = await env.DB.prepare('SELECT id, title, creator FROM challenges WHERE id = ?').bind(id).first();
    if (!c) fail(404, 'Défi introuvable');
    const r = await env.DB.prepare('INSERT OR IGNORE INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?, ?, ?)').bind(id, u.id, Date.now()).run();
    if (r.meta.changes && c.creator !== u.id) ctx.waitUntil(pushSocial(env, c.creator, { title: `🤝 ${u.username} relève votre défi`, body: `« ${c.title} »`, tag: 'join-' + id }).catch(() => {}));
    return { ok: true };
  },

  'POST /api/challenges/:id/leave': async (req, env, { id }) => {
    const u = await auth(req, env);
    await env.DB.prepare('DELETE FROM challenge_members WHERE challenge_id = ? AND user_id = ?').bind(id, u.id).run();
    return { ok: true };
  },

  'DELETE /api/challenges/:id': async (req, env, { id }) => {
    const u = await auth(req, env);
    const c = await env.DB.prepare('SELECT creator FROM challenges WHERE id = ?').bind(id).first();
    if (!c) fail(404, 'Défi introuvable');
    if (c.creator !== u.id && !u.isAdmin) fail(403, 'Seul le créateur peut supprimer ce défi');
    await env.DB.batch([env.DB.prepare('DELETE FROM challenge_members WHERE challenge_id = ?').bind(id), env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(id)]);
    return { ok: true };
  },

  /* ---------- administration ---------- */
  'POST /api/invites': async (req, env) => {
    const u = await auth(req, env);
    if (!u.isAdmin) fail(403, 'Réservé à l\'administrateur');
    const { resetUser } = await body(req).catch(() => ({}));
    if (resetUser) {
      const target = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(resetUser).first();
      if (!target) fail(404, 'Utilisateur inconnu');
    }
    const code = base32(randomBytes(5)).slice(0, 8);
    const t = now();
    await env.DB.prepare('INSERT INTO invites (code, created_by, reset_user, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(code, u.id, resetUser || null, t, t + INVITE_DAYS * 86400).run();
    return { code, resetUser: resetUser || null, expiresAt: (t + INVITE_DAYS * 86400) * 1000 };
  },

  'GET /api/invites': async (req, env) => {
    const u = await auth(req, env);
    if (!u.isAdmin) fail(403, 'Réservé à l\'administrateur');
    const { results } = await env.DB.prepare(`SELECT i.code, i.reset_user, i.expires_at, i.used_at, u.username AS used_by
      FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 30`).all();
    return { invites: results.map(r => ({ code: r.code, resetUser: r.reset_user, expiresAt: r.expires_at * 1000, usedBy: r.used_by, usedAt: r.used_at && r.used_at * 1000 })) };
  },

  'DELETE /api/invites/:code': async (req, env, { code }) => {
    const u = await auth(req, env);
    if (!u.isAdmin) fail(403, 'Réservé à l\'administrateur');
    await env.DB.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').bind(code).run();
    return { ok: true };
  },

  'GET /api/users': async (req, env) => {
    const u = await auth(req, env);
    if (!u.isAdmin) fail(403, 'Réservé à l\'administrateur');
    const { results } = await env.DB.prepare('SELECT username, is_admin, created_at FROM users ORDER BY created_at').all();
    return { users: results.map(r => ({ username: r.username, isAdmin: !!r.is_admin, createdAt: r.created_at * 1000 })) };
  },

  'DELETE /api/users/:username': async (req, env, { username }) => {
    const u = await auth(req, env);
    if (!u.isAdmin) fail(403, 'Réservé à l\'administrateur');
    if (username.toLowerCase() === u.username.toLowerCase()) fail(400, 'Vous ne pouvez pas supprimer votre propre compte');
    await env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
    return { ok: true };
  },
};

function match(method, path) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const hit = path.match(re);
    if (hit) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
  }
  return null;
}

export default {
  async fetch(req, env, ctx) {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    const r = match(req.method, url.pathname);
    try {
      if (!r) fail(404, 'Introuvable');
      const out = await r.handler(req, env, r.params, ctx);
      if (out instanceof Response) {
        const res = new Response(out.body, out);
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
        return res;
      }
      return Response.json(out, { headers });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: status === 500 ? 'Erreur serveur' : e.message }, { status, headers });
    }
  },

  /* ménage quotidien : sessions expirées, inscriptions abandonnées, vieux compteurs */
  async scheduled(event, env) {
    if (event.cron === '* * * * *') return sendDueNotifications(env);   // toutes les minutes : notifications à envoyer
    const t = now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM pending WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM attempts WHERE window_start < ?').bind(t - 86400),
    ]);
  },
};
