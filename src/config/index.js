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

// Base directory for user uploads. Each market stores its files in a
// per-country subdirectory (see `uploads.dir`) so one country can never read
// another's images.
const UPLOAD_BASE = path.resolve(ROOT, process.env.UPLOAD_DIR || 'public/uploads');

// Area-page content. One JSON file per suburb/town lives at
// `<dir>/<cc>/<state>/<slug>.json`; the loader validates and skips bad files.
// Resolved on access so local runs and tests can point AREAS_DIR elsewhere.
function areasDir() {
  return path.resolve(ROOT, process.env.AREAS_DIR || 'data/areas');
}

/**
 * Area-hub rollout allow-list. The value is a comma-separated set of country
 * codes or `cc:state` pairs, e.g. `au`, `au:vic,au:nsw` or `au,us:ca`.
 *
 * Empty / unset means "no new rollout restriction": every area that has a JSON
 * file renders (the behaviour before this switch existed). A non-empty list
 * narrows rendering to the named places only, so a US state can stay off while
 * AU rolls out. This gate decides whether a hub may render at all - it is
 * independent of AREA_PAGES_INDEXING, which only decides whether a rendered,
 * rich page may be indexed.
 */
function areaEnabled(country, state) {
  const raw = String(process.env.AREA_PAGES_ENABLED || '').trim();
  if (!raw) return true;
  const cc = String(country || '').toLowerCase();
  const st = String(state || '').toLowerCase();
  for (const part of raw.split(',')) {
    const [partCountry, partState] = part.trim().toLowerCase().split(':');
    if (!partCountry || partCountry !== cc) continue;
    // A bare country code enables every state; `cc:state` only that state.
    if (!partState || partState === st) return true;
  }
  return false;
}

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
    // Shared base directory (absolute).
    base: UPLOAD_BASE,
    // Per-market upload directory: `<base>/<cc>`. A live getter so it follows
    // the active market, exactly like `config.site`.
    get dir() {
      return path.join(UPLOAD_BASE, config.site.key);
    },
    // Public URL prefix used when rendering <img src>. The `/uploads` handler
    // maps this to the current market's directory only.
    publicPath: '/uploads',
    maxImages: int(process.env.MAX_IMAGES_PER_AD, 6),
    maxFileSizeBytes: 8 * 1024 * 1024, // 8MB per uploaded file
    maxWidth: 1600,
    webpQuality: 80,
  },

  ad: {
    expiryDays: int(process.env.AD_EXPIRY_DAYS, 30),
  },

  // No ad network is integrated and no ad slots are ever rendered. This single
  // boolean documents that stance and gives a future change one place to flip.
  ads: {
    enabled: bool(process.env.ADS_ENABLED, false),
  },

  // Area pages: a mini community hub per suburb/town, assembled from JSON
  // files dropped by the server team (see src/config/areas.js). Both values
  // are live getters so tests and local runs can change them per request.
  areas: {
    get dir() {
      return areasDir();
    },
  },
  // Kill-switch for area-page indexing. While false every area page is
  // noindex and none is listed in the sitemap. Stays false by default.
  areaPages: {
    get indexing() {
      return bool(process.env.AREA_PAGES_INDEXING, false);
    },
    // Rollout allow-list: may a hub render for this country/state at all?
    // Live (reads env every call) so tests and local runs can change it.
    isEnabled(country, state) {
      return areaEnabled(country, state);
    },
  },

  // Cloudflare Turnstile. Both keys are live getters (read every access) so a
  // test can flip the switch at runtime; in production they are fixed by the
  // environment. When either key is empty the verification is a no-op.
  turnstile: {
    get siteKey() {
      return process.env.TURNSTILE_SITE_KEY || '';
    },
    get secretKey() {
      return process.env.TURNSTILE_SECRET_KEY || '';
    },
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
