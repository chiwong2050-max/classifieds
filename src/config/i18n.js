'use strict';

/**
 * Lightweight i18n for the classifieds engine.
 *
 * All user-facing text lives in `locales/<locale>.json` so the same codebase
 * can serve different markets (AU, US, custom) with different wording. Two
 * files are merged per market:
 *   1. the base language dictionary (e.g. `en.json`), and
 *   2. the market locale overrides (e.g. `en-AU.json`), which win.
 *
 * Because one process serves every market, the dictionary is resolved lazily
 * from the active request's `config.site` (language + locale) and memoised per
 * pair. Look-ups use dotted paths (`t('nav.postAd')`) and support
 * `{placeholder}` interpolation. `tp()` adds simple one/other pluralisation via
 * `<key>.one` / `<key>.other` sub-keys.
 *
 * Missing keys fall back to the key itself (so a missing translation is
 * visible in the UI and easy to spot) rather than throwing.
 */

const fs = require('fs');
const path = require('path');
const config = require('./index');

const LOCALES_DIR = path.resolve(config.root, 'locales');
const fileCache = new Map();
const dictCache = new Map();

/** Read (and memoise) a locale JSON file; returns {} when absent. */
function readLocale(name) {
  if (!name) return {};
  if (fileCache.has(name)) return fileCache.get(name);
  const file = path.join(LOCALES_DIR, `${name}.json`);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fileCache.set(name, data);
  return data;
}

/** Recursively merge plain objects; non-objects from `override` win. */
function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    const isPlainObject = value && typeof value === 'object' && !Array.isArray(value);
    if (isPlainObject && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Build (and memoise) the merged dictionary for a market. Resolution order:
 *   English base (`en`)  ->  the market's UI language  ->  the market locale.
 * Each later layer wins, so an `en`/`en-AU` market reads naturally and a
 * market whose language has no locale file yet safely falls back to English
 * (the documented default) instead of showing raw keys.
 */
function dictionaryFor(site) {
  const s = site || config.site;
  const language = s.language || 'en';
  const locale = s.locale || language;
  const key = `${language}|${locale}`;
  if (!dictCache.has(key)) {
    const merged = merge(merge(readLocale('en'), readLocale(language)), readLocale(locale));
    dictCache.set(key, merged);
  }
  return dictCache.get(key);
}

function lookup(key) {
  const dictionary = dictionaryFor(config.site);
  return String(key)
    .split('.')
    .reduce((acc, part) => (acc && typeof acc === 'object' && acc[part] !== undefined ? acc[part] : undefined), dictionary);
}

function interpolate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : match
  );
}

/** Translate `key`, interpolating `{placeholders}`. Falls back to the key. */
function t(key, vars = {}) {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  return interpolate(value, vars);
}

/** Pluralising translate: resolves `<key>.one` / `<key>.other` by `count`. */
function tp(key, count, vars = {}) {
  const suffix = Number(count) === 1 ? 'one' : 'other';
  return t(`${key}.${suffix}`, { ...vars, count });
}

module.exports = {
  t,
  tp,
  dictionaryFor,
  // Live views of the active market's dictionary/locale (getters, not snapshots,
  // so they follow host-based market resolution within a single process).
  get dictionary() {
    return dictionaryFor(config.site);
  },
  get locale() {
    return config.site.locale;
  },
};
