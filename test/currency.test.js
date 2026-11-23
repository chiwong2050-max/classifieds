'use strict';

/**
 * Tests for currency formatting.
 *
 * `formatPrice` must use the active market's locale + currency through
 * `Intl.NumberFormat`, so currencies with different conventions (JPY/KRW have
 * no decimals, KWD has three, symbol placement follows the locale) render
 * correctly, while the free/contact/negotiable labels keep working.
 *
 * Run with: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { formatPrice } = require('../src/utils/helpers');
const { t } = require('../src/config/i18n');

const locale = config.site.locale;
const expect = (amount, currency) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);

test('formatPrice renders the label price types from the locale file', () => {
  assert.equal(formatPrice(null, 'AUD', 'free'), t('price.free'));
  assert.equal(formatPrice(1000, 'AUD', 'contact'), t('price.contact'));
  assert.equal(formatPrice(null, 'AUD'), t('price.contact'));
});

test('formatPrice matches Intl for a two-decimal currency', () => {
  assert.equal(formatPrice(123456, 'USD'), expect(1234.56, 'USD'));
});

test('formatPrice respects zero-decimal currencies such as JPY', () => {
  assert.equal(formatPrice(123400, 'JPY'), expect(1234, 'JPY'));
});

test('formatPrice respects three-decimal currencies such as KWD', () => {
  assert.equal(formatPrice(123456, 'KWD'), expect(1234.56, 'KWD'));
});

test('formatPrice wraps a negotiable price with the locale label', () => {
  const price = expect(5000, 'USD');
  assert.equal(formatPrice(500000, 'USD', 'negotiable'), t('price.negotiable', { price }));
});

test('formatPrice falls back gracefully for an unknown currency code', () => {
  const out = formatPrice(1000, 'ZZZ');
  assert.ok(out.includes('ZZZ'), out);
  assert.ok(out.includes('10'), out);
});
