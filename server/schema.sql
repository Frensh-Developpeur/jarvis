-- Schéma de la base Jarvis (Cloudflare D1)
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  totp_secret TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  last_step   INTEGER NOT NULL DEFAULT 0,   -- dernier code utilisé (anti-rejeu)
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
