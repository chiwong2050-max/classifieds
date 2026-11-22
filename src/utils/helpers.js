'use strict';

const crypto = require('crypto');
const config = require('../config');

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

const CURRENCY_SYMBOLS = { AUD: '$', NZD: '$', USD: '$', GBP: '£', CAD: '$', EUR: '€' };

function currencySymbol(currency) {
  return CURRENCY_SYMBOLS[String(currency || '').toUpperCase()] || '';
}

/** Human-friendly price label, e.g. "$1,250" / "Free" / "Contact for price". */
function formatPrice(cents, currency, priceType = 'fixed') {
  if (priceType === 'free') return 'Free';
  if (priceType === 'contact' || cents === null || cents === undefined) return 'Contact for price';
  const value = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const label = `${currencySymbol(currency)}${value}`;
  return priceType === 'negotiable' ? `${label} (negotiable)` : label;
}

/** ISO timestamp N days from now (UTC, sqlite-friendly 'YYYY-MM-DD HH:MM:SS'). */
function sqliteNowPlusDays(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Coarse relative time, e.g. "3 days ago". */
function timeAgo(sqliteDate) {
  if (!sqliteDate) return '';
  const then = new Date(`${sqliteDate.replace(' ', 'T')}Z`).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** Format a sqlite date as a friendly date (e.g. "22 Nov 2026"). */
function formatDate(sqliteDate) {
  if (!sqliteDate) return '';
  const d = new Date(`${sqliteDate.replace(' ', 'T')}Z`);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
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
  currencySymbol,
  sqliteNow,
  sqliteNowPlusDays,
  timeAgo,
  formatDate,
  truncate,
};
