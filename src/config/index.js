'use strict';

/**
 * Central configuration.
 *
 * Multi-market model
 * ------------------
 * One codebase powers several independent classifieds *markets* (e.g. an
 * Australian site and a US site). Each market is described by a small JSON
 * file in `src/config/sites/<key>.json` and gets its own branding, currency,
 * locale, date/units format, database file and seeded list of regions/cities.
 *
 * Which market to run is chosen at start-up via the `SITE` (or `SITE_KEY`)
 * environment variable. Point `SITE_CONFIG` at an absolute path to load a
 * custom market file instead. Individual values can still be overridden with
 * environment variables, so the same build works on different domains with
 * separate databases without any code changes.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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

/** First defined, non-empty value from the list (env override helper). */
const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const ROOT = path.resolve(__dirname, '../..');
const SITES_DIR = path.join(__dirname, 'sites');

// Which market are we running as?
const MARKET_KEY = String(pick(process.env.SITE, process.env.SITE_KEY, 'au')).toLowerCase();

/** Resolve and read the market JSON file (built-in or a custom SITE_CONFIG path). */
function loadMarket(key) {
  const custom = process.env.SITE_CONFIG;
  const file = custom
    ? path.resolve(ROOT, custom)
    : path.join(SITES_DIR, `${key}.json`);

  if (!fs.existsSync(file)) {
    const available = fs.existsSync(SITES_DIR)
      ? fs.readdirSync(SITES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
      : [];
    throw new Error(
      `Unknown market "${key}". No config at ${file}. ` +
      `Available markets: ${available.join(', ') || '(none)'}. ` +
      'Set SITE=<key> or SITE_CONFIG=<path>.'
    );
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...raw, key: raw.key || key };
}

const market = loadMarket(MARKET_KEY);

// Environment overrides sit on top of the market file so deployments can tweak
// a value without editing the file (e.g. SITE_URL for the live domain).
const site = {
  key: market.key,
  name: pick(process.env.SITE_NAME, market.name, 'ListNear'),
  tagline: pick(process.env.SITE_TAGLINE, market.tagline, 'Buy, sell, jobs, services and more near you.'),
  country: String(pick(process.env.SITE_COUNTRY, process.env.DEFAULT_COUNTRY, market.country, 'au')).toLowerCase(),
  countryName: pick(process.env.SITE_COUNTRY_NAME, market.countryName, 'Australia'),
  currency: String(pick(process.env.SITE_CURRENCY, process.env.DEFAULT_CURRENCY, market.currency, 'AUD')).toUpperCase(),
  locale: pick(process.env.SITE_LOCALE, process.env.LOCALE, market.locale, 'en-AU'),
  language: String(pick(process.env.SITE_LANGUAGE, process.env.DEFAULT_LANGUAGE, market.language, 'en')).toLowerCase(),
  dateFormat: pick(process.env.SITE_DATE_FORMAT, market.dateFormat, 'D MMM YYYY'),
  units: String(pick(process.env.SITE_UNITS, market.units, 'metric')).toLowerCase(),
  url: String(pick(process.env.SITE_URL, market.url, 'http://localhost:3000')).replace(/\/+$/, ''),
  database: pick(process.env.DB_PATH, market.database, 'data/listnear.sqlite'),
  supportUrl: pick(process.env.SUPPORT_URL, process.env.BUYMEACOFFEE_URL, market.supportUrl, ''),
  contactEmail: pick(process.env.SITE_CONTACT_EMAIL, market.contactEmail, ''),
  emergencyNumber: pick(process.env.EMERGENCY_NUMBER, market.emergencyNumber, ''),
  // Sibling markets (same codebase, other domains) used for the footer
  // switcher and `hreflang` alternates. Includes this market itself.
  alternates: Array.isArray(market.alternates) ? market.alternates : [],
  // Seeded country > region > city hierarchy for this market.
  regions: market.regions || {},
};

// Distance unit derived from the market's measurement system.
site.distanceUnit = site.units === 'imperial' ? 'mi' : 'km';

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

  // Active market descriptor (branding, locale, currency, regions, database).
  site,
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

module.exports = config;
