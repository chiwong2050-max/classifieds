'use strict';

/**
 * Per-market database access.
 *
 * Every market has its own SQLite file (`data/us.sqlite`, `data/au.sqlite`, …).
 * Because one process now serves all markets, this module keeps a pool of
 * connections keyed by resolved file path and returns the right one for the
 * active request (resolved from the AsyncLocalStorage market context).
 *
 * `require('./db')` yields a Proxy that forwards to the active connection, so
 * existing `db.prepare(...)` call sites keep working unchanged. Outside a
 * request (startup, CLI, maintenance) the default market's connection is used.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const context = require('../config/context');

const DATA_DIR = path.resolve(config.root, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// Cache of open connections, keyed by absolute file path. Each entry keeps the
// market descriptor it was opened for so maintenance can iterate every market.
const pool = new Map();

/** Absolute database path for a market descriptor. */
function dbPathFor(site) {
  return path.resolve(config.root, (site && site.database) || config.defaultSite.database);
}

/** Open (or reuse) the connection for a market's database file. */
function connectionFor(site) {
  const s = site || config.defaultSite;
  const file = dbPathFor(s);
  const existing = pool.get(file);
  if (existing) return existing.conn;

  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  // Idempotent schema (all statements use IF NOT EXISTS).
  conn.exec(SCHEMA);
  pool.set(file, { conn, site: s });
  return conn;
}

/** The connection for the active request (or the default market). */
function activeConnection() {
  const ctx = context.current();
  if (ctx && ctx.site) return connectionFor(ctx.site);
  return connectionFor(config.defaultSite);
}

/** Market descriptors for every database opened so far (for maintenance). */
function openSites() {
  return [...pool.values()].map((entry) => entry.site);
}

// Eagerly open the default market so startup failures surface immediately.
const defaultDb = connectionFor(config.defaultSite);

// Helpers that are not per-request, kept on the proxy target so the `get` trap
// can return them untouched instead of looking them up on a connection.
const target = {};
Object.defineProperties(target, {
  defaultDb: { value: defaultDb, enumerable: false },
  connectionFor: { value: connectionFor, enumerable: false },
  activeConnection: { value: activeConnection, enumerable: false },
  dbPathFor: { value: dbPathFor, enumerable: false },
  openSites: { value: openSites, enumerable: false },
});

const dbProxy = new Proxy(target, {
  get(t, prop) {
    if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
    const conn = activeConnection();
    const value = conn[prop];
    return typeof value === 'function' ? value.bind(conn) : value;
  },
  has(t, prop) {
    if (Object.prototype.hasOwnProperty.call(t, prop)) return true;
    return prop in activeConnection();
  },
});

module.exports = dbProxy;
