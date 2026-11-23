'use strict';

/**
 * Central configuration.
 *
 * Multi-market model
 * ------------------
 * One Node process serves every market. The active market for a request is
 * chosen from the `Host` header (see `src/config/market.js`) and published on
 * an AsyncLocalStorage slot (see `src/config/context.js`). `config.site` is a
 * getter: inside a request it returns that request's market, and outside one
 * (CLI scripts, startup, maintenance) it returns the default market below.
 *
 * The default market is only a fallback. It is chosen by `SITE`/`SITE_KEY`
 * (default `us`) and may be tweaked with environment overrides — these apply
 * for local development, not to the other host-resolved markets.
 *
 * `SITE_CONFIG` still works: point it at a JSON file to override the default
 * market's descriptor values (handy for a bespoke local setup).
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const context = require('./context');
const { siteFor, DEFAULT_CODE } = require('./market');
const { getCountry } = require('./countries');

// Load .env from the project root (silent if it doesn't exist).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ROOT = path.resolve(__dirname, '../..');

// --- Default (fallback) market ---------------------------------------------
const defaultSite = siteFor(DEFAULT_CODE, { applyEnv: true });

if (!getCountry(defaultSite.country)) {
  throw new Error(`Unknown market "${defaultSite.country}". Set SITE=<iso code> or SITE_KEY=<iso code>.`);
}

// Optional bespoke overlay for the default market only.
if (process.env.SITE_CONFIG) {
  const file = path.resolve(ROOT, process.env.SITE_CONFIG);
  if (!fs.existsSync(file)) throw new Error(`SITE_CONFIG not found: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(defaultSite, raw, { key: raw.key || defaultSite.key });
  if (raw.regions) defaultSite.regions = raw.regions;
}

/** Tiny token-based date formatter driven by `site.dateFormat`. */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateTokens(date, pattern) {
  const day = date.getDate();
  const month = date.getMonth();
  const replacements = [
    ['MMMM', MONTHS_LONG[month]],
    ['MMM', MONTHS_SHORT[month]],
    ['YYYY', String(date.getFullYear())],
    ['YY', String(date.getFullYear()).slice(-2)],
    ['DD', String(day).padStart(2, '0')],
    ['MM', String(month + 1).padStart(2, '0')],
    ['D', String(day)],
    ['M', String(month + 1)],
  ];
  let out = pattern;
  for (const [token, value] of replacements) {
    out = out.replace(new RegExp(token, 'g'), value);
  }
  return out;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  root: ROOT,

  formatDateTokens,

  session: {
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    // 30 days, matches ad expiry window for user convenience.
    maxAgeMs: 1000 * 60 * 60 * 24 * 30,
  },

  admin: {
    password: process.env.ADMIN_PASSWORD || '',
  },

  mail: {
    transport: process.env.MAIL_TRANSPORT || 'console',
    from: process.env.MAIL_FROM || 'ListNear <no-reply@listnear.app>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: int(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },

  uploads: {
    // Absolute path to the upload directory.
    dir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'public/uploads'),
    // Public URL prefix used when rendering <img src>.
    publicPath: '/uploads',
    maxImages: int(process.env.MAX_IMAGES_PER_AD, 6),
    maxFileSizeBytes: 8 * 1024 * 1024, // 8MB per uploaded file
    maxWidth: 1600,
    webpQuality: 80,
  },

  ad: {
    expiryDays: int(process.env.AD_EXPIRY_DAYS, 30),
  },

  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    get enabled() {
      return Boolean(this.siteKey && this.secretKey);
    },
  },
};

/**
 * The active market. Resolves from the request context when inside a request,
 * otherwise the default market. Kept as a live getter so existing
 * `config.site.*` reads stay correct across markets with no call-site changes.
 */
Object.defineProperty(config, 'site', {
  enumerable: true,
  configurable: true,
  get() {
    const ctx = context.current();
    return ctx && ctx.site ? ctx.site : defaultSite;
  },
});

/** Expose the fallback market for scripts and the market middleware. */
config.defaultSite = defaultSite;

module.exports = config;
