'use strict';

/**
 * Lightweight i18n for the classifieds engine.
 *
 * All user-facing text lives in `locales/<locale>.json` so the same codebase
 * can serve different markets (AU, US, custom) with different wording. Two
 * files are merged at start-up:
 *   1. the base language dictionary (e.g. `en.json`), and
 *   2. the market locale overrides (e.g. `en-AU.json`), which win.
 *
 * Look-ups use dotted paths (`t('nav.postAd')`) and support `{placeholder}`
 * interpolation. `tp()` adds simple one/other pluralisation via `<key>.one`
 * and `<key>.other` sub-keys.
 *
 * Missing keys fall back to the key itself (so a missing translation is
 * visible in the UI and easy to spot) rather than throwing.
 */

const fs = require('fs');
const path = require('path');
const config = require('./index');

const LOCALES_DIR = path.resolve(config.root, 'locales');
const cache = new Map();

/** Read (and memoise) a locale JSON file; returns {} when absent. */
function readLocale(name) {
  if (!name) return {};
  if (cache.has(name)) return cache.get(name);
  const file = path.join(LOCALES_DIR, `${name}.json`);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  cache.set(name, data);
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

// Base language + market-specific overrides.
const dictionary = merge(readLocale(config.site.language), readLocale(config.site.locale));

function lookup(key) {
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

module.exports = { t, tp, dictionary, locale: config.site.locale };
