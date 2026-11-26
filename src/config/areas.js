'use strict';

/**
 * Area-page content loader.
 *
 * One JSON file per suburb/town is dropped by the server team at
 * `<AREAS_DIR>/<cc>/<state>/<slug>.json` (e.g. `data/areas/au/vic/bendigo.json`).
 * Nothing here scrapes: the app only reads the files it is given.
 *
 * Every field is validated. A file that is missing, unreadable, not JSON, or
 * has no usable `name` is skipped with a single log line and this module
 * returns null - it never throws, so one bad file can never take a page down.
 */

const fs = require('fs');
const path = require('path');
const config = require('./index');

const log = (...args) => console.warn('[areas]', ...args);

// URL/path segment guard: only lowercase slugs can ever touch the filesystem,
// which also rules out path traversal via the route.
const SEGMENT = /^[a-z0-9-]+$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// --- Field normalisers (each returns null / [] when the data is unusable) ---

function normWiki(raw) {
  if (!isObject(raw)) return null;
  const extract = str(raw.extract);
  const url = str(raw.url);
  if (!extract || !url) return null;
  return {
    extract,
    title: str(raw.title) || null,
    url,
    // Wikimedia text is CC BY-SA 4.0; keep whatever the file states, else default.
    licence: str(raw.licence) || 'CC BY-SA 4.0',
  };
}

// Photos may only come from Wikimedia Commons.
function isCommonsUrl(url) {
  try {
    return /(^|\.)wikimedia\.org$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function normPhoto(raw) {
  if (!isObject(raw)) return null;
  const url = str(raw.url);
  const file = str(raw.file);
  if (!url || !file || !isCommonsUrl(url)) return null;
  const commonsUrl = str(raw.commonsUrl);
  return {
    file,
    url,
    author: str(raw.author) || null,
    licence: str(raw.licence) || null,
    commonsUrl: commonsUrl && isCommonsUrl(commonsUrl) ? commonsUrl : null,
  };
}

function normPopulation(raw) {
  if (!isObject(raw)) return null;
  const value = num(raw.value);
  if (value === null || value <= 0) return null;
  return {
    value,
    year: num(raw.year),
    source: str(raw.source) || null,
    sourceUrl: str(raw.sourceUrl) || null,
  };
}

function normNearby(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!isObject(item)) return null;
      const name = str(item.name);
      const slug = str(item.slug);
      if (!name || !slug) return null;
      // km is only shown when it is a real number; unknown stays null.
      return { name, slug, km: num(item.km) };
    })
    .filter(Boolean);
}

function normPlaces(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!isObject(item)) return null;
      const name = str(item.name);
      const type = str(item.type);
      if (!name || !type) return null;
      return { name, type, osmUrl: str(item.osmUrl) || null };
    })
    .filter(Boolean);
}

function normBusinesses(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!isObject(item)) return null;
      const name = str(item.name);
      const url = str(item.url);
      if (!name || !url) return null;
      return { name, category: str(item.category) || null, url };
    })
    .filter(Boolean);
}

/** Validate and shape a raw file body. Returns null when `name` is missing. */
function normalize(country, state, slug, raw) {
  if (!isObject(raw)) return null;
  const name = str(raw.name);
  if (!name) return null;
  return {
    slug,
    name,
    // Values from the file win; otherwise infer from the path it was found at.
    state: str(raw.state).toLowerCase() || state,
    country: str(raw.country).toLowerCase() || country,
    lga: str(raw.lga) || null,
    wiki: normWiki(raw.wiki),
    photo: normPhoto(raw.photo),
    population: normPopulation(raw.population),
    nearby: normNearby(raw.nearby),
    places: normPlaces(raw.places),
    businesses: normBusinesses(raw.businesses),
  };
}

/** Absolute path for an area file, or null when a segment is not a safe slug. */
function areaPath(country, state, slug) {
  const cc = String(country || '').toLowerCase();
  const st = String(state || '').toLowerCase();
  const sl = String(slug || '').toLowerCase();
  if (!SEGMENT.test(cc) || !SEGMENT.test(st) || !SEGMENT.test(sl)) return null;
  return path.join(config.areas.dir, cc, st, `${sl}.json`);
}

// Small mtime cache so a page render does not re-read + re-parse on every hit.
const cache = new Map();

/**
 * Load and validate one area by its URL coordinates.
 * @returns {object|null} the normalised area, or null when there is no usable file.
 */
function loadArea(country, state, slug) {
  const file = areaPath(country, state, slug);
  if (!file) return null;

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    // No file for this area is the normal case (most towns have none yet).
    cache.delete(file);
    return null;
  }

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.area;

  let area = null;
  try {
    area = normalize(
      String(country).toLowerCase(),
      String(state).toLowerCase(),
      String(slug).toLowerCase(),
      JSON.parse(fs.readFileSync(file, 'utf8'))
    );
    if (!area) log(`skipped ${file}: no usable "name"`);
  } catch (err) {
    log(`skipped ${file}: ${err.message}`);
    area = null;
  }

  cache.set(file, { mtimeMs: stat.mtimeMs, area });
  return area;
}

/**
 * Every valid area under a country (optionally one state). Used by the sitemap.
 */
function listAreas(country, state) {
  const cc = String(country || '').toLowerCase();
  if (!SEGMENT.test(cc)) return [];
  const base = path.join(config.areas.dir, cc);

  let states;
  try {
    states = state
      ? [String(state).toLowerCase()]
      : fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }

  const out = [];
  for (const st of states) {
    if (!SEGMENT.test(st)) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(base, st));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const area = loadArea(cc, st, file.slice(0, -5));
      if (area) out.push(area);
    }
  }
  return out;
}

/** How many optional "real" sections (beyond the intro) this area carries. */
function sectionCount(area) {
  if (!area) return 0;
  let n = 0;
  if (area.photo) n += 1;
  if (area.population) n += 1;
  if (area.nearby.length) n += 1;
  if (area.places.length) n += 1;
  if (area.businesses.length) n += 1;
  return n;
}

/**
 * Richness gate. A page counts as rich when it has a Wikipedia extract plus at
 * least two other real sections, or when it already has at least one real post.
 * Only rich pages are ever indexable / listed in the sitemap.
 */
function isRich(area, postCount = 0) {
  if (!area) return false;
  if (Number(postCount) > 0) return true;
  const hasWikiIntro = Boolean(area.wiki && area.wiki.extract);
  return hasWikiIntro && sectionCount(area) >= 2;
}

module.exports = {
  areaPath,
  loadArea,
  listAreas,
  sectionCount,
  isRich,
  // Exposed for tests.
  normalize,
};
