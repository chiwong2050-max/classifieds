-- ---------------------------------------------------------------------------
-- ListNear schema (SQLite / better-sqlite3)
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- Core ad records. Every ad starts as 'pending' and requires human approval.
CREATE TABLE IF NOT EXISTS ads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id     TEXT    NOT NULL UNIQUE,          -- short id used in URLs
  slug          TEXT    NOT NULL,                 -- url-safe title slug
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  country       TEXT    NOT NULL,
  state         TEXT    NOT NULL,
  city          TEXT    NOT NULL,
  city_name     TEXT    NOT NULL,
  price_cents   INTEGER,                          -- NULL when not applicable
  price_type    TEXT    NOT NULL DEFAULT 'fixed', -- fixed | negotiable | free | contact
  -- Set per-insert from the market's currency (USD on the US site, AUD on the
  -- AU site); there is no hardcoded default so ads always match their market.
  currency      TEXT    NOT NULL,
  attrs         TEXT NOT NULL DEFAULT '{}',       -- category-specific JSON
  contact_name  TEXT    NOT NULL,
  contact_email TEXT    NOT NULL,                 -- never rendered publicly
  status        TEXT    NOT NULL DEFAULT 'pending', -- pending | active | rejected | expired
  is_flagged    INTEGER NOT NULL DEFAULT 0,       -- 1 when keyword filter matched
  flag_reasons  TEXT    NOT NULL DEFAULT '[]',    -- JSON array of matched rules
  reject_reason TEXT,
  manage_token  TEXT    NOT NULL UNIQUE,          -- renew / manage links
  ip_hash       TEXT,
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  published_at  TEXT,
  expires_at    TEXT,
  renewed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ads_status        ON ads(status);
CREATE INDEX IF NOT EXISTS idx_ads_category      ON ads(category);
CREATE INDEX IF NOT EXISTS idx_ads_location      ON ads(country, state, city);
CREATE INDEX IF NOT EXISTS idx_ads_expires_at    ON ads(expires_at);
CREATE INDEX IF NOT EXISTS idx_ads_published_at  ON ads(published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_category_slug
  ON ads(country, state, city, category, slug);

-- Images attached to an ad (stored on disk as WebP, referenced by filename).
CREATE TABLE IF NOT EXISTS ad_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id      INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  filename   TEXT    NOT NULL,
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_images_ad ON ad_images(ad_id, position);

-- One-time tokens for email-verified posting (magic links).
CREATE TABLE IF NOT EXISTS verification_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL,
  payload    TEXT    NOT NULL,        -- JSON of the pending submission
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_vt_token ON verification_tokens(token);

-- Reports submitted by visitors about a specific ad.
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id      INTEGER REFERENCES ads(id) ON DELETE SET NULL,
  public_id  TEXT,
  reason     TEXT    NOT NULL,
  message    TEXT,
  ip_hash    TEXT,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_ad ON reports(ad_id);

-- Contact relay messages (poster email is never exposed; we relay by email).
CREATE TABLE IF NOT EXISTS contact_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id       INTEGER REFERENCES ads(id) ON DELETE SET NULL,
  from_name   TEXT NOT NULL,
  from_email  TEXT NOT NULL,
  body        TEXT NOT NULL,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Garbage-collect expired tokens occasionally (handled in app code too).
-- ---------------------------------------------------------------------------
-- Full-text search (FTS5) over the ads table.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS ads_fts USING fts5(
  title,
  description,
  city_name,
  category,
  content='ads',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Keep FTS index in sync with the ads table.
CREATE TRIGGER IF NOT EXISTS ads_ai AFTER INSERT ON ads BEGIN
  INSERT INTO ads_fts(rowid, title, description, city_name, category)
  VALUES (new.id, new.title, new.description, new.city_name, new.category);
END;

CREATE TRIGGER IF NOT EXISTS ads_ad AFTER DELETE ON ads BEGIN
  INSERT INTO ads_fts(ads_fts, rowid, title, description, city_name, category)
  VALUES ('delete', old.id, old.title, old.description, old.city_name, old.category);
END;

CREATE TRIGGER IF NOT EXISTS ads_au AFTER UPDATE ON ads BEGIN
  INSERT INTO ads_fts(ads_fts, rowid, title, description, city_name, category)
  VALUES ('delete', old.id, old.title, old.description, old.city_name, old.category);
  INSERT INTO ads_fts(rowid, title, description, city_name, category)
  VALUES (new.id, new.title, new.description, new.city_name, new.category);
END;
