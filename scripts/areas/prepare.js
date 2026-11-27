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
 * Scale rule (learned from the real data host):
 *   - The live caches carry NO header row. Each *known* cache therefore has a
 *     built-in column map (overridable with `--<role>-cols` or `AREA_*_COLS`);
 *     header detection is only a fallback for an *unknown* file.
 *   - `--country` / `--state` / `--limit` are applied to the place list FIRST;
 *     the heavy cache is only ever looked up for the places left in scope.
 *   - The Wikipedia/Commons cache (`wd.sqlite`, ~1.2 GB) is NEVER full-scanned:
 *     rows are fetched by title (and photos joined by file), the `it` table is
 *     skipped by default, and a `--max-seconds` budget stops a runaway run.
 *   - If the place list cannot be read the run fails with a clear error rather
 *     than falling back to walking the whole cache.
 *
 * Usage:
 *   node scripts/areas/prepare.js --country au --state vic --limit 8 --dry-run
 *   node scripts/areas/prepare.js --country us --state ca --limit 20
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
 *   --max-seconds <n>     hard time budget            (default 300)
 *   --allow-network       last-resort rate-limited Wikipedia fill (off)
 *   --cache <dir>         network cache               (default .cache/areas)
 *   --suburbs <file>      locality/postcode CSV       (AU default /root/ap_suburbs.csv)
 *   --suburbs-cols <list> column order for that file  (default name,state,postcode,lat,lon)
 *   --towns <file>        town coordinates TSV        (default /root/as-wiki/towns.tsv)
 *   --towns-cols <list>   column order for that file  (default id,name,state,lat,lon)
 *   --places <file>       place-name TSV              (default /root/aw-wiki/places.tsv)
 *   --places-cols <list>  column order for that file  (default name; type defaults to "place")
 *   --wiki-db <file>      Wikipedia/Commons SQLite    (default /root/aw-wiki/wd.sqlite)
 *   --wiki-tables <list>  cache tables to read        (default en,ph - "it" is skipped)
 *   --osm-file <pbf>      OSM extract                 (AU: AU.pbf, US: US.pbf)
 *   --directories <list>  directory sources (csv/tsv/json/sqlite), comma-separated
 *   --listings-env <file> env file holding the listings MySQL DSN (optional)
 *   --listings-table <t>  listings table name         (default listings)
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
  maxSeconds: 300,
  progressEvery: 10000,
};

/** Caches that live on the data host and are not country-specific. */
const HOST = {
  wikiDb: '/root/aw-wiki/wd.sqlite',
  // `it` (other languages, ~12.2M rows) is deliberately excluded by default.
  wikiTables: 'en,ph',
  towns: '/root/as-wiki/towns.tsv',
  places: '/root/aw-wiki/places.tsv',
};

/**
 * Built-in column maps for the *known* header-less caches, keyed by file name.
 * The live files carry NO header row, so their column *order* must be supplied;
 * `--<role>-cols` (or the matching `AREAS_*_COLS` env) overrides it. Any *other*
 * file falls back to header detection (the "unknown file" path).
 *
 * `towns.tsv` keeps a leading `id` only so `name`/`state` land on the right
 * columns - it is positional filler, never the slug (the slug is the name).
 */
const KNOWN_CACHE_COLS = {
  'ap_suburbs.csv': 'name,state,postcode,lat,lon',
  'towns.tsv': 'id,name,state,lat,lon',
  'places.tsv': 'name',
};

/**
 * Known column names inside the Wikipedia/Commons cache. Each field is only
 * used when that column actually exists in the table, otherwise detection runs
 * - so both the real schema (`en(title,ex,pop,py,img)`, `ph(file,data)`) and
 * the tiny test stand-in are read correctly.
 */
const WIKI_TABLE_COLS = {
  en: { title: 'title', extract: 'ex', popValue: 'pop', popYear: 'py', file: 'img' },
  ph: { file: 'file', licence: 'data' },
};

/** Per-country defaults (all overridable with flags). */
const COUNTRIES = {
  au: {
    suburbs: '/root/ap_suburbs.csv',
    osm: '/root/geofabrik/pbf/AU.pbf',
    // The old `/root/<app>` directory paths do not exist (the directory sites
    // are WordPress/MySQL). Listings now come from an optional MySQL source
    // (`--listings-env`) and are skipped, with a log line, when none is given.
    directories: [],
  },
  us: {
    suburbs: null,
    osm: '/root/geofabrik/pbf/US.pbf',
    directories: [],
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

/** Quote an SQL identifier (table/column) safely; names come from our own maps. */
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// --- Known column maps (header-less caches) --------------------------------

/**
 * Decide how to read a delimited cache.
 *
 * A *known* cache (matched by file name) has a built-in column order because
 * the live files carry no header row; an explicit `--<role>-cols` override
 * always wins, and anything else falls back to header detection.
 *
 * @returns {{headerless: boolean, cols: string|null}}
 */
function resolveColumns({ file, explicit } = {}) {
  if (explicit) return { headerless: true, cols: String(explicit) };
  const base = file ? path.basename(file).toLowerCase() : '';
  if (KNOWN_CACHE_COLS[base]) return { headerless: true, cols: KNOWN_CACHE_COLS[base] };
  return { headerless: false, cols: null };
}

/** Lower-cased logical column names from a `--<role>-cols` value. */
const logicalNames = (cols) =>
  (Array.isArray(cols) ? cols : String(cols || '').split(','))
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean);

/** First alias present (exact, case-insensitive) in a header-less column list. */
function exactField(columns, aliases) {
  const lower = (columns || []).map((c) => String(c).toLowerCase());
  for (const alias of aliases) {
    const i = lower.indexOf(alias);
    if (i !== -1) return columns[i];
  }
  return null;
}

/** Read a delimited file honouring the resolved column map. */
function readTable(file, { delim, headerless, cols } = {}) {
  const text = readText(file);
  if (text === null) return null;
  if (headerless) return lib.parsePositional(text, delim, cols);
  return parseRecords(text, delim);
}

// --- Time budget -----------------------------------------------------------

/**
 * A hard wall-clock budget. Big loops call `guard()` every few thousand rows;
 * when the budget is spent it throws, so a run on the live data host can never
 * spend a long time silently. Nothing is written until the very end, so an
 * aborted run leaves no partial output.
 */
class TimeBudgetError extends Error {
  constructor(seconds) {
    super(`time budget of ${seconds}s reached; stopping`);
    this.name = 'TimeBudgetError';
  }
}

class Deadline {
  constructor(maxSeconds) {
    this.maxSeconds = Number(maxSeconds) > 0 ? Number(maxSeconds) : 0;
    this.start = Date.now();
  }

  get elapsedMs() {
    return Date.now() - this.start;
  }

  get expired() {
    return this.maxSeconds > 0 && this.elapsedMs > this.maxSeconds * 1000;
  }

  guard() {
    if (this.expired) throw new TimeBudgetError(this.maxSeconds);
  }
}

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
      `  --max-seconds <n>     hard time budget    (default ${DEFAULTS.maxSeconds})`,
      '  --allow-network       last-resort rate-limited Wikipedia fill (off)',
      `  --cache <dir>         network cache       (default ${DEFAULTS.cache})`,
      '  --suburbs <file>      locality CSV (no header)  (AU: /root/ap_suburbs.csv)',
      `  --suburbs-cols <list> column order            (default ${KNOWN_CACHE_COLS['ap_suburbs.csv']})`,
      `  --towns <file>        town TSV (no header)      (default ${HOST.towns})`,
      `  --towns-cols <list>   column order            (default ${KNOWN_CACHE_COLS['towns.tsv']})`,
      `  --places <file>       place-name TSV (no header)(default ${HOST.places})`,
      `  --places-cols <list>  column order            (default ${KNOWN_CACHE_COLS['places.tsv']}; type=place)`,
      `  --wiki-db <file>      Wikipedia SQLite cache   (default ${HOST.wikiDb})`,
      `  --wiki-tables <list>  cache tables to read     (default ${HOST.wikiTables})`,
      '  --osm-file <pbf>      OSM extract (AU: AU.pbf, US: US.pbf)',
      '  --directories <list>  directory sources, comma-separated',
      '  --listings-env <file> env file holding the listings MySQL DSN',
      '  --listings-table <t>  listings table name    (default listings)',
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

/**
 * Locality CSV/TSV (`--suburbs`) -> place rows.
 *
 * The live `/root/ap_suburbs.csv` has NO header: its column order comes from
 * `--suburbs-cols` (default `name,state,postcode,lat,lon`). Only an unknown
 * file falls back to header detection. If the file cannot be read this throws -
 * we must never silently fall back to walking the whole wiki cache.
 */
function readSuburbs(file, { country, state, cols, deadline, progressEvery = DEFAULTS.progressEvery } = {}) {
  const { headerless, cols: resolved } = resolveColumns({ file, explicit: cols });
  const rows = readTable(file, { delim: delimFor(file), headerless, cols: resolved });
  if (rows === null) {
    throw new Error(`suburbs file not found: ${file} (refusing to fall back to the wiki cache)`);
  }
  if (!rows.length) {
    throw new Error(`suburbs file has no data rows: ${file}`);
  }
  const columns = headerless ? logicalNames(resolved) : Object.keys(rows[0]);
  // A header-less file maps its logical names exactly; a headered one is
  // detected by name (with aliases) as before.
  const map = headerless
    ? {
        name: exactField(columns, COLS.name),
        postcode: exactField(columns, COLS.postcode),
        state: exactField(columns, COLS.state),
        lga: exactField(columns, COLS.lga),
        county: exactField(columns, COLS.county),
      }
    : {
        name: detectColumn(columns, COLS.name),
        postcode: detectColumn(columns, COLS.postcode),
        state: detectColumn(columns, COLS.state),
        lga: detectColumn(columns, COLS.lga),
        county: detectColumn(columns, COLS.county),
      };
  if (!map.name || !columns.includes(map.name)) {
    throw new Error(`suburbs file has no name column: ${file} (saw: ${columns.join(', ')})`);
  }
  log(`suburbs: ${headerless ? `positional [${columns.join(', ')}]` : 'header-detected'} name="${map.name}" state=${map.state || '-'} postcode=${map.postcode || '-'}`);

  const wanted = state ? String(state).toLowerCase() : null;
  const out = [];
  let seen = 0;
  for (const r of rows) {
    seen += 1;
    if (seen % progressEvery === 0) {
      log(`suburbs: read ${seen.toLocaleString()} row(s)`);
      if (deadline) deadline.guard();
    }
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
  if (deadline) deadline.guard();
  if (!out.length && wanted) log(`suburbs: no rows matched state=${wanted}`);
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

/**
 * Column map for a wiki cache table. Each field prefers the *known* column name
 * for that table (the real schema) but only when it exists, otherwise it falls
 * back to name detection. This reads both the real `wd.sqlite`
 * (`en(title,ex,pop,py,img)`, `ph(file,data)`) and the tiny test stand-in.
 */
function wikiColumns(cols, table) {
  const known = WIKI_TABLE_COLS[table] || {};
  const pickCol = (field, aliases) =>
    known[field] && cols.includes(known[field]) ? known[field] : detectColumn(cols, aliases);
  return {
    slug: pickCol('slug', COLS.slug),
    name: pickCol('name', COLS.name),
    title: pickCol('title', COLS.title),
    extract: pickCol('extract', COLS.extract),
    url: pickCol('url', COLS.wikiUrl),
    file: pickCol('file', COLS.file),
    author: pickCol('author', COLS.author),
    licence: pickCol('licence', COLS.licence),
    lat: pickCol('lat', COLS.lat),
    lon: pickCol('lon', COLS.lon),
    popValue: pickCol('popValue', COLS.popValue),
    popYear: pickCol('popYear', COLS.popYear),
    popSource: pickCol('popSource', COLS.popSource),
    popSourceUrl: pickCol('popSourceUrl', COLS.popSourceUrl),
  };
}

/**
 * Map one cache row to `{ wiki, lat, lon }`. Only real values are kept; a
 * missing column simply leaves the field out (never guessed).
 *
 * `defaultPopSource` gives the population a named origin when the cache has no
 * source column of its own (the real `en` table): it is Wikipedia data, so it
 * is attributed to Wikipedia rather than left unattributed.
 */
function wikiFromRow(row, map, { defaultPopSource = null } = {}) {
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
  const source = str(map.popSource) || defaultPopSource;
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

/** Escape LIKE wildcards so a place name is matched literally. */
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Fetch the single cache row for one place. A cache keyed by slug (or an
 * explicit `--wiki-slug-column`) matches exactly; one keyed by page title
 * matches exactly first, then by a strict `"<name>,"` prefix (so
 * "Newcastle" finds "Newcastle, New South Wales"). Never scans the table.
 */
function lookupWikiRow(db, spec, entry) {
  const { table, map, keyCol, exactOnly } = spec;
  const keyVal = exactOnly ? entry.slug : entry.name;
  if (!keyVal) return null;
  const qualified = `${quoteIdent(table)}.${quoteIdent(keyCol)}`;
  const read = (sql, params) => {
    try {
      return db.prepare(sql).get(...params) || null;
    } catch (err) {
      log(`wiki[${table}]: lookup failed (${err.message})`);
      return null;
    }
  };
  let row = read(`SELECT * FROM ${quoteIdent(table)} WHERE ${qualified} = ? COLLATE NOCASE LIMIT 1`, [keyVal]);
  if (row) return row;
  if (exactOnly) return null;
  const like = `${escapeLike(keyVal)},%`;
  row = read(`SELECT * FROM ${quoteIdent(table)} WHERE ${qualified} LIKE ? ESCAPE '\\' LIMIT 1`, [like]);
  return row || null;
}

/**
 * Read the Wikipedia/Commons SQLite cache for the places *in scope only*.
 *
 * The cache is ~1.2 GB (the `it` table alone is ~12.2M rows) so it is NEVER
 * scanned end to end: each table is introspected once, then a single indexed
 * lookup is made per place (by slug or page title), and photo rows are joined
 * by file name. Tables/files that are missing are skipped, never fatal.
 *
 * @returns {{ wiki: object, coords: Map<string,{lat:number,lon:number}> }}
 */
function readWikiDb(file, { tables, entries, slugColumn, deadline, progressEvery = DEFAULTS.progressEvery } = {}) {
  const wiki = {};
  const coords = new Map();
  if (!file || !fs.existsSync(file)) {
    log(`wiki: ${file || '(unset)'} not found; skipping`);
    return { wiki, coords };
  }
  const inScope = entries && entries.length ? entries : [];
  if (!inScope.length) {
    log('wiki: no places in scope; skipping lookups');
    return { wiki, coords };
  }
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (err) {
    log(`wiki: cannot open ${file}: ${err.message}; skipping`);
    return { wiki, coords };
  }
  try {
    const present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map((r) => r.name)
    );
    const missing = (tables || []).filter((t) => isTableName(t) && !present.has(t));
    if (missing.length) log(`wiki: table(s) not present: ${missing.join(', ')}`);
    const wanted = (tables || []).filter((t) => isTableName(t) && present.has(t));
    if (!wanted.length) {
      log(`wiki: none of [${(tables || []).join(', ')}] present in ${file}; skipping`);
      return { wiki, coords };
    }

    // Introspect each table once and classify it.
    const specs = wanted.map((table) => {
      const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name);
      const map = wikiColumns(cols, table);
      const keyCol = map.slug || slugColumn || map.title || map.name;
      // A table with only a file key (the real `ph`) is joined by file name.
      const fileKeyed = !keyCol && Boolean(map.file);
      if (fileKeyed) {
        log(`wiki[${table}]: photo table keyed by "${map.file}"`);
      } else {
        log(
          `wiki[${table}]: key="${keyCol || '-'}" extract=${map.extract || '-'}` +
            ` file=${map.file || '-'} population=${map.popValue || '-'}`
        );
      }
      return { table, map, keyCol, fileKeyed, exactOnly: Boolean(map.slug || slugColumn) };
    });
    const primary = specs.filter((s) => !s.fileKeyed);
    const photoTables = specs.filter((s) => s.fileKeyed);

    let matched = 0;
    let seen = 0;
    for (const entry of inScope) {
      seen += 1;
      if (seen % progressEvery === 0) {
        log(`wiki: looked up ${seen.toLocaleString()} place(s)`);
        if (deadline) deadline.guard();
      }
      if (deadline) deadline.guard();

      const merged = { ...(wiki[entry.slug] || {}) };
      let lat = null;
      let lon = null;
      for (const spec of primary) {
        const row = lookupWikiRow(db, spec, entry);
        if (!row) continue;
        const { wiki: part, lat: rlat, lon: rlon } = wikiFromRow(row, spec.map, { defaultPopSource: 'Wikipedia' });
        Object.assign(merged, part);
        if (rlat !== null && rlon !== null && lat === null) {
          lat = rlat;
          lon = rlon;
        }
      }
      // Join the photo/licence table(s) by the image file name from the extract row.
      if (merged.file) {
        for (const spec of photoTables) {
          let row = null;
          try {
            row = db
              .prepare(`SELECT * FROM ${quoteIdent(spec.table)} WHERE ${quoteIdent(spec.map.file)} = ? LIMIT 1`)
              .get(merged.file);
          } catch (err) {
            log(`wiki[${spec.table}]: photo join failed (${err.message})`);
          }
          if (!row) continue;
          const { wiki: part } = wikiFromRow(row, spec.map);
          // A licence/author from `ph` enriches the extract row; never clobber
          // the file name we already have.
          if (part.author) merged.author = part.author;
          if (part.licence) merged.licence = part.licence;
        }
      }

      if (Object.keys(merged).length) {
        wiki[entry.slug] = merged;
        matched += 1;
      }
      if (lat !== null && lon !== null && !coords.has(entry.slug)) coords.set(entry.slug, { lat, lon });
    }
    log(`wiki: matched ${matched} of ${seen} place(s) in scope`);
  } finally {
    db.close();
  }
  return { wiki, coords };
}

// --- Town coordinates ------------------------------------------------------

/**
 * Town coordinate TSV (`--towns`) -> rows keyed by slug (first row wins).
 *
 * The live cache has NO header (`id, name, state, lat, lon`); `--towns-cols`
 * overrides the order, and an unknown file falls back to header detection. The
 * `id` column is positional filler: the slug is derived from the name so it
 * matches the place list.
 */
function readTownCoords(file, { state, cols, deadline, progressEvery = DEFAULTS.progressEvery } = {}) {
  const { headerless, cols: resolved } = resolveColumns({ file, explicit: cols });
  const rows = readTable(file, { delim: delimFor(file), headerless, cols: resolved });
  if (rows === null) {
    log(`towns: ${file} not found; skipping`);
    return [];
  }
  if (!rows.length) return [];
  const columns = headerless ? logicalNames(resolved) : Object.keys(rows[0]);
  const map = headerless
    ? {
        slug: exactField(columns, COLS.slug),
        name: exactField(columns, COLS.name),
        lat: exactField(columns, COLS.lat),
        lon: exactField(columns, COLS.lon),
        state: exactField(columns, COLS.state),
      }
    : {
        slug: detectColumn(columns, COLS.slug),
        name: detectColumn(columns, COLS.name),
        lat: detectColumn(columns, COLS.lat),
        lon: detectColumn(columns, COLS.lon),
        state: detectColumn(columns, COLS.state),
      };
  if (!map.lat || !map.lon) {
    log(`towns: no lat/lon columns in ${file} (saw: ${columns.join(', ')}); skipping`);
    return [];
  }
  const wanted = state ? String(state).toLowerCase() : null;
  const seen = new Set();
  const out = [];
  let n = 0;
  for (const r of rows) {
    n += 1;
    if (n % progressEvery === 0) {
      log(`towns: read ${n.toLocaleString()} row(s)`);
      if (deadline) deadline.guard();
    }
    const lat = Number(pick(r, map.lat));
    const lon = Number(pick(r, map.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (wanted && map.state && String(pick(r, map.state) || '').trim().toLowerCase() !== wanted) continue;
    const slug = map.slug ? String(pick(r, map.slug) || '').trim().toLowerCase() : lib.slugify(pick(r, map.name));
    if (!slug || seen.has(slug)) continue; // duplicate town row - keep the first
    seen.add(slug);
    out.push({ slug, name: String(pick(r, map.name) || '').trim(), lat, lon });
  }
  if (deadline) deadline.guard();
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

/**
 * `/root/aw-wiki/places.tsv` -> `{ slug: [{ name, type, osmUrl }] }`.
 *
 * The live cache has NO header and NO type column; `--places-cols` overrides
 * the order. A missing type column defaults every row to `"place"` rather than
 * dropping the whole file.
 */
function readPlaceNames(file, { entries, cols, deadline, progressEvery = DEFAULTS.progressEvery } = {}) {
  const out = {};
  const { headerless, cols: resolved } = resolveColumns({ file, explicit: cols });
  const rows = readTable(file, { delim: delimFor(file), headerless, cols: resolved });
  if (rows === null) {
    log(`places: ${file} not found; skipping`);
    return out;
  }
  if (!rows.length) return out;
  const columns = headerless ? logicalNames(resolved) : Object.keys(rows[0]);
  const map = headerless
    ? {
        slug: exactField(columns, ['slug', 'key']),
        name: exactField(columns, COLS.name),
        type: exactField(columns, COLS.type),
        url: exactField(columns, ['osm_url', 'url', 'link', 'website']),
      }
    : {
        slug: detectColumn(columns, COLS.slug),
        name: detectColumn(columns, COLS.name),
        type: detectColumn(columns, COLS.type),
        url: detectColumn(columns, ['osm_url', 'url', 'link']),
      };
  if (!map.name) {
    log(`places: need a name column in ${file} (saw: ${columns.join(', ')}); skipping`);
    return out;
  }
  if (!map.type) log(`places: no type column in ${file}; every row defaults to type "place"`);
  const slugSet = new Set(entries.map((e) => e.slug));
  let n = 0;
  for (const r of rows) {
    n += 1;
    if (n % progressEvery === 0) {
      log(`places: read ${n.toLocaleString()} row(s)`);
      if (deadline) deadline.guard();
    }
    const name = String(pick(r, map.name) || '').trim();
    if (!name) continue;
    const type = (map.type ? String(pick(r, map.type) || '').trim() : '') || 'place';
    const slug = map.slug ? String(pick(r, map.slug) || '').trim().toLowerCase() : lib.slugify(name);
    if (!slugSet.has(slug)) continue;
    (out[slug] = out[slug] || []).push({ name, type, osmUrl: pick(r, map.url) || null });
  }
  if (deadline) deadline.guard();
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
  const seen = new Set();
  for (const source of sources) {
    const file = resolveListingFile(source);
    if (!file) continue;
    const rows = rowsFromFile(file);
    if (!rows.length) continue;
    mergeListings(out, seen, bySlug, rows, { source: path.basename(file) });
  }
  return out;
}

// --- Optional MySQL listing source -----------------------------------------

/** Env-file keys that may hold the listings DSN, in priority order. */
const DSN_KEYS = ['LISTINGS_DSN', 'MYSQL_DSN', 'DATABASE_URL'];

/** Read a simple `KEY=VALUE` env file (the path comes from a flag). */
function readEnvFile(file) {
  const text = readText(file);
  if (text === null) {
    log(`listings: env file not found: ${file}; skipping`);
    return null;
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Parse a `mysql://user:pass@host:port/db` DSN into connection details. */
function parseMysqlDsn(dsn) {
  if (!dsn) return null;
  let url;
  try {
    url = new URL(String(dsn).trim());
  } catch {
    return null;
  }
  if (url.protocol.replace(':', '').toLowerCase() !== 'mysql') return null;
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '3306',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
  };
}

const sqlLiteral = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A simple, state-scoped SELECT of the columns the listings schema provides. */
function listingSql({ table = 'listings', state } = {}) {
  const t = isTableName(table) ? table : 'listings';
  let sql = `SELECT name, category, suburb, state, lat, lon, url FROM \`${t}\``;
  if (state) sql += ` WHERE LOWER(state) = ${sqlLiteral(String(state).toLowerCase())}`;
  return sql;
}

/** Run the query through the `mysql` client (password never on argv). */
function runMysqlQuery(cfg, sql) {
  const args = [
    `--host=${cfg.host}`,
    `--port=${cfg.port}`,
    ...(cfg.user ? [`--user=${cfg.user}`] : []),
    ...(cfg.database ? [cfg.database] : []),
    '--batch',
    '--raw',
    '-e',
    sql,
  ];
  const r = spawnSync('mysql', args, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(cfg.password ? { MYSQL_PWD: cfg.password } : {}) },
  });
  if (r.error) {
    log(`listings: mysql client unavailable (${r.error.message}); skipping`);
    return null;
  }
  if (r.status !== 0) {
    const err = String(r.stderr || '').trim().split('\n').pop() || `status ${r.status}`;
    log(`listings: mysql query failed: ${err}`);
    return null;
  }
  return r.stdout;
}

/**
 * Optional MySQL listings source (the directory apps are WordPress/MySQL, not
 * files). The DSN comes from an env file path - never hard-coded - and only a
 * simple `SELECT` for the scoped state is run. With no source configured the
 * listings are skipped with a clear log line.
 */
function readListings({ envFile, table, state, entries, run = runMysqlQuery } = {}) {
  const out = {};
  if (!envFile) return out;
  const env = readEnvFile(envFile);
  if (!env) return out;
  const key = DSN_KEYS.find((k) => env[k]);
  if (!key) {
    log(`listings: no DSN in ${envFile} (looked for ${DSN_KEYS.join(', ')}); skipping`);
    return out;
  }
  const cfg = parseMysqlDsn(env[key]);
  if (!cfg) {
    log(`listings: could not parse the DSN in ${envFile}; skipping`);
    return out;
  }
  const sql = listingSql({ table, state });
  log(`listings: ${cfg.host}/${cfg.database || '-'} table=${isTableName(table) ? table : 'listings'} state=${state || 'all'}`);
  const text = run(cfg, sql);
  if (!text) return out;
  const rows = parseRecords(text, '\t');
  if (!rows.length) {
    log('listings: query returned no rows');
    return out;
  }
  mergeListings(out, new Set(), new Map(entries.map((e) => [e.slug, e])), rows, {
    source: `mysql/${isTableName(table) ? table : 'listings'}`,
  });
  return out;
}

/** Append real, in-scope rows from one source to the listings map. */
function mergeListings(out, seen, bySlug, rows, { source = 'listings' } = {}) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const map = {
    name: detectColumn(cols, COLS.name),
    category: detectColumn(cols, COLS.type),
    url: detectColumn(cols, COLS.url),
    slug: detectColumn(cols, COLS.slug),
    suburb: detectColumn(cols, ['suburb', 'locality', 'city', 'town']),
  };
  if (!map.name || !map.url) {
    log(`${source}: need name+url columns (saw: ${cols.join(', ')}); skipping`);
    return 0;
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
      : lib.slugify(pick(row, map.suburb));
    const place = bySlug.get(slug);
    if (!place) continue;
    if (name.toLowerCase() === place.name.toLowerCase()) continue; // name collision with the place
    const key = `${slug}:${name.toLowerCase()}`;
    if (seen.has(key)) continue; // duplicate listing
    seen.add(key);
    (out[slug] = out[slug] || []).push({ name, category: category || null, url });
    kept += 1;
  }
  log(`${source}: kept ${kept} listing(s)`);
  return kept;
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
 *
 * Scale rule: the place list is scoped by `--country` / `--state` / `--limit`
 * FIRST; the wiki cache is then looked up only for the places left in scope, so
 * the ~1.2 GB `wd.sqlite` is never walked end to end.
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
  const deadline = options.deadline || new Deadline(options.maxSeconds || DEFAULTS.maxSeconds);

  const empty = () => ({ areas: [], wiki: {}, towns: [], places: {}, businesses: {} });

  // 1. Place list (locality CSV). A read failure is fatal - we must never fall
  //    back to walking the whole wiki cache.
  if (!paths.suburbs) {
    log(`place list: no --suburbs file for country=${country}; nothing to prepare`);
    return empty();
  }
  const all = readSuburbs(paths.suburbs, {
    country,
    state,
    cols: paths.suburbsCols,
    deadline,
  });

  // 2. Scope BEFORE any heavy read: country, then state, then the trial limit.
  let scoped = all;
  if (country) scoped = scoped.filter((e) => e.country === country);
  if (state) scoped = scoped.filter((e) => e.state === state);
  if (limit > 0) scoped = scoped.slice(0, limit);
  log(`scope: ${scoped.length} of ${all.length} place(s) (country=${country} state=${state || 'all'} limit=${limit || '-'})`);
  if (!scoped.length) return empty();

  // 3. Wiki cache: only the scoped places, and only by key lookup (never a scan).
  const { wiki, coords: dbCoords } = readWikiDb(paths.wikiDb, {
    tables: wikiTables,
    entries: scoped,
    slugColumn: paths.wikiSlugColumn,
    deadline,
  });

  // 4. Coordinates: unique town rows first, the wiki cache as a fallback.
  //    Uniqueness is computed over the whole state place list (not just the
  //    limited slice), so a shared postcode centroid is still detected.
  const townRows = readTownCoords(paths.towns, { state, cols: paths.townsCols, deadline });
  const townBySlug = new Map(townRows.map((r) => [r.slug, r]));
  const coordRows = [];
  for (const entry of all) {
    const row = townBySlug.get(entry.slug);
    const fromDb = dbCoords.get(entry.slug);
    const lat = row ? row.lat : fromDb ? fromDb.lat : null;
    const lon = row ? row.lon : fromDb ? fromDb.lon : null;
    if (lat === null || lon === null) continue;
    coordRows.push({ slug: entry.slug, name: entry.name, lat, lon });
  }
  const townFlags = new Map(computeUniqueCoords(coordRows).map((t) => [t.slug, t]));
  const towns = scoped.map((e) => townFlags.get(e.slug)).filter(Boolean);
  const coords = new Map(towns.filter((t) => t.unique).map((t) => [t.slug, { lat: t.lat, lon: t.lon }]));
  log(`coords: ${towns.length} town(s), ${coords.size} unique coordinate(s)`);

  // 5. Places: the local place-name TSV plus OSM POIs clipped with osmium.
  //    The clip is the one heavy step, so a --dry-run trial skips it.
  const places = { ...readPlaceNames(paths.places, { entries: scoped, cols: paths.placesCols, deadline }) };
  if (dryRun) {
    log('osm: skipped in dry-run');
  } else {
    const osm = osmPlaces({
      osmFile: paths.osm,
      entries: scoped,
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

  // 6. Businesses: our own directory file sources plus the optional MySQL
  //    listings source. With neither configured this is skipped with a log line.
  const businesses = {};
  if (paths.directories && paths.directories.length) {
    Object.assign(businesses, readDirectories(paths.directories, { entries: scoped }));
  }
  if (paths.listingsEnv) {
    for (const [slug, list] of Object.entries(
      readListings({ envFile: paths.listingsEnv, table: paths.listingsTable, state, entries: scoped })
    )) {
      businesses[slug] = (businesses[slug] || []).concat(list);
    }
  } else if (!paths.directories || !paths.directories.length) {
    log('listings: no MySQL source (--listings-env) or directory file configured; skipping listings');
  }

  // 7. Census: local attributed figures only (never invented).
  if (paths.census) {
    const census = readCensus(paths.census, { entries: scoped });
    for (const [slug, pop] of Object.entries(census)) {
      wiki[slug] = { ...(wiki[slug] || {}), population: pop };
    }
  }

  // 8. Optional, last-resort Wikipedia fill for places still missing an extract.
  if (allowNetwork) {
    for (const entry of scoped) {
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
    wiki,
    towns,
    places,
    businesses,
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
  const maxSeconds = args.maxSeconds ? Number(args.maxSeconds) : DEFAULTS.maxSeconds;
  const dryRun = Boolean(args.dryRun);
  const allowNetwork = Boolean(args.allowNetwork);

  const paths = {
    suburbs: args.suburbs !== undefined ? args.suburbs : defaults.suburbs,
    suburbsCols: args.suburbsCols || process.env.AREAS_SUBURBS_COLS || null,
    towns: args.towns || HOST.towns,
    townsCols: args.townsCols || process.env.AREAS_TOWNS_COLS || null,
    places: args.places || HOST.places,
    placesCols: args.placesCols || process.env.AREAS_PLACES_COLS || null,
    wikiDb: args.wikiDb || HOST.wikiDb,
    wikiSlugColumn: args.wikiSlugColumn || null,
    osm: resolveOsmFile(country, state, args.osmFile),
    directories: args.directories ? String(args.directories).split(',').filter(Boolean) : defaults.directories,
    listingsEnv: args.listingsEnv || process.env.AREAS_LISTINGS_ENV || null,
    listingsTable: args.listingsTable || process.env.AREAS_LISTINGS_TABLE || 'listings',
    census: args.census || null,
  };
  const wikiTables = args.wikiTables ? String(args.wikiTables).split(',').filter(Boolean) : HOST.wikiTables.split(',');

  log(`start country=${country} state=${state || 'all'} out=${outDir} max=${maxSeconds}s network=${allowNetwork ? 'on' : 'off'}${dryRun ? ' dry-run' : ''}`);
  log(`sources: suburbs=${paths.suburbs || '-'} towns=${paths.towns} wiki=${paths.wikiDb} osm=${paths.osm || '-'}`);
  log(`listings: ${paths.listingsEnv ? `env=${paths.listingsEnv} table=${paths.listingsTable}` : 'none configured (skipped)'}`);

  if (!loadGateOk()) {
    log('load gate not ok (main-ok.sh); skipping this run');
    return { skipped: 'load-gate' };
  }
  applyLowPriority();

  const deadline = new Deadline(maxSeconds);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'areas-prepare-'));
  let sources;
  try {
    sources = await collect({ country, state, limit, paths, wikiTables, allowNetwork, dryRun, cacheDir, tmpDir, deadline });
  } catch (err) {
    if (err instanceof TimeBudgetError) {
      log(`stopping: ${err.message} (nothing written)`);
      return { error: 'time-budget' };
    }
    throw err;
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
  resolveColumns,
  computeUniqueCoords,
  readSuburbs,
  readTownCoords,
  readWikiDb,
  readPlaceNames,
  readDirectories,
  readListings,
  readEnvFile,
  parseMysqlDsn,
  listingSql,
  readCensus,
  placesFromGeoJson,
  resolveOsmFile,
  loadGateOk,
  Deadline,
  TimeBudgetError,
  DEFAULTS,
  HOST,
  COUNTRIES,
  KNOWN_CACHE_COLS,
};
