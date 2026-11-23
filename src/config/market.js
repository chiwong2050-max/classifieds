'use strict';

/**
 * Market resolution for the multi-country engine.
 *
 * One process serves every market. The market is derived from the request's
 * `Host` header:
 *   - `listnear.app` / `www.listnear.app`        -> United States (apex)
 *   - `<cc>.listnear.app`                        -> that country (e.g. au)
 *   - `us.listnear.app`                          -> 301 to the apex
 *   - `uk.listnear.app`                          -> 301 to `gb.listnear.app`
 *   - reserved labels (www, api, cdn, ...)       -> never a country
 *
 * Anything not on the root domain (localhost, 127.0.0.1, an override) falls
 * back to the local-dev market chosen by `SITE` / `SITE_KEY` (default `au`).
 */

const path = require('path');

const {
  ROOT_DOMAIN,
  RESERVED_SUBDOMAINS,
  HOST_ALIASES,
  getCountry,
  enabledCountries,
} = require('./countries');

const DEFAULT_CODE = String(process.env.SITE || process.env.SITE_KEY || 'au').toLowerCase();

// Where every market's SQLite file lives. With DB_DIR set, each country gets
// its own file at `<DB_DIR>/<cc>.sqlite` (an absolute path is used as-is);
// otherwise the repo-relative default `data/<cc>.sqlite` applies. `DB_PATH`
// remains a single-market override for the default market only.
const DB_DIR = process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : '';

/** Resolve a country's database path (one SQLite file per country). */
function dbFor(code) {
  const file = `${code}.sqlite`;
  return DB_DIR ? path.join(DB_DIR, file) : `data/${file}`;
}

const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

/** Build the `site` descriptor the rest of the app expects for a country code. */
function siteFor(code, { applyEnv = false } = {}) {
  const c = getCountry(code) || getCountry(DEFAULT_CODE);
  const site = {
    key: c.code,
    name: c.code === 'us' ? 'ListNear' : `ListNear ${c.name}`,
    tagline: 'Buy, sell, jobs, services and more near you.',
    country: c.code,
    countryName: c.name,
    nativeName: c.nativeName,
    currency: c.currency,
    locale: c.locale,
    language: c.language,
    languages: c.languages,
    dateFormat: c.code === 'us' ? 'MMM D, YYYY' : 'D MMM YYYY',
    units: c.units,
    url: c.url,
    database: dbFor(c.code),
    supportUrl: c.supportUrl,
    contactEmail: c.contactEmail,
    emergencyNumber: c.emergencyNumber,
    phone: c.phone,
    enabled: c.enabled,
    // Seeded country > region > city hierarchy for this market.
    regions: c.regions,
  };

  if (applyEnv) {
    site.name = pick(process.env.SITE_NAME, site.name);
    site.tagline = pick(process.env.SITE_TAGLINE, site.tagline);
    site.currency = String(pick(process.env.SITE_CURRENCY, process.env.DEFAULT_CURRENCY, site.currency)).toUpperCase();
    site.locale = pick(process.env.SITE_LOCALE, process.env.LOCALE, site.locale);
    site.language = String(pick(process.env.SITE_LANGUAGE, process.env.DEFAULT_LANGUAGE, site.language)).toLowerCase();
    site.dateFormat = pick(process.env.SITE_DATE_FORMAT, site.dateFormat);
    site.units = String(pick(process.env.SITE_UNITS, site.units)).toLowerCase();
    site.url = String(pick(process.env.SITE_URL, site.url)).replace(/\/+$/, '');
    site.database = pick(process.env.DB_PATH, site.database);
    site.supportUrl = pick(process.env.SUPPORT_URL, process.env.BUYMEACOFFEE_URL, site.supportUrl);
    site.contactEmail = pick(process.env.SITE_CONTACT_EMAIL, site.contactEmail);
    site.emergencyNumber = pick(process.env.EMERGENCY_NUMBER, site.emergencyNumber);
  }

  site.distanceUnit = site.units === 'imperial' ? 'mi' : 'km';
  // Sibling markets for the switcher + hreflang (this market included).
  site.alternates = enabledCountries().map((other) => ({
    key: other.code,
    hreflang: other.locale,
    label: other.name,
    url: other.url,
  }));
  return site;
}

/** Strip a port from a Host header value. */
function hostnameOf(host) {
  return String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
}

/**
 * Resolve a Host header to a market decision.
 * @returns {{ kind: 'ok'|'redirect'|'unknown'|'reserved'|'external', code?: string, to?: string }}
 */
function resolveHost(host) {
  const h = hostnameOf(host);
  if (!h) return { kind: 'external' };

  // The apex serves the United States; www 301s to the apex (as in production).
  if (h === ROOT_DOMAIN) return { kind: 'ok', code: 'us' };
  if (h === `www.${ROOT_DOMAIN}`) return { kind: 'redirect', to: `https://${ROOT_DOMAIN}` };

  const suffix = `.${ROOT_DOMAIN}`;
  if (!h.endsWith(suffix)) return { kind: 'external' };

  const sub = h.slice(0, -suffix.length);
  if (!sub || sub.includes('.')) return { kind: 'unknown' };

  // Reserved infrastructure labels are never countries.
  if (RESERVED_SUBDOMAINS.has(sub)) return { kind: 'reserved' };

  // `us` lives on the apex only.
  if (sub === 'us') return { kind: 'redirect', to: `https://${ROOT_DOMAIN}` };

  // Friendly aliases (e.g. uk -> gb) 301 to the canonical ISO subdomain.
  const alias = HOST_ALIASES[sub];
  if (alias) return { kind: 'redirect', to: `https://${alias}.${ROOT_DOMAIN}` };

  if (!getCountry(sub)) return { kind: 'unknown' };
  return { kind: 'ok', code: sub };
}

module.exports = { DEFAULT_CODE, siteFor, resolveHost };
