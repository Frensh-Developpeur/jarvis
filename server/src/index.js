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

const now = () => Math.floor(Date.now() / 1000);

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

  /* Synthèse vocale : renvoie un fichier WAV (mis en cache pour ne pas consommer le quota deux fois) */
  'POST /api/tts': async (req, env, params, ctx) => {
    const u = await auth(req, env);
    const { text } = await body(req);
    const clean = String(text || '').trim().slice(0, 600);
    if (!clean) fail(400, 'Texte vide');
    const cacheKey = new Request('https://tts.jarvis/' + await sha256('melotts-fr:' + clean));
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    const key = 'tts:' + u.id;
    await throttle(env, key, 120, 3600);
    await recordFailure(env, key, 3600);           // compte chaque génération (120 par heure max)
    const out = await env.AI.run('@cf/myshell-ai/melotts', { prompt: clean, lang: 'fr' });
    const bin = Uint8Array.from(atob(out.audio), c => c.charCodeAt(0));
    const res = new Response(bin, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=2592000' } });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
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
    const t = now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM pending WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM attempts WHERE window_start < ?').bind(t - 86400),
    ]);
  },
};
