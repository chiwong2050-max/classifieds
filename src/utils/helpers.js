'use strict';

const crypto = require('crypto');
const config = require('../config');
const { t, tp } = require('../config/i18n');

const ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'; // no 0/1/l/o ambiguity

/** Short, URL-safe public id (default 9 chars). */
function shortId(length = 9) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

/** Cryptographically random hex token. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * One-way hash of an IP address. We never store raw IPs - only a salted hash
 * used for rate limiting / abuse correlation.
 */
function hashIp(ip) {
  return crypto
    .createHmac('sha256', config.session.secret)
    .update(String(ip || 'unknown'))
    .digest('hex')
    .slice(0, 32);
}

/** Constant-time comparison to avoid timing attacks on tokens/passwords. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Human-friendly price label using the market's locale + currency, e.g.
 * "$1,250" / "¥1,234" / "Free" / "Contact for price".
 *
 * `Intl.NumberFormat` handles each currency's own conventions (JPY/KRW have no
 * decimals, KWD has three, and symbol/placement follow the locale), so no
 * hand-maintained symbol table is needed.
 */
function formatPrice(cents, currency, priceType = 'fixed') {
  // Labels come from the market's locale file so each site reads naturally.
  if (priceType === 'free') return t('price.free');
  if (priceType === 'contact' || cents === null || cents === undefined) return t('price.contact');
  const locale = config.site.locale;
  const code = String(currency || config.site.currency || 'USD').toUpperCase();
  let label;
  try {
    label = new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(cents / 100);
  } catch {
    // Unknown/invalid ISO code -> keep the number, append the code verbatim.
    const value = (cents / 100).toLocaleString(locale, { maximumFractionDigits: 2 });
    label = `${value} ${code}`;
  }
  return priceType === 'negotiable' ? t('price.negotiable', { price: label }) : label;
}

/** ISO timestamp N days from now (UTC, sqlite-friendly 'YYYY-MM-DD HH:MM:SS'). */
function sqliteNowPlusDays(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Coarse, localized relative time, e.g. "3 days ago". */
function timeAgo(sqliteDate) {
  if (!sqliteDate) return '';
  const then = new Date(`${sqliteDate.replace(' ', 'T')}Z`).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.minutesAgo', { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return tp('time.daysAgo', days);
  const months = Math.round(days / 30);
  return tp('time.monthsAgo', months);
}

/** Format a date using the market's date pattern (e.g. "22 Nov 2026"). */
function formatDate(value) {
  if (!value) return '';
  // Accept either a sqlite 'YYYY-MM-DD HH:MM:SS' string or a Date instance.
  const d = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  // Token formatter driven by config.site.dateFormat (D MMM YYYY vs MMM D, YYYY).
  return config.formatDateTokens(d, config.site.dateFormat);
}

function truncate(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

module.exports = {
  shortId,
  randomToken,
  hashIp,
  safeEqual,
  formatPrice,
  sqliteNow,
  sqliteNowPlusDays,
  timeAgo,
  formatDate,
  truncate,
};
