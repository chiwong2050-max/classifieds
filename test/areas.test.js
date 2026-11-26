'use strict';

/**
 * Area pages (Victoria, Australia).
 *
 * Covers the file loader (validation, skip-bad-files, richness gate), the
 * area page render (Wikipedia attribution, Commons credit, kill-switch robots),
 * the empty state for an area with no data, the sitemap richness gate, the
 * breadcrumb de-duplication and the all-words search fallback.
 *
 * The server is pointed at throwaway DB + area directories before it is
 * loaded, so the real database and the committed fixtures are never touched.
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
const REPO_AREAS = path.resolve(__dirname, '../data/areas');

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
  } finally {
    server.close();
  }
});
