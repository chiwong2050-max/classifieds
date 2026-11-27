'use strict';

/**
 * Area-JSON builder library.
 *
 * Turns local source caches into the per-area JSON files that
 * `src/config/areas.js` loads. Everything here is a pure transform - no
 * network and no writes - so the CLI (`build.js`) and the tests can share it.
 *
 * Honesty rules are baked in:
 *   - Distances come only from *unique* coordinates. A postcode-centroid table
 *     (`/root/ap_suburbs.csv`) gives names/postcodes, never km.
 *   - A field with no real source is left `null` / `[]`; nothing is guessed.
 *
 * Source files (a "sources" directory):
 *   areas.csv      name,state,country,lga,county,slug,postcode   (the place list)
 *   wiki.json      { "<slug>": { extract, title, url, file, author, licence,
 *                                commonsUrl, population: { value, year,
 *                                source, sourceUrl } } }          (Wikipedia/Commons)
 *   towns.tsv      slug,name,lat,lon,unique                       (distances)
 *   places.json    { "<slug>": [ { name, type, osmUrl } ] }       (OpenStreetMap)
 *   businesses.json{ "<slug>": [ { name, category, url } ] }      (our directories)
 *   nearby.json    { "<slug>": [ "<other-slug>", ... ] }          (curated names)
 */

const fs = require('fs');
const path = require('path');

const SEGMENT = /^[a-z0-9-]+$/;

/** Convert a display name to a URL-safe slug (matches src/config/locations.js). */
function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// --- Tiny quote-aware CSV/TSV parser ---------------------------------------

function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse delimited text into objects keyed by the (lower-cased) header row. */
function parseRecords(text, delim) {
  const rows = parseDelimited(text, delim).filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const record = {};
    header.forEach((key, i) => {
      record[key] = (cells[i] || '').trim();
    });
    return record;
  });
}

/**
 * Parse a *header-less* delimited file where the caller supplies the column
 * order. Every line is data; `cells[i]` is stored under `cols[i]`. This is the
 * shape of the live caches (`/root/ap_suburbs.csv`, `/root/as-wiki/towns.tsv`,
 * `/root/aw-wiki/places.tsv`), which carry no header row.
 *
 * `cols` may be an array or a comma-separated string ("name,state,postcode").
 */
function parsePositional(text, delim, cols) {
  const names = (Array.isArray(cols) ? cols : String(cols || '').split(','))
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean);
  if (!names.length) return [];
  const rows = parseDelimited(text, delim).filter((r) => r.some((c) => c.trim() !== ''));
  return rows.map((cells) => {
    const record = {};
    names.forEach((key, i) => {
      record[key] = (cells[i] || '').trim();
    });
    return record;
  });
}

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

// --- Source readers --------------------------------------------------------

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${err.message}`);
  }
}

/** Read the required place list (`areas.csv`). */
function readPlaceList(file) {
  const text = readText(file);
  if (text === null) throw new Error(`Place list not found: ${file}`);
  return parseRecords(text, ',').filter((r) => r.name && r.state && r.country);
}

/**
 * Read the unique-coordinate table (`towns.tsv`). Only rows flagged unique are
 * returned, because a postcode centroid puts many suburbs on one point and
 * must never become a distance.
 * @returns {Map<string, {lat:number, lon:number}>} keyed by slug
 */
function readUniqueCoords(file) {
  const coords = new Map();
  const text = readText(file);
  if (text === null) return coords;
  for (const row of parseRecords(text, '\t')) {
    if (!truthy(row.unique)) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = row.slug ? row.slug.toLowerCase() : slugify(row.name);
    if (!key) continue;
    coords.set(key, { lat, lon });
  }
  return coords;
}

// --- Distances -------------------------------------------------------------

/** Great-circle distance in km between two unique coordinate points. */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const roundKm = (km) => Math.round(km * 10) / 10;

/**
 * Nearest neighbours per area, from unique coordinates only. An area with no
 * unique coordinate gets no nearby list (never a guess).
 * @returns {Map<string, Array<{name:string, slug:string, km:number}>>}
 */
function autoNearby(entries, coords, { maxKm = 120, limit = 5 } = {}) {
  const withCoords = entries.filter((e) => coords.has(e.slug));
  const out = new Map();
  for (const entry of withCoords) {
    const here = coords.get(entry.slug);
    const neighbours = withCoords
      .filter((other) => other.slug !== entry.slug)
      .map((other) => ({ name: other.name, slug: other.slug, km: roundKm(haversineKm(here, coords.get(other.slug))) }))
      .filter((n) => n.km <= maxKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
    if (neighbours.length) out.set(entry.slug, neighbours);
  }
  return out;
}

/** Curated neighbours (names only); km added only when both have unique coords. */
function curatedNearby(slug, slugs, bySlug, coords) {
  return slugs
    .map((otherSlug) => {
      const other = bySlug.get(otherSlug);
      if (!other) return null; // unknown slug - drop rather than invent a name
      let km = null;
      if (coords.has(slug) && coords.has(otherSlug)) {
        km = roundKm(haversineKm(coords.get(slug), coords.get(otherSlug)));
      }
      return { name: other.name, slug: otherSlug, km };
    })
    .filter(Boolean);
}

// --- Field builders (each returns null / [] when there is no real source) ---

function wikiUrl(title, provided) {
  if (provided) return provided;
  if (!title) return null;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%20/g, '_')}`;
}

function commonsFilePath(file) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file).replace(/%20/g, '_')}`;
}

function buildWiki(src) {
  if (!src) return null;
  const extract = typeof src.extract === 'string' ? src.extract.trim() : '';
  const url = wikiUrl(src.title, src.url);
  if (!extract || !url) return null;
  return {
    extract,
    title: src.title || null,
    url,
    licence: src.licence || 'CC BY-SA 4.0',
  };
}

function buildPhoto(src) {
  const file = src && typeof src.file === 'string' ? src.file.trim() : '';
  if (!file) return null; // Wikimedia Commons only; no file -> no photo
  return {
    file,
    url: commonsFilePath(file),
    author: src.author || null,
    licence: src.licence || null,
    commonsUrl: src.commonsUrl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file).replace(/%20/g, '_')}`,
  };
}

function buildPopulation(src) {
  const pop = src && src.population;
  if (!pop) return null;
  const value = Number(pop.value);
  // Require a real value, a year and a named source before showing a number.
  if (!Number.isFinite(value) || value <= 0 || !pop.year || !pop.source) return null;
  return {
    value,
    year: Number(pop.year),
    source: String(pop.source),
    sourceUrl: pop.sourceUrl || null,
  };
}

function normalisePlaces(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => {
      if (!p || !p.name || !p.type) return null;
      return { name: String(p.name), type: String(p.type), osmUrl: p.osmUrl || null };
    })
    .filter(Boolean);
}

function normaliseBusinesses(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => {
      if (!b || !b.name || !b.url) return null;
      return { name: String(b.name), category: b.category || null, url: String(b.url) };
    })
    .filter(Boolean);
}

/**
 * Build one area object in the exact schema `src/config/areas.js` expects.
 * @param {object} entry  row from areas.csv (name, state, country, lga, county, slug)
 * @param {object} ctx    { wiki, coords, places, businesses, nearby, bySlug, autoNearby, nearbyOpts }
 */
function buildArea(entry, ctx) {
  const country = String(entry.country).toLowerCase();
  const state = String(entry.state).toLowerCase();
  const slug = entry.slug ? String(entry.slug).toLowerCase() : slugify(entry.name);
  if (!SEGMENT.test(country) || !SEGMENT.test(state) || !SEGMENT.test(slug)) {
    throw new Error(`Unsafe slug for "${entry.name}" (${country}/${state}/${slug})`);
  }

  // Nearby: a curated list wins; otherwise the nearest areas by unique coords.
  const curated = ctx.nearby ? ctx.nearby[slug] : null;
  const area = {
    // `slug` is written so the file is self-describing; the loader ignores it
    // and always derives the slug from the path, so the two can never disagree.
    slug,
    name: entry.name,
    state,
    country,
    lga: entry.lga || null,
    wiki: buildWiki(ctx.wiki[slug]),
    photo: buildPhoto(ctx.wiki[slug]),
    population: buildPopulation(ctx.wiki[slug]),
    nearby: curated
      ? curatedNearby(slug, curated, ctx.bySlug, ctx.coords)
      : ctx.autoNearby.get(slug) || [],
    places: normalisePlaces(ctx.places[slug]),
    businesses: normaliseBusinesses(ctx.businesses[slug]),
  };
  // The US has counties rather than LGAs; carry one when the source provides it.
  if (entry.county) area.county = entry.county;
  return area;
}

/**
 * Write an area tree, staging first and then renaming each file into place so
 * a reader never sees a half-written file. Idempotent: re-running overwrites.
 */
function writeAreas(outDir, areas) {
  const staging = `${outDir}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });

  const staged = [];
  for (const area of areas) {
    const rel = path.join(area.country, area.state, `${area.slug}.json`);
    const file = path.join(staging, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(area, null, 2)}\n`);
    staged.push({ file, rel });
  }

  const written = [];
  for (const { file, rel } of staged) {
    const target = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(file, target); // atomic on POSIX; replaces existing on Windows
    written.push(target);
  }
  fs.rmSync(staging, { recursive: true, force: true });
  return written;
}

module.exports = {
  slugify,
  parseRecords,
  parsePositional,
  readPlaceList,
  readUniqueCoords,
  loadSources,
  haversineKm,
  autoNearby,
  curatedNearby,
  buildArea,
  writeAreas,
  SEGMENT,
};

/**
 * Read a whole sources directory and assemble the context `buildArea` needs.
 * Missing optional files simply leave their fields empty (never guessed).
 */
function loadSources(dir, { maxKm, limit } = {}) {
  const wiki = readJson(path.join(dir, 'wiki.json')) || {};
  const places = readJson(path.join(dir, 'places.json')) || {};
  const businesses = readJson(path.join(dir, 'businesses.json')) || {};
  const nearby = readJson(path.join(dir, 'nearby.json')) || null;
  const coords = readUniqueCoords(path.join(dir, 'towns.tsv'));
  const entries = readPlaceList(path.join(dir, 'areas.csv')).map((entry) => ({
    ...entry,
    slug: entry.slug ? entry.slug.toLowerCase() : slugify(entry.name),
  }));
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const auto = autoNearby(entries, coords, { maxKm, limit });
  return { entries, wiki, places, businesses, nearby, coords, bySlug, autoNearby: auto };
}
