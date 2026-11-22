'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { LOCATIONS } = require('../config/locations');
const { websiteJsonLd } = require('../utils/jsonld');

module.exports = function pageRoutes(app) {
  // --- Home -----------------------------------------------------------------
  app.get('/', (req, res) => {
    const country = config.site.defaultCountry;
    const counts = ads.categoryCounts({ country });
    const { rows: recent } = ads.searchAds({ country }, { limit: 8 });

    const states = LOCATIONS[country]
      ? Object.entries(LOCATIONS[country].states).map(([slug, s]) => ({ slug, name: s.name }))
      : [];

    res.render('pages/home', {
      title: `${config.site.name} - ${config.site.tagline}`,
      metaDescription: `${config.site.tagline}. Browse jobs, cars, property, services and more across Australia. No personals or adult content - every ad is reviewed.`,
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
      title: 'Browse all categories and locations',
      metaDescription: 'Browse every category and location on Classifieds - jobs, for sale, vehicles, property, services, community, pets and events.',
      canonical: `${config.site.url}/browse/`,
      counts,
    });
  });

  // --- Static / legal pages -------------------------------------------------
  const staticPages = {
    '/privacy/': { view: 'pages/privacy', title: 'Privacy Policy', desc: 'How Classifieds collects, uses and protects your personal information.' },
    '/terms/': { view: 'pages/terms', title: 'Terms of Use', desc: 'The rules for using Classifieds, including our family-safe content policy.' },
    '/safety/': { view: 'pages/safety', title: 'Safety Tips', desc: 'Practical tips to stay safe when buying and selling on Classifieds.' },
  };

  for (const [path, meta] of Object.entries(staticPages)) {
    app.get(path, (req, res) => {
      res.render(meta.view, {
        title: meta.title,
        metaDescription: meta.desc,
        canonical: `${config.site.url}${path}`,
      });
    });
  }
};
