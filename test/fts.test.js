'use strict';

/**
 * Regression tests for FTS5 search safety.
 *
 * Before this fix, user input was fed straight into `ads_fts MATCH`, so any
 * FTS5 operator crashed /search with a SqliteError. These tests pin the
 * escaping behaviour and prove the escaped queries run against a real FTS5
 * table without throwing.
 *
 * Run with: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { toFtsPhrase } = require('../src/db/ftsQuery');

// The exact inputs called out in the QA report, plus a few extra operators.
const NASTY = [
  '{search_term_string}',
  '*',
  "' OR 1=1--",
  '<script>alert(1)</script>',
  '"unbalanced quote',
  'AND OR NEAR',
  'title:secret',
  '(){}[]',
  'red OR blue',
  '^start',
];

test('toFtsPhrase never emits raw FTS5 syntax', () => {
  for (const q of NASTY) {
    const phrase = toFtsPhrase(q);
    if (phrase === null) continue;
    assert.equal(phrase[0], '"', `phrase should open with a quote for ${q}`);
    assert.equal(phrase[phrase.length - 1], '"', `phrase should close with a quote for ${q}`);
    // Interior quotes are stripped, so the phrase cannot be escaped.
    assert.equal(phrase.slice(1, -1).includes('"'), false, `stray quote survived for ${q}`);
  }

  // Nothing searchable -> null, so callers fall back to non-FTS filtering.
  assert.equal(toFtsPhrase('*'), null);
  assert.equal(toFtsPhrase('(){}[]'), null);
  assert.equal(toFtsPhrase('   '), null);
  assert.equal(toFtsPhrase(''), null);
  assert.equal(toFtsPhrase(null), null);
});

test('escaped queries run against FTS5 without throwing', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE ads (
        id INTEGER PRIMARY KEY,
        title TEXT, description TEXT, city_name TEXT, category TEXT
      );
      CREATE VIRTUAL TABLE ads_fts USING fts5(
        title, description, city_name, category,
        content='ads', content_rowid='id', tokenize='porter unicode61'
      );
      INSERT INTO ads (id, title, description, city_name, category)
        VALUES (1, 'Red bike for sale', 'A lovely road bike', 'Melbourne', 'for-sale');
      INSERT INTO ads_fts (rowid, title, description, city_name, category)
        VALUES (1, 'Red bike for sale', 'A lovely road bike', 'Melbourne', 'for-sale');
    `);

    const stmt = db.prepare('SELECT COUNT(*) AS n FROM ads_fts WHERE ads_fts MATCH ?');

    for (const q of NASTY) {
      const phrase = toFtsPhrase(q);
      if (phrase === null) continue;
      assert.doesNotThrow(() => stmt.get(phrase), `MATCH threw for raw input: ${q}`);
    }

    // Sanity check: a real term still matches on its own column data.
    assert.ok(stmt.get(toFtsPhrase('bike')).n >= 1, 'expected the seeded ad to match "bike"');
  } finally {
    db.close();
  }
});
