'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const DATA_DIR = path.resolve(config.root, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Each market gets its own database file (e.g. data/au.sqlite, data/us.sqlite)
// so the same codebase can run as separate sites with isolated data. Override
// with DB_PATH (surfaced as config.site.database).
const DB_PATH = path.resolve(config.root, config.site.database);
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Apply schema (idempotent - all statements use IF NOT EXISTS).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
