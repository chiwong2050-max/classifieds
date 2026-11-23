'use strict';

/**
 * Tests for the host-based market engine.
 *
 * Covers the Host -> market mapping (apex, www, country subdomains, the `us`
 * and `uk` aliases, reserved labels, unknown/nested subdomains and off-domain
 * local-dev hosts), the enabled-flag / env allow-list, per-country database
 * paths and the cross-market alternate-path helper.
 *
 * Run with: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveHost, siteFor } = require('../src/config/market');
const {
  getCountry,
  enabledCountries,
  parseEnabledList,
  DEFAULT_ENABLED_CODES,
} = require('../src/config/countries');
const { alternatePathFor } = require('../src/utils/seo');

test('apex serves the United States', () => {
  assert.deepEqual(resolveHost('listnear.app'), { kind: 'ok', code: 'us' });
});

test('www redirects to the apex', () => {
  const d = resolveHost('www.listnear.app');
  assert.equal(d.kind, 'redirect');
  assert.equal(d.to, 'https://listnear.app');
});

test('country subdomains resolve to their country (with or without a port)', () => {
  assert.deepEqual(resolveHost('au.listnear.app'), { kind: 'ok', code: 'au' });
  assert.deepEqual(resolveHost('gb.listnear.app'), { kind: 'ok', code: 'gb' });
  assert.deepEqual(resolveHost('jp.listnear.app:443'), { kind: 'ok', code: 'jp' });
});

test('us subdomain redirects to the apex (US is apex-only)', () => {
  const d = resolveHost('us.listnear.app');
  assert.equal(d.kind, 'redirect');
  assert.equal(d.to, 'https://listnear.app');
});

test('uk is aliased to the canonical gb subdomain', () => {
  const d = resolveHost('uk.listnear.app');
  assert.equal(d.kind, 'redirect');
  assert.equal(d.to, 'https://gb.listnear.app');
});

test('reserved infrastructure labels are never markets', () => {
  for (const sub of ['mail', 'webmail', 'admin', 'api', 'static', 'cdn', 'dev', 'staging', 'smtp']) {
    assert.equal(resolveHost(`${sub}.listnear.app`).kind, 'reserved', sub);
  }
});

test('unknown and nested subdomains are rejected', () => {
  assert.equal(resolveHost('zzz.listnear.app').kind, 'unknown');
  assert.equal(resolveHost('nope.listnear.app').kind, 'unknown');
  assert.equal(resolveHost('a.b.listnear.app').kind, 'unknown');
});

test('off-domain hosts fall back to the local-dev market', () => {
  assert.equal(resolveHost('localhost').kind, 'external');
  assert.equal(resolveHost('localhost:3517').kind, 'external');
  assert.equal(resolveHost('127.0.0.1:3000').kind, 'external');
  assert.equal(resolveHost('example.com').kind, 'external');
  assert.equal(resolveHost('').kind, 'external');
});

test('enabled flags default to us + au (with no env override)', () => {
  assert.deepEqual([...DEFAULT_ENABLED_CODES].sort(), ['au', 'us']);
  if (!process.env.LISTNEAR_ENABLED_COUNTRIES) {
    assert.equal(getCountry('us').enabled, true);
    assert.equal(getCountry('au').enabled, true);
    // Catalogued but not live until a later batch.
    assert.equal(getCountry('gb').enabled, false);
    assert.equal(getCountry('jp').enabled, false);
    assert.deepEqual(enabledCountries().map((c) => c.code).sort(), ['au', 'us']);
  }
});

test('parseEnabledList normalises a comma-separated allow-list', () => {
  assert.deepEqual(parseEnabledList('us, AU ,gb'), ['us', 'au', 'gb']);
  assert.deepEqual(parseEnabledList(''), []);
  assert.deepEqual(parseEnabledList(undefined), []);
});

test('each market resolves to its own SQLite file', () => {
  const us = siteFor('us');
  const au = siteFor('au');
  assert.match(us.database, /us\.sqlite$/);
  assert.match(au.database, /au\.sqlite$/);
  assert.notEqual(us.database, au.database);
});

test('siteFor carries the market locale, currency and origin', () => {
  const au = siteFor('au');
  assert.equal(au.country, 'au');
  assert.equal(au.locale, 'en-AU');
  assert.equal(au.currency, 'AUD');
  assert.equal(au.url, 'https://au.listnear.app');
  const us = siteFor('us');
  assert.equal(us.url, 'https://listnear.app');
});

test('alternatePathFor keeps global paths and falls back to home for locations', () => {
  assert.equal(alternatePathFor({ path: '/', originalUrl: '/' }), '/');
  assert.equal(alternatePathFor({ path: '/about/', originalUrl: '/about/' }), '/about/');
  assert.equal(alternatePathFor({ path: '/browse/', originalUrl: '/browse/?page=2' }), '/browse/?page=2');
  // Location URLs only exist on their own market -> the other market's home.
  assert.equal(alternatePathFor({ path: '/au/vic/melbourne/', originalUrl: '/au/vic/melbourne/' }), '/');
  assert.equal(alternatePathFor({ path: '/us/', originalUrl: '/us/' }), '/');
  assert.equal(alternatePathFor(null), '/');
});
