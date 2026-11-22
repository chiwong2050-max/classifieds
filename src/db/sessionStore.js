'use strict';

const session = require('express-session');
const db = require('./index');

/**
 * SQLite-backed session store (better-sqlite3).
 *
 * Replaces the default in-memory store so logins survive restarts. Sessions
 * live in the market's existing database (data/<market>.sqlite) in a dedicated
 * `sessions` table - no extra file and no extra dependency. Expired rows are
 * skipped on read and pruned periodically by the server's maintenance task.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT    NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);

/** Absolute expiry (ms) for an express-session session object. */
function expiryOf(sess) {
  const cookie = (sess && sess.cookie) || {};
  if (cookie.expires) return new Date(cookie.expires).getTime();
  if (typeof cookie.originalMaxAge === 'number') return Date.now() + cookie.originalMaxAge;
  return Date.now() + 1000 * 60 * 60 * 24; // fallback: 1 day
}

class SqliteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expire <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      db.prepare(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
      ).run(sid, JSON.stringify(sess), expiryOf(sess));
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expiryOf(sess), sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  length(callback) {
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expire > ?').get(Date.now());
      return callback(null, row.n);
    } catch (err) {
      return callback(err);
    }
  }

  clear(callback) {
    try {
      db.prepare('DELETE FROM sessions').run();
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  all(callback) {
    try {
      const rows = db.prepare('SELECT sess FROM sessions WHERE expire > ?').all(Date.now());
      const out = rows
        .map((row) => {
          try {
            return JSON.parse(row.sess);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return callback(null, out);
    } catch (err) {
      return callback(err);
    }
  }

  /** Delete expired sessions; returns how many rows were removed. */
  static pruneExpired() {
    return db.prepare('DELETE FROM sessions WHERE expire <= ?').run(Date.now()).changes;
  }
}

module.exports = SqliteSessionStore;
