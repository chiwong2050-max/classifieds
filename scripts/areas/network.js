'use strict';

/**
 * Optional, last-resort network lookup for the area builder.
 *
 * The builder reads local caches first; this module is only ever called when
 * `--allow-network` is passed AND a place has no Wikipedia extract in the local
 * cache. Requests are rate-limited to one per second and every response is
 * cached on disk, so a re-run never re-fetches.
 *
 * Nothing here invents data: on any failure it returns null and the caller
 * leaves the field empty.
 */

const fs = require('fs');
const path = require('path');

let lastCallAt = 0;

async function politeFetchJson(url, { minIntervalMs = 1000, timeoutMs = 10000 } = {}) {
  const wait = lastCallAt + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
  const res = await fetch(url, {
    headers: { 'user-agent': 'ListNear-area-builder/1.0 (+https://listnear.app)' },
    // A batch job must never hang on one slow host.
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Wikipedia summary for a title, cached under `<cacheDir>/wiki/`.
 * @returns {Promise<{extract:string, title:string, url:string}|null>}
 */
async function wikiSummary(title, { cacheDir, minIntervalMs } = {}) {
  if (!title) return null;
  const key = encodeURIComponent(title).replace(/%20/g, '_').replace(/\//g, '_');
  const cacheFile = path.join(cacheDir, 'wiki', `${key}.json`);

  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      /* fall through and re-fetch */
    }
  }

  const data = await politeFetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { minIntervalMs }
  );
  const extract = data && typeof data.extract === 'string' ? data.extract.trim() : '';
  if (!extract) return null;

  const desktop = data.content_urls && data.content_urls.desktop;
  const out = {
    extract,
    title: data.title || title,
    url: (desktop && desktop.page) || null,
  };
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

module.exports = { wikiSummary };
