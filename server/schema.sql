-- Schéma de la base Jarvis (Cloudflare D1)
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  totp_secret TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  last_step   INTEGER NOT NULL DEFAULT 0,   -- dernier code utilisé (anti-rejeu)
  ingest_hash TEXT,                          -- jeton du raccourci iPhone (Santé, Agenda, Rappels)
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,               -- on ne stocke jamais le jeton en clair
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invites (
  code        TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL,
  reset_user  TEXT,                          -- si renseigné : invitation de réinitialisation d'un compte existant
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_by     TEXT,
  used_at     INTEGER
);

-- Inscriptions en attente de confirmation par un premier code
CREATE TABLE IF NOT EXISTS pending (
  username    TEXT PRIMARY KEY COLLATE NOCASE,
  totp_secret TEXT NOT NULL,
  invite      TEXT,
  expires_at  INTEGER NOT NULL
);

-- Données des modules : un document JSON par utilisateur et par module
CREATE TABLE IF NOT EXISTS data (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module     TEXT NOT NULL,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, module)
);

-- Limitation des tentatives de connexion
CREATE TABLE IF NOT EXISTS attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Cache des phrases déjà générées (évite de consommer le quota de synthèse deux fois)
CREATE TABLE IF NOT EXISTS tts_cache (
  hash       TEXT PRIMARY KEY,
  engine     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  audio      BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_ingest ON users(ingest_hash);

-- Caractères de synthèse ElevenLabs consommés par mois (quota partagé par tous les comptes)
CREATE TABLE IF NOT EXISTS usage (
  month TEXT PRIMARY KEY,
  chars INTEGER NOT NULL DEFAULT 0
);

-- Erreurs remontées par l'app (diagnostic), 200 dernières par utilisateur
CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  at      INTEGER NOT NULL,
  msg     TEXT NOT NULL
);

-- Notifications push : abonnements des appareils et notifications programmées
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS notifs (
  user_id TEXT NOT NULL,
  nid     TEXT NOT NULL,
  at      INTEGER NOT NULL,
  title   TEXT NOT NULL,
  body    TEXT,
  url     TEXT,
  sent    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, nid)
);
CREATE INDEX IF NOT EXISTS notifs_due ON notifs(sent, at);
