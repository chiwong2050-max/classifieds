'use strict';

/**
 * Area pages (AU + US).
 *
 * Covers the file loader (validation, skip-bad-files, richness gate, the
 * Commons-only photo rule, the optional county field), the two environment
 * switches (AREA_PAGES_ENABLED rollout allow-list, AREA_PAGES_INDEXING
 * kill-switch), the area page render (Wikipedia attribution, Commons credit,
 * noindex robots), the empty state for an area with no data, the sitemap
 * gates, the breadcrumb de-duplication, the all-words search fallback and a
 * dry-run of the builder against tiny fixture inputs.
 *
 * The server is pointed at throwaway DB + area directories before it is
 * loaded, so the real database and the tracked fixtures are never touched.
 * No test reaches the network.
 *
 * Run with: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- Isolate the app from real data ----------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'listnear-areas-'));
const AREAS_TMP = path.join(TMP, 'areas');
// Tracked fixtures only: production `data/areas/` output is never committed.
const REPO_AREAS = path.resolve(__dirname, 'fixtures/areas');

fs.cpSync(REPO_AREAS, AREAS_TMP, { recursive: true });
const VIC_DIR = path.join(AREAS_TMP, 'au', 'vic');
fs.mkdirSync(VIC_DIR, { recursive: true });
fs.writeFileSync(path.join(VIC_DIR, 'smalltown.json'), JSON.stringify({ name: 'Smalltown' }));
fs.writeFileSync(path.join(VIC_DIR, 'broken.json'), '{ this is not json');
fs.writeFileSync(path.join(VIC_DIR, 'noname.json'), JSON.stringify({ lga: 'No Name Shire' }));

process.env.NODE_ENV = 'test';
process.env.SITE = 'au';
process.env.DB_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.AREAS_DIR = AREAS_TMP;
process.env.SESSION_SECRET = 'test-secret';
delete process.env.AREA_PAGES_INDEXING;

const areas = require('../src/config/areas');
const config = require('../src/config');
const db = require('../src/db');
const ads = require('../src/db/ads');
const { toFtsPhrase, toFtsAllWords } = require('../src/db/ftsQuery');
const app = require('../src/server');

test('area pages', async (t) => {
  // --- Loader unit checks ---------------------------------------------------
  await t.test('loader validates and skips bad files without crashing', () => {
    const bendigo = areas.loadArea('au', 'vic', 'bendigo');
    assert.ok(bendigo, 'bendigo fixture should load');
    assert.equal(bendigo.name, 'Bendigo');
    assert.equal(bendigo.state, 'vic');
    assert.equal(bendigo.country, 'au');
    assert.ok(bendigo.wiki.extract.length > 20);
    assert.equal(bendigo.wiki.licence, 'CC BY-SA 4.0');
    assert.ok(bendigo.photo.url.startsWith('https://commons.wikimedia.org/'));
    assert.equal(bendigo.population, null);
    assert.equal(bendigo.places.length, 2);

    // A bad file is skipped (null), never thrown.
    assert.equal(areas.loadArea('au', 'vic', 'broken'), null);
    assert.equal(areas.loadArea('au', 'vic', 'noname'), null);
    // A missing area is simply null.
    assert.equal(areas.loadArea('au', 'vic', 'does-not-exist'), null);
    // Unsafe segments never reach the filesystem.
    assert.equal(areas.loadArea('au', 'vic', '..'), null);

    const slugs = areas.listAreas('au', 'vic').map((a) => a.slug).sort();
    assert.deepEqual(slugs, ['ballarat', 'bendigo', 'geelong', 'smalltown']);
  });

  await t.test('loader: NSW (AU) and CA (US) fixtures validate against the schema', () => {
    const newcastle = areas.loadArea('au', 'nsw', 'newcastle');
    assert.ok(newcastle, 'nsw fixture should load');
    assert.equal(newcastle.name, 'Newcastle');
    assert.equal(newcastle.state, 'nsw');
    assert.equal(newcastle.country, 'au');
    assert.equal(newcastle.lga, 'City of Newcastle');
    assert.equal(newcastle.county, null);
    assert.ok(newcastle.wiki.extract.length > 20);
    assert.match(newcastle.photo.url, /^https:\/\/commons\.wikimedia\.org\//);
    assert.deepEqual(areas.listAreas('au', 'nsw').map((a) => a.slug).sort(), ['newcastle']);

    const sacramento = areas.loadArea('us', 'ca', 'sacramento');
    assert.ok(sacramento, 'us fixture should load');
    assert.equal(sacramento.name, 'Sacramento');
    assert.equal(sacramento.state, 'ca');
    assert.equal(sacramento.country, 'us');
    assert.equal(sacramento.lga, null);
    assert.equal(sacramento.county, 'Sacramento County');
    assert.equal(sacramento.population.value, 524943);
    assert.equal(sacramento.population.year, 2020);
    assert.match(sacramento.photo.url, /^https:\/\/commons\.wikimedia\.org\//);
    assert.equal(areas.isRich(sacramento, 0), true);
  });

  await t.test('a non-Commons photo URL is dropped, the rest of the area still loads', () => {
    const dir = path.join(AREAS_TMP, 'us', 'ca');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'badphoto.json'),
      JSON.stringify({
        name: 'Badphoto',
        state: 'ca',
        country: 'us',
        photo: { file: 'x.jpg', url: 'https://example.com/x.jpg' },
      })
    );
    const area = areas.loadArea('us', 'ca', 'badphoto');
    assert.ok(area, 'the area still loads');
    assert.equal(area.photo, null, 'only Wikimedia Commons photos are allowed');
  });

  await t.test('AREA_PAGES_ENABLED rollout allow-list gates rendering only', () => {
    // Unset -> no new restriction: every market with a file renders.
    assert.equal(config.areaPages.isEnabled('au', 'vic'), true);
    assert.equal(config.areaPages.isEnabled('us', 'ca'), true);
    // The indexing kill-switch is untouched by rollout and stays off.
    assert.equal(config.areaPages.indexing, false);

    process.env.AREA_PAGES_ENABLED = 'au:vic';
    try {
      assert.ok(areas.loadArea('au', 'vic', 'bendigo'), 'au:vic stays on');
      assert.equal(areas.loadArea('au', 'nsw', 'newcastle'), null, 'au:nsw is off');
      assert.equal(areas.loadArea('us', 'ca', 'sacramento'), null, 'us is off');
      assert.deepEqual(areas.listAreas('au', 'nsw'), [], 'no nsw area is listed');
    } finally {
      delete process.env.AREA_PAGES_ENABLED;
    }

    process.env.AREA_PAGES_ENABLED = 'au,us:ca';
    try {
      // A bare country code enables every state in it; `us:ca` only that state.
      assert.ok(areas.loadArea('au', 'nsw', 'newcastle'));
      assert.ok(areas.loadArea('us', 'ca', 'sacramento'));
      assert.equal(config.areaPages.isEnabled('us', 'tx'), false);
    } finally {
      delete process.env.AREA_PAGES_ENABLED;
    }
  });

  await t.test('richness gate', () => {
    const bendigo = areas.loadArea('au', 'vic', 'bendigo');
    const smalltown = areas.loadArea('au', 'vic', 'smalltown');
    // Wiki intro + at least two other real sections.
    assert.equal(areas.isRich(bendigo, 0), true);
    // A name-only area is not rich...
    assert.equal(areas.isRich(smalltown, 0), false);
    // ...unless it already has a real post.
    assert.equal(areas.isRich(smalltown, 1), true);
    assert.equal(areas.isRich(null, 5), false);
  });

  await t.test('all-words fallback differs from the exact phrase', () => {
    assert.equal(toFtsPhrase('red frame'), '"red frame"');
    assert.equal(toFtsAllWords('red frame'), '"red" AND "frame"');
    assert.equal(toFtsAllWords('bike'), null);
  });

  // --- Seed one real (test-only) ad for the search fallback -----------------
  const { id: adId } = ads.createAd({
    slug: 'vintage-bicycle-frame',
    title: 'Vintage bicycle frame',
    description: 'A lovely red steel frame, ready to build up.',
    category: 'for-sale',
    country: 'au',
    state: 'vic',
    city: 'shepparton',
    city_name: 'Shepparton',
    price_type: 'free',
    contact_name: 'Test Seller',
    contact_email: 'seller@example.com',
  });
  ads.approveAd(adId);

  // The exact phrase is absent, so only the all-words fallback can match.
  const phraseOnly = db
    .prepare('SELECT COUNT(*) AS n FROM ads_fts WHERE ads_fts MATCH ?')
    .get(toFtsPhrase('red frame')).n;
  assert.equal(phraseOnly, 0, 'the exact phrase should not match');
  assert.ok(ads.searchAds({ country: 'au', q: 'red frame' }).total >= 1, 'all-words fallback should match');

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, html: await res.text() };
  };

  try {
    await t.test('bendigo area page: 200, attribution, Commons credit, noindex', async () => {
      const { status, html } = await get('/au/vic/bendigo/');
      assert.equal(status, 200);
      assert.match(html, /https:\/\/en\.wikipedia\.org\/wiki\/Bendigo/);
      assert.match(html, /commons\.wikimedia\.org/);
      assert.match(html, /<meta name="robots" content="noindex,follow">/);
      assert.match(html, /Free ads in Bendigo/);
      assert.match(html, /Rosalind Park/);
    });

    await t.test('area with no data: clean empty state or 404, never placeholders', async () => {
      // A seeded city with no area file and no posts -> empty state with a post link.
      const melb = await get('/au/vic/melbourne/');
      assert.equal(melb.status, 200);
      assert.match(melb.html, /Post a free ad/);
      assert.doesNotMatch(melb.html, /area-intro/);

      // An unknown town with no data -> 404, not a placeholder page.
      const nowhere = await get('/au/vic/nowheretown/');
      assert.equal(nowhere.status, 404);
    });

    await t.test('breadcrumb never reads "Home › Home"', async () => {
      const { html } = await get('/search?q=bike');
      const nav = html.match(/<nav class="breadcrumbs"[\s\S]*?<\/nav>/)[0];
      assert.equal((nav.match(/Home/g) || []).length, 1, 'exactly one Home crumb');

      const city = await get('/au/vic/bendigo/');
      const cityNav = city.html.match(/<nav class="breadcrumbs"[\s\S]*?<\/nav>/)[0];
      assert.equal((cityNav.match(/Home/g) || []).length, 1);
    });

    await t.test('all-words fallback returns the seeded ad over HTTP', async () => {
      const { html } = await get('/search?q=red+frame');
      assert.match(html, /Vintage bicycle frame/);
    });

    await t.test('sitemap omits area pages while indexing is off', async () => {
      assert.equal(config.areaPages.indexing, false);
      const { html } = await get('/sitemap.xml');
      assert.doesNotMatch(html, /\/au\/vic\/bendigo\//);
      assert.doesNotMatch(html, /\/au\/vic\/smalltown\//);
    });

    await t.test('sitemap lists rich areas only while indexing is on', async () => {
      process.env.AREA_PAGES_INDEXING = 'true';
      try {
        assert.equal(config.areaPages.indexing, true);
        const { html } = await get('/sitemap.xml');
        assert.match(html, /\/au\/vic\/bendigo\//);
        assert.doesNotMatch(html, /\/au\/vic\/smalltown\//);

        // A rich area page becomes indexable; a name-only one stays noindex.
        const rich = await get('/au/vic/bendigo/');
        assert.match(rich.html, /<meta name="robots" content="index,follow">/);
      } finally {
        delete process.env.AREA_PAGES_INDEXING;
      }
    });
    await t.test('sitemap listing needs indexing AND rollout AND richness', async () => {
      delete process.env.AREA_PAGES_ENABLED;
      assert.equal(config.areaPages.indexing, false);
      // Indexing off: nothing listed even though rollout is open.
      assert.doesNotMatch((await get('/sitemap.xml')).html, /\/au\/vic\/bendigo\//);

      process.env.AREA_PAGES_INDEXING = 'true';
      try {
        // Rollout narrowed to au:vic -> the NSW rich page must not be listed.
        process.env.AREA_PAGES_ENABLED = 'au:vic';
        const restricted = await get('/sitemap.xml');
        assert.match(restricted.html, /\/au\/vic\/bendigo\//);
        assert.doesNotMatch(restricted.html, /\/au\/nsw\/newcastle\//);

        // Rollout opened to the whole country -> the NSW rich page appears.
        process.env.AREA_PAGES_ENABLED = 'au';
        const opened = await get('/sitemap.xml');
        assert.match(opened.html, /\/au\/nsw\/newcastle\//);
        // The AU market's sitemap never lists another country's areas.
        assert.doesNotMatch(opened.html, /\/us\/ca\//);
      } finally {
        delete process.env.AREA_PAGES_INDEXING;
        delete process.env.AREA_PAGES_ENABLED;
      }
    });

    await t.test('builder dry-run over tiny fixtures: schema, real km only, no writes', async () => {
      const build = require('../scripts/areas/build');
      const srcDir = path.resolve(__dirname, 'fixtures/areas-src');
      const outDir = path.join(TMP, 'areas-out');

      const result = await build.main([
        '--sources', srcDir, '--out', outDir, '--country', 'au', '--state', 'nsw', '--dry-run',
      ]);
      assert.ok(result.dryRun, 'dry-run mode is reported');
      const bySlug = new Map(result.areas.map((a) => [a.slug, a]));
      assert.deepEqual([...bySlug.keys()].sort(), ['cessnock', 'maitland', 'newcastle']);

      const newcastle = bySlug.get('newcastle');
      assert.ok(newcastle.wiki.extract.length > 20);
      assert.match(newcastle.photo.url, /^https:\/\/commons\.wikimedia\.org\//);
      const maitland = newcastle.nearby.find((n) => n.slug === 'maitland');
      assert.ok(maitland, 'maitland is a neighbour');
      assert.equal(typeof maitland.km, 'number');
      assert.ok(maitland.km > 0 && maitland.km < 120);
      // A postcode-centroid place (no unique coordinate) never becomes a distance.
      assert.equal(newcastle.nearby.some((n) => n.slug === 'cessnock'), false);
      assert.deepEqual(bySlug.get('cessnock').nearby, []);

      // Dry-run writes nothing.
      assert.equal(fs.existsSync(outDir), false);
    });

    await t.test('builder output loads through the real loader', async () => {
      const build = require('../scripts/areas/build');
      const srcDir = path.resolve(__dirname, 'fixtures/areas-src');
      const outDir = path.join(TMP, 'areas-built');
      await build.main(['--sources', srcDir, '--out', outDir, '--country', 'us', '--state', 'ca']);

      const previous = process.env.AREAS_DIR;
      process.env.AREAS_DIR = outDir;
      try {
        const sacramento = areas.loadArea('us', 'ca', 'sacramento');
        assert.ok(sacramento, 'builder output is loadable by areas.js');
        assert.equal(sacramento.county, 'Sacramento County');
        assert.equal(sacramento.population.value, 524943);
        assert.equal(areas.isRich(sacramento, 0), true);
      } finally {
        process.env.AREAS_DIR = previous;
      }
    });
  } finally {
    server.close();
  }
});
