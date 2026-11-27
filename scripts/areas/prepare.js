#!/usr/bin/env node
'use strict';

/**
 * Area-sources PREPARE step (run by a server admin on the DATA host).
 *
 * The build job (`build.js`) expects a tidy `--sources` folder
 * (`areas.csv`, `wiki.json`, `towns.tsv`, optional `places.json` /
 * `businesses.json`). That folder does not exist on the real server: the live
 * caches are in other formats (a Wikipedia/Commons SQLite cache, Australia Post
 * locality CSVs, town TSVs, OSM extracts, directory databases).
 *
 * This step reads those local caches and writes the tidy `--sources` tree that
 * `build.js` consumes. It is NOT started by the web process and does not run
 * against live extracts in CI; the tests use tiny fixture stand-ins only.
 *
 * Where it runs: on the machine that holds the caches (today: UltaHost,
 * 82.23.146.45), NOT the app host. The app host (OVH #2) only receives the
 * finished JSON tree from `build.js`.
 *
 * Honesty rules (unchanged):
 *   - Local data first; the network is a last resort only (`--allow-network`,
 *     off by default) for a missing Wikipedia extract, rate-limited + cached.
 *   - Distances come only from *unique* coordinates. A postcode centroid puts
 *     many suburbs on one point, so those rows are written `unique=false` and
 *     never become a `km`. Nothing is guessed: an unknown column, a missing
 *     file or an unnamed place is skipped with a log line.
 *   - No Overpass. OSM is read by clipping the local extract with `osmium`.
 *
 * Usage:
 *   node scripts/areas/prepare.js --country au --state vic
 *   node scripts/areas/prepare.js --country us --state ca --limit 20 --dry-run
 *
 * Operator wrap (low impact; do not schedule at 03:00 or ~01:30 AU/Melbourne):
 *   nice -n 19 ionice -c idle node scripts/areas/prepare.js --country au --state nsw
 *
 * Options:
 *   --country <cc>        au | us (required)
 *   --state <slug>        state/territory slug (default: whole country)
 *   --out <dir>           sources tree to write      (default data/areas-src)
 *   --limit <n>           cap the number of places    (trials)
 *   --dry-run             compute + log, write nothing
 *   --allow-network       last-resort rate-limited Wikipedia fill (off)
 *   --cache <dir>         network cache               (default .cache/areas)
 *   --suburbs <file>      locality/postcode CSV       (AU default /root/ap_suburbs.csv)
 *   --towns <file>        town coordinates TSV        (default /root/as-wiki/towns.tsv)
 *   --places <file>       place-name TSV              (default /root/aw-wiki/places.tsv)
 *   --wiki-db <file>      Wikipedia/Commons SQLite    (default /root/aw-wiki/wd.sqlite)
 *   --wiki-tables <list>  cache tables to read        (default en,it,ph)
 *   --osm-file <pbf>      OSM extract                 (AU: AU.pbf, US: US.pbf)
 *   --directories <list>  directory sources (csv/tsv/json/sqlite), comma-separated
 *   --census <file>       local attributed census file (US population only)
 *   --help                show this message
 *
 * It is idempotent (files are staged then renamed into place) and honours the
 * load gate at /usr/local/bin/main-ok.sh when that exists.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const lib = require('./lib');
const network = require('./network');

const ROOT = path.resolve(__dirname, '../..');
const LOAD_GATE = '/usr/local/bin/main-ok.sh';
const TAG = '[areas:prepare]';
const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);

const DEFAULTS = {
  out: 'data/areas-src',
  cache: '.cache/areas',
  placesLimit: 12,
  poiRadiusKm: 15,
};

/** Caches that live on the data host and are not country-specific. */
const HOST = {
  wikiDb: '/root/aw-wiki/wd.sqlite',
  wikiTables: 'en,it,ph',
  towns: '/root/as-wiki/towns.tsv',
  places: '/root/aw-wiki/places.tsv',
};

/** Per-country defaults (all overridable with flags). */
const COUNTRIES = {
  au: {
    suburbs: '/root/ap_suburbs.csv',
    osm: '/root/geofabrik/pbf/AU.pbf',
    directories: ['/root/australiaweb', '/root/localaus', '/root/eatzap', '/root/findacarer'],
  },
  us: {
    suburbs: null,
    osm: '/root/geofabrik/pbf/US.pbf',
    directories: ['/root/localusa', '/root/eatzap'],
  },
};

// --- Column detection ------------------------------------------------------

const COLS = {
  slug: ['slug', 'key', 'place_slug'],
  name: ['name', 'locality', 'suburb', 'town', 'place', 'site', 'title'],
  postcode: ['postcode', 'post_code', 'postal_code', 'pc', 'zip', 'zipcode'],
  state: ['state', 'state_code', 'st', 'region'],
  country: ['country', 'country_code', 'cc'],
  lga: [
    'lga',
    'local_government_area',
    'local government area',
    'local_government',
    'local government',
    'council',
  ],
  county: ['county'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'long', 'longitude'],
  type: ['type', 'category', 'kind', 'amenity', 'leisure'],
  url: ['url', 'website', 'link', 'homepage'],
  extract: ['extract', 'summary', 'text', 'intro', 'description'],
  title: ['title', 'page_title', 'page'],
  wikiUrl: ['url', 'page_url', 'link'],
  file: ['file', 'image', 'photo', 'image_file', 'filename'],
  author: ['author', 'artist', 'creator', 'credit'],
  licence: ['licence', 'license', 'rights'],
  popValue: ['population', 'pop', 'population_value'],
  popYear: ['year', 'population_year', 'pop_year'],
  popSource: ['source', 'population_source'],
  popSourceUrl: ['source_url', 'population_source_url'],
};

/**
 * Pick a column by exact name first (in alias priority order), then by
 * substring. Detection is logged by the callers so an admin can see exactly
 * which real column each field came from.
 */
function detectColumn(columns, aliases) {
  if (!columns || !columns.length) return null;
  const lower = columns.map((c) => String(c).toLowerCase());
  for (const alias of aliases) {
    const i = lower.indexOf(alias);
    if (i !== -1) return columns[i];
  }
  for (const alias of aliases) {
    const i = lower.findIndex((c) => c.includes(alias));
    if (i !== -1) return columns[i];
  }
  return null;
}

const pick = (row, col) => (col ? row[col] : undefined);

// --- Small helpers ---------------------------------------------------------

function readText(file) {
  if (!file || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function parseRecords(text, delim) {
  return lib.parseRecords(text, delim);
}

function delimFor(file) {
  return path.extname(file).toLowerCase() === '.tsv' ? '\t' : ',';
}

function toCsv(header, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(','));
  return `${lines.join('\n')}\n`;
}

function toTsv(header, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.replace(/[\t\n\r]+/g, ' ');
  };
  const lines = [header.join('\t')];
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join('\t'));
  return `${lines.join('\n')}\n`;
}

const isTableName = (name) => /^[A-Za-z0-9_]+$/.test(String(name || ''));

// --- Argument parsing / help ----------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [rawKey, inline] = token.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) {
        args[key] = inline;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      'Area-sources PREPARE step. Reads the live caches on the data host and',
      'writes the tidy --sources tree that scripts/areas/build.js consumes.',
      '',
      'Usage:',
      '  node scripts/areas/prepare.js --country au --state vic',
      '',
      'Options:',
      '  --country <cc>        au | us (required)',
      '  --state <slug>        state/territory slug (default: whole country)',
      `  --out <dir>           sources tree        (default ${DEFAULTS.out})`,
      '  --limit <n>           cap the number of places (trials)',
      '  --dry-run             compute + log, write nothing',
      '  --allow-network       last-resort rate-limited Wikipedia fill (off)',
      `  --cache <dir>         network cache       (default ${DEFAULTS.cache})`,
      '  --suburbs <file>      locality/postcode CSV  (AU: /root/ap_suburbs.csv)',
      `  --towns <file>        town coordinates TSV   (default ${HOST.towns})`,
      `  --places <file>       place-name TSV         (default ${HOST.places})`,
      `  --wiki-db <file>      Wikipedia SQLite cache (default ${HOST.wikiDb})`,
      `  --wiki-tables <list>  cache tables to read   (default ${HOST.wikiTables})`,
      '  --osm-file <pbf>      OSM extract (AU: AU.pbf, US: US.pbf)',
      '  --directories <list>  directory sources, comma-separated',
      '  --census <file>       local attributed census file (US population)',
      '  --help                show this message',
      '',
    ].join('\n')
  );
}

// --- Low impact ------------------------------------------------------------

/** Respect the host load gate when the admin has installed one. */
function loadGateOk() {
  if (!fs.existsSync(LOAD_GATE)) return true;
  return spawnSync(LOAD_GATE, { stdio: 'ignore' }).status === 0;
}

/** Best-effort low priority; the operator wrapper (nice/ionice) is stronger. */
function applyLowPriority() {
  try {
    os.setPriority(0, 19);
  } catch {
    /* not permitted on this platform - ignore */
  }
}

// --- Place list (areas.csv source) -----------------------------------------

/** Locality CSV/TSV (`--suburbs`) -> place rows (names + postcodes only). */
function readSuburbs(file, { country, state, columns } = {}) {
  const text = readText(file);
  if (text === null) {
    log(`suburbs: ${file} not found; skipping`);
    return [];
  }
  const rows = parseRecords(text, delimFor(file));
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const map = columns || {
    name: detectColumn(cols, COLS.name),
    postcode: detectColumn(cols, COLS.postcode),
    state: detectColumn(cols, COLS.state),
    lga: detectColumn(cols, COLS.lga),
    county: detectColumn(cols, COLS.county),
  };
  if (!map.name) {
    log(`suburbs: no name column in ${file} (saw: ${cols.join(', ')}); skipping`);
    return [];
  }
  log(`suburbs: name="${map.name}" state=${map.state || '-'} postcode=${map.postcode || '-'} lga=${map.lga || '-'}`);

  const wanted = state ? String(state).toLowerCase() : null;
  const out = [];
  for (const r of rows) {
    const name = String(pick(r, map.name) || '').trim();
    if (!name) continue;
    const rowState = map.state ? String(pick(r, map.state) || '').trim().toLowerCase() : wanted || '';
    // Without a state column and no --state scope we cannot attribute the row.
    if (!rowState) continue;
    if (wanted && rowState !== wanted) continue;
    out.push({
      name,
      state: rowState,
      country,
      lga: map.lga ? String(pick(r, map.lga) || '').trim() : '',
      county: map.county ? String(pick(r, map.county) || '').trim() : '',
      postcode: map.postcode ? String(pick(r, map.postcode) || '').trim() : '',
    });
  }
  return dedupePlaces(out);
}

/** Drop duplicate slugs (keeps the first), logging each drop. */
function dedupePlaces(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    // The wiki cache already keys by slug; a locality CSV is slugged from name.
    const slug = row.slug ? String(row.slug).toLowerCase() : lib.slugify(row.name);
    if (!slug || seen.has(slug)) {
      if (slug) log(`place list: dropping duplicate slug "${slug}" (${row.name})`);
      continue;
    }
    seen.add(slug);
    out.push({ ...row, slug });
  }
  return out;
}

// --- Wikipedia / Commons SQLite cache --------------------------------------

function wikiColumns(cols) {
  const map = {
    slug: detectColumn(cols, COLS.slug),
    name: detectColumn(cols, COLS.name),
    title: detectColumn(cols, COLS.title),
    extract: detectColumn(cols, COLS.extract),
    url: detectColumn(cols, COLS.wikiUrl),
    file: detectColumn(cols, COLS.file),
    author: detectColumn(cols, COLS.author),
    licence: detectColumn(cols, COLS.licence),
    lat: detectColumn(cols, COLS.lat),
    lon: detectColumn(cols, COLS.lon),
    popValue: detectColumn(cols, COLS.popValue),
    popYear: detectColumn(cols, COLS.popYear),
    popSource: detectColumn(cols, COLS.popSource),
    popSourceUrl: detectColumn(cols, COLS.popSourceUrl),
  };
  return map;
}

/**
 * Map one cache row to `{ wiki, lat, lon }`. Only real values are kept; a
 * missing column simply leaves the field out (never guessed).
 */
function wikiFromRow(row, map) {
  const out = {};
  const str = (col) => {
    const v = pick(row, col);
    return v === undefined || v === null ? '' : String(v).trim();
  };
  const extract = str(map.extract);
  const title = str(map.title) || str(map.name);
  const url = str(map.url);
  if (extract) out.extract = extract;
  if (title) out.title = title;
  if (url) out.url = url;
  const file = str(map.file);
  if (file) {
    out.file = file;
    const author = str(map.author);
    const licence = str(map.licence);
    if (author) out.author = author;
    if (licence) out.licence = licence;
  }
  const value = Number(str(map.popValue));
  const year = Number(str(map.popYear));
  const source = str(map.popSource);
  // A population needs a real value, a year AND a named source.
  if (Number.isFinite(value) && value > 0 && Number.isFinite(year) && year > 0 && source) {
    out.population = { value, year, source, sourceUrl: str(map.popSourceUrl) || null };
  }
  const lat = Number(str(map.lat));
  const lon = Number(str(map.lon));
  return {
    wiki: out,
    lat: Number.isFinite(lat) && str(map.lat) !== '' ? lat : null,
    lon: Number.isFinite(lon) && str(map.lon) !== '' ? lon : null,
  };
}

/**
 * Read the Wikipedia/Commons SQLite cache. Tables/flags are introspected with
 * `PRAGMA table_info` and rows are matched to our place slugs (exact slug, or a
 * title-style prefix when the cache keys by page title). Missing tables/files
 * are skipped, never fatal.
 *
 * When no place list is supplied, the cache doubles as the place list: every
 * named row becomes a place (keyed by its slug column, else its slugified
 * name), which is how a US state can be wired without a locality CSV.
 * @returns {{ wiki: object, coords: Map<string,{lat:number,lon:number}>, places: Array }}
 */
function readWikiDb(file, { tables, entries, slugColumn } = {}) {
  const wiki = {};
  const coords = new Map();
  const places = [];
  if (!file || !fs.existsSync(file)) {
    log(`wiki: ${file || '(unset)'} not found; skipping`);
    return { wiki, coords, places };
  }
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (err) {
    log(`wiki: cannot open ${file}: ${err.message}; skipping`);
    return { wiki, coords, places };
  }
  try {
    const present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map((r) => r.name)
    );
    const wanted = (tables || []).filter((t) => isTableName(t) && present.has(t));
    if (!wanted.length) log(`wiki: none of [${(tables || []).join(', ')}] present in ${file}`);

    const haveEntries = Boolean(entries && entries.length);
    const slugSet = new Set(haveEntries ? entries.map((e) => e.slug) : []);
    const byLen = [...slugSet].sort((a, b) => b.length - a.length);

    for (const table of wanted) {
      const cols = db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((c) => c.name);
      const map = wikiColumns(cols);
      // A cache that keys by title (not slug) may use "Newcastle, New South
      // Wales"; allow a strict prefix match in that case only.
      const keyCol = map.slug || slugColumn || map.name || map.title;
      const exactOnly = Boolean(map.slug || slugColumn);
      const nameCol = map.name || map.title || map.slug;
      const stateCol = detectColumn(cols, COLS.state);
      const countryCol = detectColumn(cols, COLS.country);
      log(`wiki[${table}]: key="${keyCol || '-'}" extract=${map.extract || '-'} file=${map.file || '-'} population=${map.popValue || '-'}`);

      let matched = 0;
      let seen = 0;
      for (const row of db.prepare(`SELECT * FROM "${table}"`).iterate()) {
        const rawKey = pick(row, keyCol);
        const key = rawKey === undefined || rawKey === null ? '' : String(rawKey).trim().toLowerCase();
        if (!key) continue;
        seen += 1;
        const slug = haveEntries
          ? matchSlug(key, slugSet, byLen, exactOnly)
          : exactOnly
            ? key
            : lib.slugify(pick(row, nameCol) || key);
        if (!slug) continue;
        const { wiki: entry, lat, lon } = wikiFromRow(row, map);
        if (Object.keys(entry).length) wiki[slug] = { ...(wiki[slug] || {}), ...entry };
        if (lat !== null && lon !== null && !coords.has(slug)) coords.set(slug, { lat, lon });
        if (!haveEntries && !places.some((p) => p.slug === slug)) {
          places.push({
            slug,
            name: String(pick(row, nameCol) || key).trim() || slug,
            state: stateCol ? String(pick(row, stateCol) || '').trim().toLowerCase() : '',
            country: countryCol ? String(pick(row, countryCol) || '').trim().toLowerCase() : '',
          });
        }
        matched += 1;
      }
      log(`wiki[${table}]: matched ${matched} of ${seen} row(s)`);
    }
  } finally {
    db.close();
  }
  return { wiki, coords, places };
}

/** Exact slug match; a title key may match a slug by strict prefix. */
function matchSlug(key, slugSet, byLen, exactOnly) {
  if (slugSet.has(key)) return key;
  if (exactOnly) return null;
  for (const slug of byLen) {
    if (key.startsWith(`${slug}-`) || slug.startsWith(`${key}-`)) return slug;
  }
  return null;
}

// --- Town coordinates ------------------------------------------------------

/** Town coordinate TSV (`--towns`) -> rows keyed by slug (first row wins). */
function readTownCoords(file, { state } = {}) {
  const text = readText(file);
  if (text === null) {
    log(`towns: ${file} not found; skipping`);
    return [];
  }
  const rows = parseRecords(text, '\t');
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const map = {
    slug: detectColumn(cols, COLS.slug),
    name: detectColumn(cols, COLS.name),
    lat: detectColumn(cols, COLS.lat),
    lon: detectColumn(cols, COLS.lon),
    state: detectColumn(cols, COLS.state),
  };
  if (!map.lat || !map.lon) {
    log(`towns: no lat/lon columns in ${file} (saw: ${cols.join(', ')}); skipping`);
    return [];
  }
  const wanted = state ? String(state).toLowerCase() : null;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const lat = Number(pick(r, map.lat));
    const lon = Number(pick(r, map.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (wanted && map.state && String(pick(r, map.state) || '').trim().toLowerCase() !== wanted) continue;
    const slug = map.slug ? String(pick(r, map.slug) || '').trim().toLowerCase() : lib.slugify(pick(r, map.name));
    if (!slug || seen.has(slug)) continue; // duplicate town row - keep the first
    seen.add(slug);
    out.push({ slug, name: String(pick(r, map.name) || '').trim(), lat, lon });
  }
  return out;
}

/**
 * Flag each coordinate `unique` only when no other place shares that exact
 * point. A postcode centroid (many suburbs on one point) is therefore never a
 * distance source.
 */
function computeUniqueCoords(rows) {
  const counts = new Map();
  const keyOf = (r) => `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) || 0) + 1);
  return rows.map((r) => ({ ...r, unique: counts.get(keyOf(r)) === 1 }));
}

// --- Place names (places.json source) --------------------------------------

/** `/root/aw-wiki/places.tsv` -> { slug: [{ name, type, osmUrl }] }. */
function readPlaceNames(file, { entries } = {}) {
  const out = {};
  const text = readText(file);
  if (text === null) {
    log(`places: ${file} not found; skipping`);
    return out;
  }
  const rows = parseRecords(text, '\t');
  if (!rows.length) return out;
  const cols = Object.keys(rows[0]);
  const map = {
    slug: detectColumn(cols, COLS.slug),
    name: detectColumn(cols, COLS.name),
    type: detectColumn(cols, COLS.type),
    url: detectColumn(cols, ['osm_url', 'url', 'link']),
  };
  if (!map.name || !map.type) {
    log(`places: need name+type columns in ${file} (saw: ${cols.join(', ')}); skipping`);
    return out;
  }
  const slugSet = new Set(entries.map((e) => e.slug));
  for (const r of rows) {
    const name = String(pick(r, map.name) || '').trim();
    const type = String(pick(r, map.type) || '').trim();
    const slug = map.slug ? String(pick(r, map.slug) || '').trim().toLowerCase() : lib.slugify(name);
    if (!name || !type || !slugSet.has(slug)) continue;
    (out[slug] = out[slug] || []).push({ name, type, osmUrl: pick(r, map.url) || null });
  }
  return out;
}

// --- OpenStreetMap (clipped locally with osmium; never Overpass) ------------

/**
 * Turn an `osmium export` GeoJSON document into places. Pure: no filesystem
 * and no network, so it is unit-tested with a tiny fixture.
 */
function placesFromGeoJson(geojson, { osmTypes = [] } = {}) {
  const features = (geojson && geojson.features) || [];
  const out = [];
  for (const f of features) {
    const props = (f && f.properties) || {};
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    if (!name) continue; // an unnamed feature is never invented
    const type = String(props.amenity || props.leisure || props.tourism || props.shop || '').trim();
    if (!type) continue;
    if (osmTypes.length && !osmTypes.includes(type)) continue;
    const m = /^([nwr])(\d+)$/.exec(String(props['@id'] || ''));
    const osmUrl = m ? `https://www.openstreetmap.org/${osmKind(m[1])}/${m[2]}` : null;
    out.push({ name, type, osmUrl });
  }
  return out;
}

function osmKind(prefix) {
  if (prefix === 'w' || prefix === 'way') return 'way';
  if (prefix === 'r' || prefix === 'relation') return 'relation';
  return 'node';
}

/** Is `osmium` installed? */
function hasOsmium() {
  try {
    return spawnSync('osmium', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

const OSM_FILTER = [
  'n/amenity=park,library,playground,community_centre,post_office,marketplace,place_of_worship',
  'n/leisure=park,playground,garden,pitch,sports_centre,swimming_pool',
  'n/tourism=museum,artwork,attraction,viewpoint',
].join(' ');

/**
 * Clip the local OSM extract once, export GeoJSON and assign each POI to the
 * nearest in-scope area. Silently skipped when osmium or the extract is absent
 * (e.g. in tests) - the places section is then simply left empty.
 */
function osmPlaces({ osmFile, entries, coords, tmpDir, limit }) {
  const out = {};
  if (!osmFile || !fs.existsSync(osmFile)) {
    log(`osm: ${osmFile || '(unset)'} not found; skipping places`);
    return out;
  }
  if (!hasOsmium()) {
    log('osm: osmium not installed; skipping places');
    return out;
  }
  const withCoords = entries.filter((e) => coords.has(e.slug));
  if (!withCoords.length) {
    log('osm: no unique coordinates to anchor a bbox; skipping places');
    return out;
  }
  const pad = 0.1;
  const lats = withCoords.map((e) => coords.get(e.slug).lat);
  const lons = withCoords.map((e) => coords.get(e.slug).lon);
  const bbox = [
    (Math.min(...lons) - pad).toFixed(5),
    (Math.min(...lats) - pad).toFixed(5),
    (Math.max(...lons) + pad).toFixed(5),
    (Math.max(...lats) + pad).toFixed(5),
  ].join(',');

  const clip = path.join(tmpDir, 'clip.osm.pbf');
  const pois = path.join(tmpDir, 'pois.osm.pbf');
  const geojson = path.join(tmpDir, 'pois.geojson');
  const steps = [
    ['extract', '--strategy', 'complete_ways', '--bbox', bbox, '-o', clip, osmFile],
    ['tags-filter', OSM_FILTER, '-o', pois, clip],
    ['export', '-f', 'geojson', '--add-unique-id', 'type_id', '-o', geojson, pois],
  ];
  for (const args of steps) {
    const r = spawnSync('osmium', args, { stdio: 'ignore' });
    if (r.status !== 0) {
      log(`osm: osmium ${args[0]} failed (status ${r.status}); skipping places`);
      return out;
    }
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(geojson, 'utf8'));
  } catch (err) {
    log(`osm: could not parse exported GeoJSON: ${err.message}; skipping places`);
    return out;
  }
  const found = placesFromGeoJson(doc);
  log(`osm: ${found.length} POI(s) in the clip`);

  // Assign each POI to the nearest area within DEFAULTS.poiRadiusKm.
  for (const feature of doc.features || []) {
    const geometry = feature.geometry || {};
    const point = geometry.type === 'Point' ? geometry.coordinates : centroid(geometry.coordinates);
    if (!point) continue;
    const [lon, lat] = point;
    let best = null;
    for (const entry of withCoords) {
      const here = coords.get(entry.slug);
      const km = lib.haversineKm({ lat, lon }, here);
      if (km <= DEFAULTS.poiRadiusKm && (!best || km < best.km)) best = { slug: entry.slug, km };
    }
    if (!best) continue;
    const parsed = placesFromGeoJson({ features: [feature] })[0];
    if (!parsed) continue;
    const list = (out[best.slug] = out[best.slug] || []);
    if (list.length >= (limit || DEFAULTS.placesLimit)) continue;
    if (list.some((p) => p.name === parsed.name && p.type === parsed.type)) continue; // no duplicates
    list.push(parsed);
  }
  return out;
}

function centroid(coords) {
  if (!Array.isArray(coords) || !coords.length) return null;
  let x = 0;
  let y = 0;
  let n = 0;
  const walk = (c) => {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
      x += c[0];
      y += c[1];
      n += 1;
    } else if (Array.isArray(c)) {
      c.forEach(walk);
    }
  };
  coords.forEach(walk);
  return n ? [x / n, y / n] : null;
}

// --- Directory listings (businesses.json source) ---------------------------

/** Categories never surfaced (family-safe; no utilities/toilets dumped). */
const CATEGORY_DENY = ['toilet', 'restroom', 'public_toilet', 'wc', 'adult', 'casino', 'betting'];

function rowsFromFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.sqlite' || ext === '.db') return rowsFromSqlite(file);
  const text = readText(file);
  if (text === null) return [];
  if (ext === '.json') {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.listings || data.businesses || [];
      return arr.filter((r) => r && typeof r === 'object');
    } catch (err) {
      log(`directories: invalid JSON ${file}: ${err.message}`);
      return [];
    }
  }
  return parseRecords(text, delimFor(file));
}

function rowsFromSqlite(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (err) {
    log(`directories: cannot open ${file}: ${err.message}`);
    return [];
  }
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
      .filter(isTableName);
    const out = [];
    for (const table of tables) {
      const cols = db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((c) => c.name);
      if (!detectColumn(cols, COLS.name) || !detectColumn(cols, COLS.url)) continue;
      for (const row of db.prepare(`SELECT * FROM "${table}"`).iterate()) out.push(row);
    }
    return out;
  } finally {
    db.close();
  }
}

function resolveListingFile(entry) {
  if (!fs.existsSync(entry)) return null;
  if (fs.statSync(entry).isFile()) return entry;
  for (const name of ['listings.sqlite', 'listings.json', 'listings.csv', 'listings.tsv', 'businesses.json']) {
    const candidate = path.join(entry, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  log(`directories: ${entry} is a directory with no known listings file; skipping`);
  return null;
}

/**
 * Our own directory sites -> `{ slug: [{ name, category, url }] }`. Only real
 * published rows with a name, a URL and a known place are kept; names that
 * collide with the place itself (or with another listing for the same place)
 * are dropped, so nothing is duplicated or mislabelled.
 */
function readDirectories(sources, { entries } = {}) {
  const out = {};
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const seenNames = new Map();
  for (const source of sources) {
    const file = resolveListingFile(source);
    if (!file) continue;
    const rows = rowsFromFile(file);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const map = {
      name: detectColumn(cols, COLS.name),
      category: detectColumn(cols, COLS.type),
      url: detectColumn(cols, COLS.url),
      slug: detectColumn(cols, COLS.slug),
      city: detectColumn(cols, ['city', 'town', 'locality', 'suburb']),
      state: detectColumn(cols, COLS.state),
    };
    if (!map.name || !map.url) {
      log(`directories[${path.basename(file)}]: need name+url columns (saw: ${cols.join(', ')}); skipping`);
      continue;
    }
    let kept = 0;
    for (const row of rows) {
      const name = String(pick(row, map.name) || '').trim();
      const url = String(pick(row, map.url) || '').trim();
      if (!name || !url) continue;
      const category = String(pick(row, map.category) || '').trim().toLowerCase();
      if (CATEGORY_DENY.some((bad) => category.includes(bad))) continue;
      const slug = map.slug
        ? String(pick(row, map.slug) || '').trim().toLowerCase()
        : lib.slugify(pick(row, map.city));
      const place = bySlug.get(slug);
      if (!place) continue;
      if (name.toLowerCase() === place.name.toLowerCase()) continue; // name collision with the place
      const key = `${slug}:${name.toLowerCase()}`;
      if (seenNames.has(key)) continue; // duplicate listing
      seenNames.set(key, true);
      (out[slug] = out[slug] || []).push({ name, category: category || null, url });
      kept += 1;
    }
    log(`directories[${path.basename(file)}]: kept ${kept} listing(s)`);
  }
  return out;
}

// --- Census (US population only) -------------------------------------------

/**
 * Local, attributed Census file -> `{ slug: { value, year, source, sourceUrl } }`.
 * Without this (or a population already in the wiki cache) US population is
 * simply skipped rather than guessed.
 */
function readCensus(file, { entries } = {}) {
  const out = {};
  const rows = rowsFromFile(file);
  if (!rows.length) return out;
  const cols = Object.keys(rows[0]);
  const map = {
    slug: detectColumn(cols, COLS.slug),
    name: detectColumn(cols, COLS.name),
    value: detectColumn(cols, COLS.popValue),
    year: detectColumn(cols, COLS.popYear),
    source: detectColumn(cols, COLS.popSource),
    sourceUrl: detectColumn(cols, COLS.popSourceUrl),
  };
  if (!map.value || !map.year || !map.source) {
    log(`census: need value+year+source columns in ${file}; skipping`);
    return out;
  }
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  for (const row of rows) {
    const slug = map.slug ? String(pick(row, map.slug) || '').trim().toLowerCase() : lib.slugify(pick(row, map.name));
    if (!bySlug.has(slug)) continue;
    const value = Number(pick(row, map.value));
    const year = Number(pick(row, map.year));
    const source = String(pick(row, map.source) || '').trim();
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(year) || !source) continue;
    out[slug] = { value, year, source, sourceUrl: pick(row, map.sourceUrl) || null };
  }
  log(`census: ${Object.keys(out).length} population row(s) from ${path.basename(file)}`);
  return out;
}

// --- Orchestration ---------------------------------------------------------

function resolveOsmFile(country, state, override) {
  if (override) return override;
  const c = COUNTRIES[country];
  if (!c) return null;
  if (country === 'us' && state) {
    const region = `/root/geofabrik/pbf/us-${state}-latest.osm.pbf`;
    if (fs.existsSync(region)) return region;
  }
  return c.osm;
}

/**
 * Read every local cache and assemble the in-memory `--sources` tree. Pure
 * apart from reads (and the optional network fill), so tests can assert on it.
 */
async function collect(options) {
  const {
    country,
    state,
    limit,
    paths,
    wikiTables = HOST.wikiTables.split(','),
    allowNetwork = false,
    dryRun = false,
    cacheDir,
    tmpDir,
  } = options;

  // 1. Place list. Prefer the locality CSV; fall back to the wiki cache, which
  //    is not AU-only (so US places can be wired the same way).
  let entries = [];
  if (paths.suburbs) {
    entries = readSuburbs(paths.suburbs, { country, state });
  }

  const wikiState = readWikiDb(paths.wikiDb, { tables: wikiTables, entries, slugColumn: paths.wikiSlugColumn });
  const wiki = wikiState.wiki;
  const dbCoords = wikiState.coords;
  // No locality CSV (e.g. a US state): the wiki cache doubles as the place list.
  if (!entries.length && wikiState.places.length) {
    entries = dedupePlaces(
      wikiState.places.map((p) => ({
        slug: p.slug,
        name: p.name,
        state: p.state || state || '',
        country: p.country || country,
      }))
    );
    log(`place list: derived ${entries.length} place(s) from the wiki cache`);
  }

  if (!entries.length) {
    return { areas: [], wiki: {}, towns: [], places: {}, businesses: {} };
  }

  // 2. Coordinates: unique town rows first, the wiki cache as a fallback.
  const townRows = readTownCoords(paths.towns, { state });
  const townBySlug = new Map(townRows.map((r) => [r.slug, r]));
  const coordRows = [];
  for (const entry of entries) {
    const row = townBySlug.get(entry.slug);
    const fromDb = dbCoords.get(entry.slug);
    const lat = row ? row.lat : fromDb ? fromDb.lat : null;
    const lon = row ? row.lon : fromDb ? fromDb.lon : null;
    if (lat === null || lon === null) continue;
    coordRows.push({ slug: entry.slug, name: entry.name, lat, lon });
  }
  const towns = computeUniqueCoords(coordRows);
  const coords = new Map(towns.filter((t) => t.unique).map((t) => [t.slug, { lat: t.lat, lon: t.lon }]));
  log(`coords: ${towns.length} town(s), ${coords.size} unique coordinate(s)`);

  // 3. Places: the local place-name TSV plus OSM POIs clipped with osmium.
  //    The clip is the one heavy step, so a --dry-run trial skips it.
  const places = { ...readPlaceNames(paths.places, { entries }) };
  if (dryRun) {
    log('osm: skipped in dry-run');
  } else {
    const osm = osmPlaces({
      osmFile: paths.osm,
      entries,
      coords,
      tmpDir: tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'areas-prepare-')),
      limit: DEFAULTS.placesLimit,
    });
    for (const [slug, list] of Object.entries(osm)) {
      const merged = places[slug] || [];
      for (const p of list) {
        if (!merged.some((m) => m.name === p.name && m.type === p.type)) merged.push(p);
      }
      places[slug] = merged;
    }
  }

  // 4. Businesses from our own directory sites.
  const businesses = paths.directories.length
    ? readDirectories(paths.directories, { entries })
    : {};

  // 5. Census: local attributed figures only (never invented).
  if (paths.census) {
    const census = readCensus(paths.census, { entries });
    for (const [slug, pop] of Object.entries(census)) {
      wiki[slug] = { ...(wiki[slug] || {}), population: pop };
    }
  }

  // 6. Optional, last-resort Wikipedia fill for places still missing an extract.
  if (allowNetwork) {
    for (const entry of entries) {
      const existing = wiki[entry.slug];
      if (existing && existing.extract) continue;
      try {
        const summary = await network.wikiSummary(entry.name, { cacheDir });
        if (summary) wiki[entry.slug] = { ...(existing || {}), ...summary };
      } catch (err) {
        log(`network lookup failed for ${entry.slug}: ${err.message}`);
      }
    }
  }

  // 7. Keep only the requested scope, then apply the trial limit.
  let scoped = entries;
  if (country) scoped = scoped.filter((e) => e.country === country);
  if (state) scoped = scoped.filter((e) => e.state === state);
  if (limit > 0) scoped = scoped.slice(0, limit);
  const scopedSlugs = new Set(scoped.map((e) => e.slug));
  const scopedWiki = {};
  for (const [slug, value] of Object.entries(wiki)) if (scopedSlugs.has(slug)) scopedWiki[slug] = value;
  const scopedTowns = towns.filter((t) => scopedSlugs.has(t.slug));
  const scopedPlaces = {};
  for (const [slug, value] of Object.entries(places)) if (scopedSlugs.has(slug)) scopedPlaces[slug] = value;
  const scopedBusinesses = {};
  for (const [slug, value] of Object.entries(businesses)) if (scopedSlugs.has(slug)) scopedBusinesses[slug] = value;

  return {
    areas: scoped.map((e) => ({
      name: e.name,
      state: e.state,
      country: e.country,
      lga: e.lga || '',
      county: e.county || '',
      slug: e.slug,
      postcode: e.postcode || '',
    })),
    wiki: scopedWiki,
    towns: scopedTowns,
    places: scopedPlaces,
    businesses: scopedBusinesses,
  };
}

/** Write the sources tree: stage every file, then rename each into place. */
function writeSources(outDir, sources) {
  const staging = `${outDir}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  fs.writeFileSync(
    path.join(staging, 'areas.csv'),
    toCsv(['name', 'state', 'country', 'lga', 'county', 'slug', 'postcode'], sources.areas)
  );
  fs.writeFileSync(path.join(staging, 'wiki.json'), `${JSON.stringify(sources.wiki, null, 2)}\n`);
  fs.writeFileSync(
    path.join(staging, 'towns.tsv'),
    toTsv(['slug', 'name', 'lat', 'lon', 'unique'], sources.towns)
  );
  if (Object.keys(sources.places).length) {
    fs.writeFileSync(path.join(staging, 'places.json'), `${JSON.stringify(sources.places, null, 2)}\n`);
  }
  if (Object.keys(sources.businesses).length) {
    fs.writeFileSync(path.join(staging, 'businesses.json'), `${JSON.stringify(sources.businesses, null, 2)}\n`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const name of fs.readdirSync(staging)) {
    const target = path.join(outDir, name);
    fs.renameSync(path.join(staging, name), target); // atomic on POSIX
    written.push(target);
  }
  fs.rmSync(staging, { recursive: true, force: true });
  return written;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { help: true };
  }

  const country = args.country ? String(args.country).toLowerCase() : null;
  if (!country || !COUNTRIES[country]) {
    log(`--country must be one of: ${Object.keys(COUNTRIES).join(', ')}`);
    printHelp();
    return { error: 'country' };
  }
  const state = args.state ? String(args.state).toLowerCase() : null;
  const defaults = COUNTRIES[country];
  const outDir = path.resolve(ROOT, args.out || DEFAULTS.out);
  const cacheDir = path.resolve(ROOT, args.cache || DEFAULTS.cache);
  const limit = args.limit ? Math.max(0, parseInt(args.limit, 10)) : 0;
  const dryRun = Boolean(args.dryRun);
  const allowNetwork = Boolean(args.allowNetwork);

  const paths = {
    suburbs: args.suburbs !== undefined ? args.suburbs : defaults.suburbs,
    towns: args.towns || HOST.towns,
    places: args.places || HOST.places,
    wikiDb: args.wikiDb || HOST.wikiDb,
    wikiSlugColumn: args.wikiSlugColumn || null,
    osm: resolveOsmFile(country, state, args.osmFile),
    directories: args.directories ? String(args.directories).split(',').filter(Boolean) : defaults.directories,
    census: args.census || null,
  };
  const wikiTables = args.wikiTables ? String(args.wikiTables).split(',').filter(Boolean) : HOST.wikiTables.split(',');

  log(`start country=${country} state=${state || 'all'} out=${outDir} network=${allowNetwork ? 'on' : 'off'}${dryRun ? ' dry-run' : ''}`);
  log(`sources: suburbs=${paths.suburbs || '-'} towns=${paths.towns} wiki=${paths.wikiDb} osm=${paths.osm || '-'}`);

  if (!loadGateOk()) {
    log('load gate not ok (main-ok.sh); skipping this run');
    return { skipped: 'load-gate' };
  }
  applyLowPriority();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'areas-prepare-'));
  let sources;
  try {
    sources = await collect({ country, state, limit, paths, wikiTables, allowNetwork, dryRun, cacheDir, tmpDir });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  log(
    `prepared: places=${sources.areas.length} wiki=${Object.keys(sources.wiki).length}` +
      ` towns=${sources.towns.length} unique=${sources.towns.filter((t) => t.unique).length}` +
      ` places.json=${Object.keys(sources.places).length} businesses=${Object.keys(sources.businesses).length}`
  );

  if (!sources.areas.length) {
    log('no places matched the filter; nothing to write');
    return { written: [], sources };
  }

  if (dryRun) {
    log(`dry-run: would write the sources tree under ${outDir}`);
    return { dryRun: true, sources };
  }

  const written = writeSources(outDir, sources);
  log(`wrote ${written.length} file(s) under ${outDir}`);
  return { written, sources };
}

if (require.main === module) {
  main()
    .then((result) => process.exit(result && result.error ? 1 : 0))
    .catch((err) => {
      console.error(`${TAG} failed:`, err.message);
      process.exit(1);
    });
}

module.exports = {
  main,
  collect,
  writeSources,
  parseArgs,
  detectColumn,
  computeUniqueCoords,
  readSuburbs,
  readTownCoords,
  readWikiDb,
  readPlaceNames,
  readDirectories,
  readCensus,
  placesFromGeoJson,
  resolveOsmFile,
  loadGateOk,
  DEFAULTS,
  HOST,
  COUNTRIES,
};
