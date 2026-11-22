'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { LOCATIONS } = require('../config/locations');
const { websiteJsonLd } = require('../utils/jsonld');
const { t } = require('../config/i18n');

module.exports = function pageRoutes(app) {
  // --- Home -----------------------------------------------------------------
  app.get('/', (req, res) => {
    const country = config.site.country;
    const counts = ads.categoryCounts({ country });
    const { rows: recent } = ads.searchAds({ country }, { limit: 8 });

    const states = LOCATIONS[country]
      ? Object.entries(LOCATIONS[country].regions).map(([slug, s]) => ({ slug, name: s.name }))
      : [];

    res.render('pages/home', {
      title: `${config.site.name} - ${config.site.tagline}`,
      metaDescription: t('home.metaDescription', { tagline: config.site.tagline, countryName: config.site.countryName }),
      canonical: `${config.site.url}/`,
      jsonLd: websiteJsonLd(),
      counts,
      recent,
      states,
      country,
    });
  });

  // --- Location data for the post form (progressive enhancement) -----------
  app.get('/api/locations', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(LOCATIONS);
  });

  // --- Browse (full index) --------------------------------------------------
  app.get('/browse/', (req, res) => {
    const counts = ads.categoryCounts({});
    res.render('pages/browse', {
      title: t('browse.metaTitle'),
      metaDescription: t('browse.metaDescription', { siteName: config.site.name }),
      canonical: `${config.site.url}/browse/`,
      counts,
    });
  });

  // --- Static / legal pages -------------------------------------------------
  const staticPages = {
    '/privacy/': { view: 'pages/privacy', title: () => t('legal.privacy.title'), desc: () => t('legal.privacy.metaDescription', { siteName: config.site.name }) },
    '/terms/': { view: 'pages/terms', title: () => t('legal.terms.title'), desc: () => t('legal.terms.metaDescription', { siteName: config.site.name }) },
    '/safety/': { view: 'pages/safety', title: () => t('legal.safety.title'), desc: () => t('legal.safety.metaDescription', { siteName: config.site.name }) },
  };

  for (const [path, meta] of Object.entries(staticPages)) {
    app.get(path, (req, res) => {
      res.render(meta.view, {
        title: meta.title(),
        metaDescription: meta.desc(),
        canonical: `${config.site.url}${path}`,
      });
    });
  }
};
