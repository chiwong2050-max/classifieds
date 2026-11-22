'use strict';

/** Delete the SQLite database file (and WAL/SHM) to start fresh. */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const DATA_DIR = path.resolve(config.root, 'data');
const base = process.env.DB_PATH || path.join(DATA_DIR, 'classifieds.sqlite');

const targets = [base, `${base}-wal`, `${base}-shm`, `${base}-journal`];
let removed = 0;
for (const file of targets) {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    removed += 1;
    console.log(`Removed ${path.basename(file)}`);
  }
}
console.log(removed ? 'Database reset. Run `npm start` or `npm run seed` to recreate it.' : 'No database file found.');
