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
  daniel: 'onwK4e9ZLuTAKqWW03F9',   // britannique, posé, autoritaire
  george: 'JBFqnCBsd6RMkjVDRZzb',   // britannique, chaleureux, mature
};
const EL_MODEL = 'eleven_turbo_v2_5';   // 0,5 s au lieu de 1,5 à 2,5 s (multilingual v2), et un demi-crédit par caractère
const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';   // mesuré : 1,5 à 4 s (Llama 4 Scout : 5 à 13 s)
const CHAT_SYSTEM = (name, now, calendar) => `Tu es J.A.R.V.I.S., l'intelligence artificielle personnelle de ${name}, comme celle de Tony Stark dans Iron Man : calme, précise, élégante, d'un humour britannique discret et pince-sans-rire. Jamais servile, jamais familière, jamais d'enthousiasme forcé.
Nous sommes le ${now}. Correspondances de dates : ${calendar}
Tu réponds UNIQUEMENT avec un objet JSON : {"reply": "...", "actions": [...]}.
RÈGLES :
- reply : en français, vouvoiement, 1 ou 2 phrases courtes (3 au maximum pour une vraie question). Ta réponse est souvent lue à voix haute : écris comme on parle, naturellement. Pas d'emoji, pas de liste, pas de markdown, pas d'abréviation (« 18 h 30 », « kilocalories », « kilos »).
- Après une action, confirme sobrement sans répéter toute la demande (« C'est noté, ${name}. », « Fait. Le garage, demain à 18 h. »). Appelle l'utilisateur « ${name} » de temps en temps, pas à chaque phrase.
- Ne donne pas de conseils ni de rappels que l'utilisateur n'a pas demandés. Une petite remarque d'esprit est bienvenue de temps en temps, jamais lourde.
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
Utilisateur : « rappelle-moi d'appeler maman » → {"reply":"Entendu. Pour quand ?","actions":[]}
Utilisateur : « j'ai dépensé 30 balles » → {"reply":"Pour quoi, Monsieur ?","actions":[]}
Utilisateur : « essence » → {"reply":"C'est noté.","actions":[{"type":"add_expense","amount":30,"label":"Essence","category":"Transport"}]}
TYPES D'ACTIONS :
{"type":"add_expense","amount":12.5,"label":"Resto midi","category":"Courses|Restaurants|Transport|Loisirs|Shopping|Santé|Abonnements|Factures|Logement|Épargne|Crédit|Autre","date":"AAAA-MM-JJ (facultatif)"}
{"type":"add_income","amount":100,"label":"...","category":"Salaire|Prime|Remboursement|Vente|Cadeau|Autre","date":"facultatif"}
{"type":"add_task","title":"...","due":"AAAA-MM-JJ ou null","time":"HH:MM ou null","priority":0}  (priority 0 à 3)
{"type":"complete_task","title":"mots de la tâche"}
{"type":"log_food","food":"nom de l'aliment (avec la marque si citée)","grams":150,"portions":null,"meal":"pdj|dej|col|din"}
{"type":"log_weight","kg":78.4}
{"type":"log_habit","name":"nom de l'habitude","amount":1}
{"type":"add_note","title":"...","text":"..."}
{"type":"open","module":"finances|nutrition|muscu|taches|habitudes|sante|notes"}  (si l'utilisateur veut voir un écran)
{"type":"briefing"}  (s'il demande le briefing, le point de la journée ou « quoi de neuf »)`;
/* Diction « Jarvis » : posée, régulière, pince-sans-rire (stabilité haute, peu d'emphase, débit un peu lent).
   Changer ces réglages → changer aussi le préfixe 'el3' du cache pour régénérer les phrases. */
const EL_BUDGET = 9500;   // crédits par mois (offre gratuite : 10 000) — au-delà, voix Cloudflare
const elCost = text => Math.ceil(text.length / 2);   // modèles Turbo / Flash : un demi-crédit par caractère
const month = () => new Date().toISOString().slice(0, 7);
const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.85, style: 0.05, use_speaker_boost: true, speed: 0.98 };

const now = () => Math.floor(Date.now() / 1000);

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
    const voiceId = VOICES[voice] || VOICES.george;
    const useEleven = !!env.ELEVENLABS_API_KEY;
    const hash = await sha256((useEleven ? 'el3:' + voiceId + ':' + EL_MODEL : 'melo') + ':' + clean);
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
    const history = (Array.isArray(messages) ? messages : []).slice(-10)
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
    if (!history.length || history[history.length - 1].role !== 'user') fail(400, 'Message manquant');
    const system = CHAT_SYSTEM(String(name || 'Monsieur').slice(0, 30), String(clientNow || '').slice(0, 80), String(calendar || '').slice(0, 600)) +
      '\n\nCONTEXTE ACTUEL DE L\'UTILISATEUR (données réelles de ses modules) :\n' + String(context || '').slice(0, 7000);
    const stream = new URL(req.url).searchParams.has('stream');
    let out;
    try {
      out = await env.AI.run(CHAT_MODEL, { messages: [{ role: 'system', content: system }, ...history], max_tokens: 600, temperature: 0.3, stream,
        response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { reply: { type: 'string' }, actions: { type: 'array', items: { type: 'object' } } }, required: ['reply', 'actions'] } } });
    } catch (e) {
      console.log('chat IA', e.message);
      fail(503, /quota|limit|neuron/i.test(e.message) ? 'Quota quotidien de l\'IA atteint, réessayez demain.' : 'IA momentanément indisponible');
    }
    // streaming : on renvoie le JSON au fil de l'eau, en texte brut (le client affiche la réponse mot à mot)
    if (stream) return new Response(out.pipeThrough(sseToText()), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    let r = out && (out.response ?? out);
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = { reply: r, actions: [] }; } }
    const actions = Array.isArray(r.actions) ? r.actions.filter(a => a && typeof a.type === 'string').slice(0, 8) : [];
    return { reply: String(r.reply || '').slice(0, 1500), actions };
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
