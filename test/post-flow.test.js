'use strict';

/**
 * Post -> verify -> owner follow-through.
 *
 * Exercises the real HTTP flow end to end against a throwaway database:
 *   - the post form renders and re-renders kindly on missing fields (400, not
 *     500/blank);
 *   - a valid post issues one verification token, emails a magic link built
 *     from the *current market's* public origin, and creates no ad yet;
 *   - following the link creates a pending ad and shows the private manage
 *     link; a used/expired/unknown link shows a plain page that offers a fresh
 *     link (never a 500);
 *   - the honeypot and the family-safe keyword checks are not weakened;
 *   - the owner can view and renew via the existing magic-link pattern, and a
 *     pending or rejected ad can never be pushed live by renewing;
 *   - empty city and area pages invite posting with a consistent prefilled
 *     `/post/?country=&state=&city=` link;
 *   - Turnstile is a no-op with no keys, and rejects a missing/invalid token
 *     (and accepts a valid one) when keys are set - using a stubbed siteverify,
 *     never real keys or the network.
 *
 * The server is pointed at a temp DB + area directory before it is loaded, so
 * the real database is never touched. Requests are real HTTP so the Host-based
 * market resolution and the public origin are tested as they behave in
 * production. No test reaches the network.
 *
 * Run with: `npm test` (node --test).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// --- Isolate the app from real data ----------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'listnear-postflow-'));

process.env.NODE_ENV = 'test';
process.env.SITE = 'au';
process.env.DB_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
// Tracked fixtures only (derived area files are never committed).
process.env.AREAS_DIR = path.resolve(__dirname, 'fixtures/areas');
process.env.SESSION_SECRET = 'test-secret';
process.env.MAIL_TRANSPORT = 'console';
delete process.env.AREA_PAGES_INDEXING;
delete process.env.ADS_ENABLED;
delete process.env.TURNSTILE_SITE_KEY;
delete process.env.TURNSTILE_SECRET_KEY;

const config = require('../src/config');
const { siteFor } = require('../src/config/market');
const db = require('../src/db');
const ads = require('../src/db/ads');
const app = require('../src/server');

// The market origins the email must use (apex = US, cc subdomain = others).
const AU_ORIGIN = siteFor('au').url;
const US_ORIGIN = siteFor('us').url;

let server;

before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// --- Tiny HTTP client (real requests; explicit Host for multi-market) ------
function httpRequest(method, reqPath, opts = {}) {
  const { host = 'au.listnear.app', form, cookie, headers = {} } = opts;
  const payload = form ? new URLSearchParams(form).toString() : null;

  const reqHeaders = { ...headers };
  if (payload) {
    reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    reqHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) reqHeaders.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        method,
        path: reqPath,
        // Keep our explicit Host so the market is resolved from it, not from
        // the loopback address.
        setHost: false,
        headers: { Host: host, ...reqHeaders },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { out += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const postForm = (reqPath, fields, opts = {}) => httpRequest('POST', reqPath, { ...opts, form: fields });

function sessionCookie(res) {
  const set = res.headers['set-cookie'];
  if (!set) return null;
  const raw = Array.isArray(set) ? set[0] : set;
  return raw.split(';')[0];
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

// Any page that calls provideCsrf establishes a session + token. The manage
// page only renders the renew form for an approved ad, so for pending/rejected
// cases we take the session token from the admin sign-in page instead - CSRF is
// per session, not per route.
async function sessionForCsrf(host) {
  const res = await httpRequest('GET', '/admin/login', { host });
  return { csrf: csrfFrom(res.body), cookie: sessionCookie(res) };
}

function countAds(email) {
  return db.prepare('SELECT COUNT(*) AS n FROM ads WHERE contact_email = ?').get(email).n;
}

// A complete, valid submission.
const GOOD = {
  category: 'for-sale',
  title: 'Vintage road bike in great condition',
  description: 'A well maintained vintage road bike, recently serviced and ready to ride.',
  country: 'au',
  state: 'vic',
  city: 'melbourne',
  price_type: 'fixed',
  price: '120',
  contact_name: 'Test Poster',
  contact_email: 'poster@example.com',
  agree: 'yes',
};

// A complete ad payload as the post route would store it inside a verification
// token (the route computes the slug and resolves the city before this point).
function adPayload(email, title, publicId) {
  return {
    ad: {
      public_id: publicId || 'resendad1',
      slug: 'resend-flow-test-bike-abcd',
      title,
      description: 'A well maintained vintage road bike, recently serviced and ready to ride.',
      category: 'for-sale',
      country: 'au',
      state: 'vic',
      city: 'melbourne',
      city_name: 'Melbourne',
      price_cents: 12000,
      price_type: 'fixed',
      currency: 'AUD',
      attrs: {},
      contact_name: 'Resend Tester',
      contact_email: email,
      status: 'pending',
      is_flagged: false,
      flag_reasons: [],
    },
    images: [],
  };
}

let verifyToken = null;
let manageToken = null;

test('post -> verify -> owner follow-through', async (t) => {
  // ---------------------------------------------------------------------
  // 1. Post and verify
  // ---------------------------------------------------------------------
  await t.test('the post form renders', async () => {
    const res = await httpRequest('GET', '/post/');
    assert.equal(res.status, 200);
    assert.match(res.body, /name="title"/);
  });

  await t.test('missing fields re-render the form kindly (HTTP 400, not a 500)', async () => {
    const res = await postForm('/post/', { ...GOOD, title: 'hi' });
    assert.equal(res.status, 400);
    // A plain, kind error on the form itself - not a blank page.
    assert.match(res.body, /Please enter a title of at least 6 characters/);
    assert.match(res.body, /name="title"/);
  });

  await t.test('a valid post returns verify-sent, stores one token, sends a magic link from the market origin', async () => {
    const captured = [];
    const originalLog = console.log;
    console.log = (...args) => { captured.push(args.join(' ')); };
    let res;
    try {
      res = await postForm('/post/', GOOD);
    } finally {
      console.log = originalLog;
    }

    assert.equal(res.status, 200);
    assert.match(res.body, /Check your email/);
    assert.ok(res.body.includes(GOOD.contact_email), 'verify-sent names the address');

    // No ad is created until the link is followed.
    assert.equal(countAds(GOOD.contact_email), 0);

    const pending = ads.latestPendingVerificationToken(GOOD.contact_email);
    assert.ok(pending, 'one pending verification token exists');
    assert.ok(pending.payload && pending.payload.ad, 'the token carries the ad payload');
    verifyToken = pending.token;

    // The magic-link email prints the current market's public origin.
    assert.ok(
      captured.join('\n').includes(`${AU_ORIGIN}/verify/`),
      `the magic link should use ${AU_ORIGIN}`
    );
  });

  await t.test('following the link creates a pending ad and shows the private manage link', async () => {
    const res = await httpRequest('GET', `/verify/${verifyToken}`);
    assert.equal(res.status, 200);
    const m = res.body.match(/\/manage\/([A-Za-z0-9_-]+)/);
    assert.ok(m, 'post-success page shows the manage link');
    manageToken = m[1];

    const ad = ads.getByManageToken(manageToken);
    assert.ok(ad, 'the ad now exists');
    assert.equal(ad.status, 'pending');
    assert.equal(ad.contact_email, GOOD.contact_email);
    assert.equal(countAds(GOOD.contact_email), 1);
  });

  await t.test('re-using the link shows a kind "already used" page (HTTP 400), not a 500', async () => {
    const res = await httpRequest('GET', `/verify/${verifyToken}`);
    assert.equal(res.status, 400);
    assert.match(res.body, /already been used/i);
    assert.match(res.body, /action="\/post\/resend"/);
    // Still exactly one ad - a re-used link never creates a second.
    assert.equal(countAds(GOOD.contact_email), 1);
  });

  await t.test('an unknown link shows a kind page with a resend form', async () => {
    const res = await httpRequest('GET', '/verify/not-a-real-token-at-all');
    assert.equal(res.status, 400);
    assert.match(res.body, /Post your ad again/);
    assert.match(res.body, /action="\/post\/resend"/);
  });

  await t.test('an expired link shows the expired message and a resend form', async () => {
    const token = ads.createVerificationToken({
      email: 'expired@example.com',
      payload: { ad: { title: 'x' }, images: [] },
      ttlMinutes: -5,
    });
    const res = await httpRequest('GET', `/verify/${token}`);
    assert.equal(res.status, 400);
    assert.match(res.body, /expired/i);
    assert.match(res.body, /action="\/post\/resend"/);
  });

  // ---------------------------------------------------------------------
  // Spam / family-safe checks are not weakened
  // ---------------------------------------------------------------------
  await t.test('a prohibited keyword is still flagged and held for human review', async () => {
    const res = await postForm('/post/', {
      ...GOOD,
      contact_email: 'flagged@example.com',
      title: 'Cheap escorts available tonight',
      description: 'Adult escorts available in the city centre tonight, call now.',
    });
    assert.equal(res.status, 200);
    const pending = ads.latestPendingVerificationToken('flagged@example.com');
    assert.ok(pending);
    assert.equal(pending.payload.ad.is_flagged, true);
    assert.equal(pending.payload.ad.status, 'pending');
  });

  await t.test('the honeypot still drops bots without creating a token', async () => {
    const email = 'bot@example.com';
    const before = db
      .prepare('SELECT COUNT(*) AS n FROM verification_tokens WHERE email = ?')
      .get(email).n;
    const res = await postForm('/post/', { ...GOOD, contact_email: email, website: 'https://spam.example' });
    assert.equal(res.status, 200);
    const after = db
      .prepare('SELECT COUNT(*) AS n FROM verification_tokens WHERE email = ?')
      .get(email).n;
    assert.equal(after, before, 'no token is created for a honeypot hit');
  });

  // ---------------------------------------------------------------------
  // 2. Owner follow-through
  // ---------------------------------------------------------------------
  await t.test('resending issues a fresh link, invalidates the old one and never creates two ads', async () => {
    const email = 'resend@example.com';
    const first = ads.createVerificationToken({ email, payload: adPayload(email, 'Resend flow test bike') });

    const res = await postForm('/post/resend', { contact_email: email });
    assert.equal(res.status, 200);
    assert.match(res.body, /fresh verification link/);

    // The old link is now spent.
    const old = await httpRequest('GET', `/verify/${first}`);
    assert.equal(old.status, 400);

    const second = ads.latestPendingVerificationToken(email);
    assert.ok(second && second.token !== first, 'a brand-new token was issued');

    const ok = await httpRequest('GET', `/verify/${second.token}`);
    assert.equal(ok.status, 200);
    assert.equal(countAds(email), 1, 'a resend can never create two ads');
  });

  await t.test('resending for an invalid address is refused kindly', async () => {
    const res = await postForm('/post/resend', { contact_email: 'not-an-email' });
    assert.equal(res.status, 400);
    assert.match(res.body, /valid email address/i);
  });

  await t.test('the manage page for a pending ad explains and offers no renew form', async () => {
    const res = await httpRequest('GET', `/manage/${manageToken}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /waiting for review/i);
    assert.ok(!res.body.includes(`action="/manage/${manageToken}/renew"`), 'no renew form for a pending ad');
  });

  await t.test('renew is refused for a pending ad (no moderation bypass)', async () => {
    // The pending manage page renders no renew form, so obtain a CSRF token
    // from a page that always issues one (the admin sign-in form).
    const { csrf, cookie } = await sessionForCsrf('au.listnear.app');
    assert.ok(csrf && cookie, 'a CSRF token and session are available');

    const res = await postForm(`/manage/${manageToken}/renew`, { _csrf: csrf }, { cookie });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/manage/${manageToken}`);
    assert.equal(ads.getByManageToken(manageToken).status, 'pending');
  });

  await t.test('an approved/expired ad can be renewed from the manage page', async () => {
    const id = ads.getByManageToken(manageToken).id;
    db.prepare("UPDATE ads SET status='expired', expires_at='2020-01-01 00:00:00', renewed_at=NULL WHERE id = ?").run(id);

    const page = await httpRequest('GET', `/manage/${manageToken}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Renew for another/);
    const csrf = csrfFrom(page.body);
    const cookie = sessionCookie(page);

    const res = await postForm(`/manage/${manageToken}/renew`, { _csrf: csrf }, { cookie });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/manage/${manageToken}?renewed=ok`);

    const after = ads.getByManageToken(manageToken);
    assert.equal(after.status, 'active');
    assert.ok(after.renewed_at, 'renewal is recorded');
    assert.notEqual(after.expires_at, '2020-01-01 00:00:00');
  });

  await t.test('the manage page for a rejected ad explains and renew stays refused', async () => {
    const created = ads.createAd({
      public_id: 'rejtest1',
      slug: 'rejected-ad',
      title: 'A rejected ad',
      description: 'This ad will be rejected for the test.',
      category: 'for-sale',
      country: 'au',
      state: 'vic',
      city: 'melbourne',
      city_name: 'Melbourne',
      contact_name: 'Reject Tester',
      contact_email: 'reject@example.com',
      status: 'pending',
    });
    ads.rejectAd(created.id, 'Prohibited item');

    const res = await httpRequest('GET', `/manage/${created.manage_token}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /not approved/i);

    // The rejected manage page renders no renew form; get CSRF from a page
    // that always issues one, then confirm the renew is still refused.
    const { csrf, cookie } = await sessionForCsrf('au.listnear.app');
    const post = await postForm(`/manage/${created.manage_token}/renew`, { _csrf: csrf }, { cookie });
    assert.equal(post.status, 302);
    assert.equal(ads.getByManageToken(created.manage_token).status, 'rejected');
  });

  await t.test('an unknown manage token shows the not-found page, not a 500', async () => {
    const res = await httpRequest('GET', '/manage/nope-nope-nope');
    assert.equal(res.status, 404);
  });

  // ---------------------------------------------------------------------
  // 3. Empty state, prefill and email origin
  // ---------------------------------------------------------------------
  await t.test('an empty city page invites posting with a consistent prefilled link', async () => {
    // Warrnambool is a seeded AU city with no ads and no area file.
    const res = await httpRequest('GET', '/au/vic/warrnambool/');
    assert.equal(res.status, 200);
    assert.match(res.body, /Be the first to post/);
    assert.match(res.body, /\/post\/\?country=au&state=vic&city=warrnambool&category=/);
  });

  await t.test('an area page invites posting with the same prefilled link', async () => {
    const res = await httpRequest('GET', '/au/vic/bendigo/');
    assert.equal(res.status, 200);
    assert.match(res.body, /\/post\/\?country=au&state=vic&city=bendigo&category=/);
  });

  await t.test('the magic-link email uses the market origin - US apex included', async () => {
    // Per-market origins: the apex is the US, others are <cc>.listnear.app.
    assert.equal(AU_ORIGIN, 'https://au.listnear.app');
    assert.equal(US_ORIGIN, 'https://listnear.app');

    // End to end from the US apex host: the emailed link uses that origin.
    const captured = [];
    const originalLog = console.log;
    console.log = (...args) => { captured.push(args.join(' ')); };
    let res;
    try {
      res = await postForm(
        '/post/',
        { ...GOOD, country: 'us', state: 'ca', city: 'sacramento', contact_email: 'us@example.com' },
        { host: 'listnear.app' }
      );
    } finally {
      console.log = originalLog;
    }
    assert.equal(res.status, 200);
    assert.ok(captured.join('\n').includes(`${US_ORIGIN}/verify/`), `the magic link should use ${US_ORIGIN}`);
  });

  // ---------------------------------------------------------------------
  // 4. Turnstile
  // ---------------------------------------------------------------------
  await t.test('Turnstile', async (tt) => {
    const originalFetch = global.fetch;
    tt.after(() => {
      global.fetch = originalFetch;
      delete process.env.TURNSTILE_SITE_KEY;
      delete process.env.TURNSTILE_SECRET_KEY;
    });

    await tt.test('is a no-op when the keys are empty (posting still works)', async () => {
      delete process.env.TURNSTILE_SITE_KEY;
      delete process.env.TURNSTILE_SECRET_KEY;
      assert.equal(config.turnstile.enabled, false);

      const res = await postForm('/post/', {
        ...GOOD,
        contact_email: 'turn-off@example.com',
        title: 'Turnstile disabled bike listing',
      });
      assert.equal(res.status, 200);
      assert.match(res.body, /Check your email/);
    });

    await tt.test('rejects a missing token when keys are set (no siteverify call)', async () => {
      process.env.TURNSTILE_SITE_KEY = 'test-site-key';
      process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
      assert.equal(config.turnstile.enabled, true);

      let called = false;
      global.fetch = async () => { called = true; return { json: async () => ({ success: true }) }; };

      const res = await postForm('/post/', {
        ...GOOD,
        contact_email: 'turn-missing@example.com',
        title: 'Turnstile missing token bike',
      });
      assert.equal(res.status, 400);
      assert.match(res.body, /could not verify that you are human/i);
      assert.equal(called, false, 'no token means no call to siteverify');
    });

    await tt.test('rejects an invalid token when keys are set', async () => {
      process.env.TURNSTILE_SITE_KEY = 'test-site-key';
      process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
      global.fetch = async () => ({ json: async () => ({ success: false }) });

      const res = await postForm('/post/', {
        ...GOOD,
        contact_email: 'turn-bad@example.com',
        title: 'Turnstile invalid token bike',
        'cf-turnstile-response': 'bad-token',
      });
      assert.equal(res.status, 400);
      assert.match(res.body, /could not verify that you are human/i);
    });

    await tt.test('accepts a valid token (stubbed siteverify) when keys are set', async () => {
      process.env.TURNSTILE_SITE_KEY = 'test-site-key';
      process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
      global.fetch = async () => ({ json: async () => ({ success: true }) });

      const res = await postForm('/post/', {
        ...GOOD,
        contact_email: 'turn-good@example.com',
        title: 'Turnstile valid token bike',
        'cf-turnstile-response': 'good-token',
      });
      assert.equal(res.status, 200);
      assert.match(res.body, /Check your email/);
    });
  });
});
