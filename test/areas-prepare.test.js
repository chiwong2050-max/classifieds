'use strict';

/**
 * Area-sources PREPARE step (`scripts/areas/prepare.js`).
 *
 * The prepare step reads the live caches on the data host (a Wikipedia/Commons
 * SQLite cache, Australia Post locality CSVs, town TSVs, OSM extracts, ...) and
 * writes the tidy `--sources` tree that `scripts/areas/build.js` consumes.
 *
 * These tests use tiny fixture stand-ins only - a locality CSV, a town TSV, a
 * place-name TSV and throwaway SQLite DBs built in the temp dir - so there is
 * no real PBF, no osmium and no network. They prove the fixes found on the live
 * data host:
 *   - the live caches carry NO header row, so each known cache has a built-in
 *     column map (with a `--<role>-cols` override) and only an *unknown* file
 *     falls back to header detection;
 *   - a place-name file with no type column defaults every row to "place";
 *   - the ~1.2 GB wiki cache is read by key (en/ex/pop/py/img + ph/file,data),
 *     never full-scanned;
 *   - `--country` / `--state` / `--limit` are applied *before* the wiki lookup;
 *   - a missing place list fails loudly instead of walking the whole cache;
 *   - `--max-seconds` and per-10,000-row progress logs bound a run;
 *   - the directory listings are optional/pluggable (a MySQL DSN from an env
 *     file) and skipped with a log line when none is configured.
 *   - unique vs shared coordinates (a postcode centroid is never a distance);
 *   - the prepared tree is schema-valid (it round-trips through the real loader).
 *
 * Run with: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'listnear-prepare-'));
const FIX = path.resolve(__dirname, 'fixtures/areas-prepare');

// --- Isolate the app from real data ----------------------------------------
process.env.NODE_ENV = 'test';
process.env.SITE = 'au';
process.env.DB_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.AREAS_DIR = path.join(TMP, 'areas-out');
process.env.SESSION_SECRET = 'test-secret';
delete process.env.AREA_PAGES_INDEXING;
delete process.env.AREA_PAGES_ENABLED;

const prepare = require('../scripts/areas/prepare');
const build = require('../scripts/areas/build');
const areas = require('../src/config/areas');

/** Run `fn` while capturing everything logged to the console. */
function captureLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return logs;
}

/** Await `fn` while capturing everything logged to the console. */
async function captureLogsAsync(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return logs;
}

/** A tiny `wd.sqlite`-shaped stand-in: `en` (extracts), `ph` (photos), `it`. */
function makeWikiDb() {
  const file = path.join(TMP, 'wd.sqlite');
  fs.rmSync(file, { force: true }); // fresh cache each call
  const db = new Database(file);
  db.exec('CREATE TABLE en (slug TEXT, title TEXT, extract TEXT, url TEXT)');
  db.exec('CREATE TABLE ph (slug TEXT, file TEXT, author TEXT, licence TEXT)');
  db.exec('CREATE TABLE it (slug TEXT, extract TEXT)');
  const en = db.prepare('INSERT INTO en VALUES (?,?,?,?)');
  en.run(
    'newcastle',
    'Newcastle, New South Wales',
    'Newcastle, also known as Greater Newcastle, is the second-most-populous metropolitan area of New South Wales and the hub of the Lower Hunter region.',
    'https://en.wikipedia.org/wiki/Newcastle,_New_South_Wales'
  );
  en.run(
    'maitland',
    'Maitland, New South Wales',
    'Maitland is a city in the Lower Hunter region of New South Wales, Australia, on the banks of the Hunter River.',
    'https://en.wikipedia.org/wiki/Maitland,_New_South_Wales'
  );
  en.run(
    'cessnock',
    'Cessnock, New South Wales',
    'Cessnock is a city in the Hunter Region of New South Wales, Australia, in the City of Cessnock local government area.',
    'https://en.wikipedia.org/wiki/Cessnock,_New_South_Wales'
  );
  const ph = db.prepare('INSERT INTO ph VALUES (?,?,?,?)');
  ph.run('newcastle', 'The_Custom_House,_Newcastle.jpg', 'Hugh Llewelyn', 'CC BY-SA 2.0');
  ph.run('maitland', 'Maitland_Town_Hall.jpg', 'Example Author', 'CC BY-SA 4.0');
  // Out-of-scope row: its slug is not in the place list, so it is ignored.
  db.prepare('INSERT INTO it VALUES (?,?)').run(
    'melbourne',
    'Melbourne is the capital of the Australian state of Victoria.'
  );
  db.close();
  return file;
}

/**
 * A cache in the *real* data-host schema: `en(title, ex, pop, py, img)` and
 * `ph(file, data)`, plus an `it` table that must never be scanned by default.
 */
function makeRealWikiDb() {
  const file = path.join(TMP, 'wd-real.sqlite');
  fs.rmSync(file, { force: true });
  const db = new Database(file);
  db.exec('CREATE TABLE en (title TEXT, ex TEXT, pop INTEGER, py INTEGER, img TEXT)');
  db.exec('CREATE TABLE ph (file TEXT, data TEXT)');
  db.exec('CREATE TABLE it (title TEXT, ex TEXT)');
  const en = db.prepare('INSERT INTO en VALUES (?,?,?,?,?)');
  en.run(
    'Newcastle, New South Wales',
    'Newcastle is the hub of the Lower Hunter region of New South Wales.',
    322278,
    2021,
    'The_Custom_House,_Newcastle.jpg'
  );
  en.run('Maitland, New South Wales', 'Maitland sits on the banks of the Hunter River.', 90000, 2021, null);
  db.prepare('INSERT INTO ph VALUES (?,?)').run('The_Custom_House,_Newcastle.jpg', 'CC BY-SA 3.0');
  db.prepare('INSERT INTO it VALUES (?,?)').run('Newcastle', 'Newcastle (in Italian)');
  db.close();
  return file;
}

const FIXTURE_ARGS = (extra = []) => [
  '--country', 'au', '--state', 'nsw',
  // The live caches carry NO header row, so the column order is supplied.
  '--suburbs', path.join(FIX, 'ap_suburbs.csv'),
  '--suburbs-cols', 'name,state,postcode,lga',
  '--towns', path.join(FIX, 'towns.tsv'),
  '--places', path.join(FIX, 'places.tsv'),
  '--places-cols', 'slug,name',
  '--wiki-db', makeWikiDb(),
  ...extra,
];

test('area prepare step', async (t) => {
  await t.test('placesFromGeoJson: named features only, OSM ids become URLs', () => {
    const doc = {
      features: [
        { properties: { '@id': 'n123', name: 'Rosalind Park', leisure: 'park' } },
        { properties: { '@id': 'w9', name: 'Bendigo Library', amenity: 'library' } },
        { properties: { '@id': 'n5', amenity: 'park' } }, // unnamed -> dropped
        { properties: { '@id': 'n6', name: 'Mystery' } }, // no type -> dropped
      ],
    };
    const places = prepare.placesFromGeoJson(doc);
    assert.equal(places.length, 2);
    assert.deepEqual(places[0], {
      name: 'Rosalind Park',
      type: 'park',
      osmUrl: 'https://www.openstreetmap.org/node/123',
    });
    assert.equal(places[1].osmUrl, 'https://www.openstreetmap.org/way/9');
  });

  await t.test('computeUniqueCoords: shared point is never unique', () => {
    const rows = [
      { slug: 'a', name: 'A', lat: -32.93, lon: 151.75 },
      { slug: 'b', name: 'B', lat: -32.73, lon: 151.55 },
      { slug: 'c', name: 'C', lat: -32.83, lon: 151.35 },
      { slug: 'd', name: 'D', lat: -32.83, lon: 151.35 },
    ];
    const flagged = prepare.computeUniqueCoords(rows);
    const bySlug = new Map(flagged.map((r) => [r.slug, r.unique]));
    assert.equal(bySlug.get('a'), true);
    assert.equal(bySlug.get('b'), true);
    assert.equal(bySlug.get('c'), false, 'a shared centroid is not unique');
    assert.equal(bySlug.get('d'), false);
  });

  await t.test('known caches use a built-in column map; unknown files fall back to headers', () => {
    assert.deepEqual(prepare.resolveColumns({ file: '/root/ap_suburbs.csv' }), {
      headerless: true,
      cols: 'name,state,postcode,lat,lon',
    });
    assert.deepEqual(prepare.resolveColumns({ file: '/root/as-wiki/towns.tsv' }), {
      headerless: true,
      cols: 'id,name,state,lat,lon',
    });
    assert.deepEqual(prepare.resolveColumns({ file: '/root/aw-wiki/places.tsv' }), {
      headerless: true,
      cols: 'name',
    });
    // A different file name is not known -> header detection.
    assert.deepEqual(prepare.resolveColumns({ file: tempFile('mystery.csv', '') }), {
      headerless: false,
      cols: null,
    });
    // A CLI/env override always wins and forces positional reading.
    assert.deepEqual(prepare.resolveColumns({ file: '/root/ap_suburbs.csv', explicit: 'a,b,c' }), {
      headerless: true,
      cols: 'a,b,c',
    });
  });

  await t.test('readSuburbs reads a header-less cache and a header-ed unknown file', () => {
    const headerless = tempFile(
      'ap_suburbs.csv',
      'Newcastle,NSW,2300,City of Newcastle\nMaitland,NSW,2320,City of Maitland\n'
    );
    const rows = prepare.readSuburbs(headerless, {
      country: 'au',
      state: 'nsw',
      cols: 'name,state,postcode,lga',
    });
    assert.deepEqual(rows.map((r) => r.slug), ['newcastle', 'maitland']);
    assert.equal(rows[0].lga, 'City of Newcastle');

    // An unknown file name still works via header detection.
    const headed = tempFile('other-localities.csv', 'Locality,State,Postcode\nNewcastle,NSW,2300\n');
    const detected = prepare.readSuburbs(headed, { country: 'au', state: 'nsw' });
    assert.equal(detected.length, 1);
    assert.equal(detected[0].slug, 'newcastle');
    assert.equal(detected[0].postcode, '2300');
  });

  await t.test('readSuburbs fails clearly when the place list cannot be read', async () => {
    assert.throws(
      () => prepare.readSuburbs(path.join(TMP, 'nope.csv'), { country: 'au' }),
      /refusing to fall back/
    );
    // The run fails rather than falling back to walking the whole wiki cache.
    await assert.rejects(
      prepare.main(['--country', 'au', '--state', 'nsw', '--suburbs', path.join(TMP, 'nope.csv'), '--dry-run']),
      /refusing to fall back/
    );
  });

  await t.test('readPlaceNames defaults a missing type column to "place"', () => {
    const file = tempFile('places.tsv', 'newcastle\tNewcastle Museum\nnewcastle\tForeshore Park\n');
    const out = prepare.readPlaceNames(file, {
      entries: [{ slug: 'newcastle', name: 'Newcastle' }],
      cols: 'slug,name',
    });
    assert.equal(out.newcastle.length, 2, 'the file is not skipped for want of a type');
    assert.deepEqual(out.newcastle.map((p) => p.type), ['place', 'place']);
    assert.deepEqual(out.newcastle.map((p) => p.name), ['Newcastle Museum', 'Foreshore Park']);
  });

  await t.test('readWikiDb reads the real en(ex,pop,py,img)/ph(file,data) schema by title', () => {
    const { wiki, coords } = prepare.readWikiDb(makeRealWikiDb(), {
      tables: ['en', 'ph'],
      entries: [
        { slug: 'newcastle', name: 'Newcastle' },
        { slug: 'maitland', name: 'Maitland' },
      ],
    });
    // Matched by a strict "Newcastle," title prefix - never a table scan.
    assert.ok(wiki.newcastle.extract.includes('Hunter'));
    assert.equal(wiki.newcastle.file, 'The_Custom_House,_Newcastle.jpg');
    assert.equal(wiki.newcastle.licence, 'CC BY-SA 3.0');
    assert.deepEqual(wiki.newcastle.population, {
      value: 322278,
      year: 2021,
      source: 'Wikipedia',
      sourceUrl: null,
    });
    assert.ok(wiki.maitland.extract.includes('Hunter'));
    assert.equal(wiki.maitland.file, undefined, 'no img -> no photo');
    assert.equal(coords.size, 0);
  });

  await t.test('the time budget stops a run instead of running silently', () => {
    const spent = new prepare.Deadline(1);
    spent.start = Date.now() - 5000; // pretend we already used 5s of a 1s budget
    assert.equal(spent.expired, true);
    assert.throws(() => spent.guard(), prepare.TimeBudgetError);

    const unlimited = new prepare.Deadline(0); // 0 disables the budget
    assert.equal(unlimited.expired, false);
    unlimited.guard(); // never throws

    assert.equal(prepare.DEFAULTS.maxSeconds, 300);
    assert.equal(prepare.DEFAULTS.progressEvery, 10000);
  });

  await t.test('progress is logged every N rows', () => {
    const lines = [];
    for (let i = 0; i < 25; i += 1) lines.push(`Place${i},NSW,2000`);
    const file = tempFile('ap_suburbs.csv', `${lines.join('\n')}\n`);
    const logs = captureLogs(() =>
      prepare.readSuburbs(file, { country: 'au', state: 'nsw', cols: 'name,state,postcode', progressEvery: 10 })
    );
    assert.ok(logs.some((l) => l.includes('read 10 row(s)')));
    assert.ok(logs.some((l) => l.includes('read 20 row(s)')));
  });

  await t.test('the listings source is optional and pluggable', async () => {
    // DSN parsing: mysql only, credentials decoded.
    assert.deepEqual(prepare.parseMysqlDsn('mysql://user:p%40ss@db.internal:3307/directory'), {
      host: 'db.internal',
      port: '3307',
      user: 'user',
      password: 'p@ss',
      database: 'directory',
    });
    assert.equal(prepare.parseMysqlDsn('postgres://x'), null);
    assert.equal(prepare.parseMysqlDsn('not a url'), null);

    // A stubbed runner proves a state-scoped SELECT and category filtering.
    const envFile = tempFile('listings.env', '# listings\nLISTINGS_DSN="mysql://u:p@localhost/db"\n');
    const calls = [];
    const run = (cfg, sql) => {
      calls.push({ cfg, sql });
      return [
        'name\tcategory\tsuburb\tstate\tlat\tlon\turl',
        'Hunter Cafe\tcafe\tNewcastle\tnsw\t\t\thttps://x.example/hunter',
        "Roy's Casino\tcasino\tNewcastle\tnsw\t\t\thttps://x.example/casino",
        '',
      ].join('\n');
    };
    const out = prepare.readListings({
      envFile,
      table: 'listings',
      state: 'nsw',
      entries: [{ slug: 'newcastle', name: 'Newcastle' }],
      run,
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /SELECT name, category, suburb, state, lat, lon, url FROM `listings`/);
    assert.match(calls[0].sql, /LOWER\(state\) = 'nsw'/);
    assert.equal(calls[0].cfg.password, 'p', 'the password never rides on argv');
    assert.equal(out.newcastle.length, 1, 'the denied category (casino) is dropped');
    assert.equal(out.newcastle[0].name, 'Hunter Cafe');

    // With no source configured the run skips listings with a clear log line.
    const logs = await captureLogsAsync(() =>
      prepare.main(FIXTURE_ARGS(['--dry-run', '--out', path.join(TMP, 'listings-dry')]))
    );
    assert.ok(logs.some((l) => l.includes('skipping listings')), 'a clear skip line is logged');
  });

  await t.test('scopes country/state/limit BEFORE the wiki lookup', async () => {
    const outDir = path.join(TMP, 'scope-dry');
    let result;
    const logs = await captureLogsAsync(async () => {
      result = await prepare.main(FIXTURE_ARGS(['--limit', '2', '--dry-run', '--out', outDir]));
    });
    assert.equal(result.sources.areas.length, 2, 'the limit is applied to the place list');
    assert.deepEqual(
      result.sources.areas.map((a) => a.slug),
      ['newcastle', 'maitland']
    );
    // Only the two in-scope places were looked up in the cache.
    assert.deepEqual(Object.keys(result.sources.wiki).sort(), ['maitland', 'newcastle']);
    assert.ok(
      logs.some((l) => l.includes('matched 2 of 2 place(s) in scope')),
      'the wiki cache is queried for the scoped places only'
    );
  });

  await t.test('dry-run computes the tree but writes nothing', async () => {
    const outDir = path.join(TMP, 'prepare-dry');
    const result = await prepare.main(FIXTURE_ARGS(['--dry-run', '--out', outDir]));
    assert.ok(result.dryRun, 'dry-run mode is reported');
    assert.equal(fs.existsSync(outDir), false, 'nothing is written');
    assert.deepEqual(
      result.sources.areas.map((a) => a.slug).sort(),
      ['cessnock', 'kearsley', 'maitland', 'newcastle', 'sydney']
    );
    assert.equal(result.sources.areas.find((a) => a.slug === 'newcastle').lga, 'City of Newcastle');
  });

  await t.test('writes a schema-valid sources tree, unique vs shared coordinates', async () => {
    const outDir = path.join(TMP, 'areas-src');
    const result = await prepare.main(FIXTURE_ARGS(['--out', outDir]));
    assert.ok(result.written.length >= 3, 'areas.csv, wiki.json, towns.tsv are written');

    for (const name of ['areas.csv', 'wiki.json', 'towns.tsv', 'places.json']) {
      assert.ok(fs.existsSync(path.join(outDir, name)), `${name} exists`);
    }

    // areas.csv is exactly the place list the builder expects.
    const csv = fs.readFileSync(path.join(outDir, 'areas.csv'), 'utf8').trim().split('\n');
    assert.equal(csv[0], 'name,state,country,lga,county,slug,postcode');
    assert.equal(csv.length, 6, 'header + five places');
    assert.ok(csv.some((line) => line.startsWith('Newcastle,nsw,au,City of Newcastle,')));

    // towns.tsv: unique only where the coordinate is genuinely unique.
    const rows = fs
      .readFileSync(path.join(outDir, 'towns.tsv'), 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const [slug, , lat, lon, unique] = line.split('\t');
        return { slug, lat, lon, unique };
      });
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    assert.equal(bySlug.get('newcastle').unique, 'true');
    assert.equal(bySlug.get('maitland').unique, 'true');
    assert.equal(bySlug.get('cessnock').unique, 'false', 'shares a point with Kearsley');
    assert.equal(bySlug.get('kearsley').unique, 'false');
    assert.equal(bySlug.get('cessnock').lat, bySlug.get('kearsley').lat);

    // wiki.json: a place with no cache row is simply absent (skipped, not faked).
    const wiki = JSON.parse(fs.readFileSync(path.join(outDir, 'wiki.json'), 'utf8'));
    assert.ok(wiki.newcastle.extract.length > 20);
    assert.equal(wiki.newcastle.file, 'The_Custom_House,_Newcastle.jpg');
    assert.equal(wiki.newcastle.author, 'Hugh Llewelyn');
    assert.ok(wiki.cessnock.extract.length > 20);
    assert.equal(wiki.cessnock.file, undefined, 'no Commons file -> no photo');
    assert.equal(wiki.kearsley, undefined, 'no cache row -> skipped missing wiki');
    assert.equal(wiki.sydney, undefined, 'no cache row -> skipped missing wiki');

    // places.json: the type-less place-name file defaults every row to "place".
    const places = JSON.parse(fs.readFileSync(path.join(outDir, 'places.json'), 'utf8'));
    assert.equal(places.newcastle.length, 2);
    assert.deepEqual(places.newcastle.map((p) => p.type), ['place', 'place']);
  });

  await t.test('a missing wiki cache is skipped without failing', async () => {
    const outDir = path.join(TMP, 'areas-src-nowiki');
    await prepare.main([
      '--country', 'au', '--state', 'nsw',
      '--suburbs', path.join(FIX, 'ap_suburbs.csv'),
      '--suburbs-cols', 'name,state,postcode,lga',
      '--towns', path.join(FIX, 'towns.tsv'),
      '--wiki-db', path.join(TMP, 'does-not-exist.sqlite'),
      '--out', outDir,
    ]);
    const wiki = JSON.parse(fs.readFileSync(path.join(outDir, 'wiki.json'), 'utf8'));
    assert.deepEqual(wiki, {}, 'no wiki cache -> empty wiki.json, never invented');
    assert.ok(fs.existsSync(path.join(outDir, 'towns.tsv')), 'the rest of the tree is still written');
  });

  await t.test('prepared tree builds and loads through the real schema', async () => {
    const srcDir = path.join(TMP, 'areas-src-build');
    await prepare.main(FIXTURE_ARGS(['--out', srcDir]));

    const outDir = path.join(TMP, 'areas-built');
    await build.main(['--sources', srcDir, '--out', outDir, '--country', 'au', '--state', 'nsw']);

    const previous = process.env.AREAS_DIR;
    process.env.AREAS_DIR = outDir;
    try {
      const newcastle = areas.loadArea('au', 'nsw', 'newcastle');
      assert.ok(newcastle, 'prepared+built output loads through areas.js');
      assert.equal(newcastle.name, 'Newcastle');
      assert.equal(newcastle.lga, 'City of Newcastle');
      assert.ok(newcastle.wiki.extract.length > 20);
      assert.match(newcastle.photo.url, /^https:\/\/commons\.wikimedia\.org\//);
      assert.equal(newcastle.places.length, 2);

      // Distances come from unique coordinates only: Maitland is a neighbour,
      // the postcode-centroid pair (Cessnock/Kearsley) is not.
      const neigh = newcastle.nearby.map((n) => n.slug);
      assert.ok(neigh.includes('maitland'));
      assert.equal(neigh.includes('cessnock'), false);
      assert.equal(neigh.includes('kearsley'), false);

      // A place with no wiki row still renders a valid area (empty sections).
      const kearsley = areas.loadArea('au', 'nsw', 'kearsley');
      assert.ok(kearsley, 'kearsley (no wiki) is still a valid area');
      assert.equal(kearsley.wiki, null);
      assert.equal(kearsley.photo, null);
      assert.deepEqual(kearsley.nearby, []);
      assert.equal(areas.isRich(kearsley, 0), false);
    } finally {
      process.env.AREAS_DIR = previous;
    }
  });
});

/** Write a throwaway fixture file into the temp dir; returns its path. */
function tempFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(TMP, 'file-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}
