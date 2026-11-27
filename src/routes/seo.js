'use strict';

const config = require('../config');
const ads = require('../db/ads');
const areas = require('../config/areas');
const { adUrl } = require('../utils/urls');

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  const parts = [`<loc>${escapeXml(loc)}</loc>`];
  if (lastmod) parts.push(`<lastmod>${escapeXml(lastmod)}</lastmod>`);
  if (changefreq) parts.push(`<changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`<priority>${priority}</priority>`);
  return `  <url>\n    ${parts.join('\n    ')}\n  </url>`;
}

function toLastmod(sqliteDate) {
  if (!sqliteDate) return null;
  return `${sqliteDate.slice(0, 10)}`;
}

module.exports = function seoRoutes(app) {
  // --- robots.txt ----------------------------------------------------------
  app.get('/robots.txt', (req, res) => {
    const lines = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /manage/',
      'Disallow: /verify/',
      'Disallow: /search',
      'Disallow: /post/',
      '',
      `Sitemap: ${config.site.url}/sitemap.xml`,
      '',
    ];
    res.type('text/plain').send(lines.join('\n'));
  });

  // --- sitemap.xml ---------------------------------------------------------
  app.get('/sitemap.xml', (req, res) => {
    const urls = [];

    // Core pages.
    urls.push({ loc: `${config.site.url}/`, changefreq: 'daily', priority: '1.0' });
    urls.push({ loc: `${config.site.url}/browse/`, changefreq: 'daily', priority: '0.8' });
    for (const p of ['/about/', '/contact/', '/privacy/', '/terms/', '/safety/']) {
      urls.push({ loc: `${config.site.url}${p}`, changefreq: 'monthly', priority: '0.3' });
    }

    // Location + category pages that currently have active ads.
    const seen = new Set();
    for (const row of ads.distinctActiveCategoryLocations()) {
      const base = `/${row.country}/${row.state}/${row.city}/`;
      const loc = `${config.site.url}${base}`;
      if (!seen.has(loc)) {
        seen.add(loc);
        urls.push({ loc, changefreq: 'daily', priority: '0.7' });
      }
      const catLoc = `${config.site.url}${base}${row.category}/`;
      if (!seen.has(catLoc)) {
        seen.add(catLoc);
        urls.push({ loc: catLoc, changefreq: 'daily', priority: '0.6' });
      }
    }

    // Area pages. Listed only when the indexing kill-switch is on AND the page
    // is rich (a Wikipedia intro plus two real sections, or a real post).
    // `listAreas` also honours the AREA_PAGES_ENABLED rollout allow-list, so a
    // disabled country/state can never be listed here.
    if (config.areaPages.indexing) {
      for (const area of areas.listAreas(config.site.country)) {
        const postCount = ads.countByLocation(area.country, area.state, area.slug);
        if (!areas.isRich(area, postCount)) continue;
        const loc = `${config.site.url}/${area.country}/${area.state}/${area.slug}/`;
        if (seen.has(loc)) continue;
        seen.add(loc);
        urls.push({ loc, changefreq: 'weekly', priority: '0.6' });
      }
    }

    // Live ad detail pages.
    for (const ad of ads.allActiveForSitemap()) {
      urls.push({
        loc: `${config.site.url}${adUrl(ad)}`,
        lastmod: toLastmod(ad.updated_at || ad.published_at),
        changefreq: 'weekly',
        priority: '0.6',
      });
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(urlEntry),
      '</urlset>',
      '',
    ].join('\n');

    res.type('application/xml').send(xml);
  });
};
