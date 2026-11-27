'use strict';

/**
 * Area-sources PREPARE step (`scripts/areas/prepare.js`).
 *
 * The prepare step reads the live caches on the data host (a Wikipedia/Commons
 * SQLite cache, Australia Post locality CSVs, town TSVs, OSM extracts, ...) and
 * writes the tidy `--sources` tree that `scripts/areas/build.js` consumes.
 *
 * These tests use tiny fixture stand-ins only - a locality CSV, a town TSV, a
 * place-name TSV and a throwaway SQLite DB built in the temp dir - so there is
 * no real PBF, no osmium and no network. They prove:
 *   - unique vs shared coordinates (a postcode centroid is never a distance);
 *   - a place with no wiki row is skipped, leaving the rest of the area intact;
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

const FIXTURE_ARGS = (extra = []) => [
  '--country', 'au', '--state', 'nsw',
  '--suburbs', path.join(FIX, 'ap_suburbs.csv'),
  '--towns', path.join(FIX, 'towns.tsv'),
  '--places', path.join(FIX, 'places.tsv'),
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
  });

  await t.test('a missing wiki cache is skipped without failing', async () => {
    const outDir = path.join(TMP, 'areas-src-nowiki');
    await prepare.main([
      '--country', 'au', '--state', 'nsw',
      '--suburbs', path.join(FIX, 'ap_suburbs.csv'),
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
