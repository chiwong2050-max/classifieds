'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { categoryName } = require('../config/categories');
const { adUrl, absolute, imageUrl } = require('../utils/urls');
const { hashIp, truncate } = require('../utils/helpers');
const { adJsonLd, breadcrumbJsonLd } = require('../utils/jsonld');
const mailer = require('../services/mailer');
const { actionLimiter } = require('../middleware/rateLimit');
const { turnstileMiddleware } = require('../middleware/turnstile');
const { t } = require('../config/i18n');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function adRoutes(app) {
  // --- Ad detail ------------------------------------------------------------
  app.get('/ad/:publicId/:slug?', (req, res) => {
    const ad = ads.getByPublicId(req.params.publicId);
    if (!ad) {
      return res.status(404).render('pages/error', {
        title: t('ad.notFoundTitle'),
        status: 404,
        message: t('ad.notFoundBody'),
      });
    }

    // Enforce canonical slug for SEO (redirect if missing/incorrect).
    const expected = adUrl(ad);
    const requested = req.params.slug ? `/ad/${ad.public_id}/${req.params.slug}` : `/ad/${ad.public_id}`;
    if (requested !== expected) return res.redirect(301, expected);

    ads.incrementViews(ad.id);
    const images = ads.getImages(ad.id);

    const crumbs = [
      { name: t('breadcrumb.home'), url: '/' },
      { name: ad.country.toUpperCase(), url: `/${ad.country}/` },
      { name: ad.state.toUpperCase(), url: `/${ad.country}/${ad.state}/` },
      { name: ad.city_name, url: `/${ad.country}/${ad.state}/${ad.city}/` },
      { name: categoryName(ad.category), url: `/${ad.country}/${ad.state}/${ad.city}/${ad.category}/` },
      { name: ad.title },
    ];

    const { rows: related } = ads.searchAds(
      { country: ad.country, city: ad.city, category: ad.category },
      { limit: 5 }
    );

    res.render('pages/ad', {
      title: ad.title,
      metaDescription: truncate(ad.description, 155),
      canonical: absolute(expected),
      ogType: 'product',
      ogImage: images.length ? absolute(imageUrl(images[0].filename)) : undefined,
      jsonLd: adJsonLd(ad, images),
      breadcrumbLd: breadcrumbJsonLd(crumbs),
      ad,
      images,
      related: related.filter((r) => r.id !== ad.id),
      crumbs,
      contactOk: req.query.contact === 'ok',
      reportOk: req.query.report === 'ok',
      reportError: req.query.report === 'error',
      turnstileEnabled: config.turnstile.enabled,
      turnstileSiteKey: config.turnstile.siteKey,
    });
  });

  // --- Contact relay (hides the poster's email) -----------------------------
  app.post('/ad/:publicId/contact', actionLimiter, turnstileMiddleware, async (req, res, next) => {
    try {
      const ad = ads.getByPublicId(req.params.publicId);
      if (!ad) return res.status(404).end();

      const body = req.body || {};
      const fromName = String(body.from_name || '').trim();
      const fromEmail = String(body.from_email || '').trim();
      const message = String(body.message || '').trim();

      if (!fromName || !EMAIL_RE.test(fromEmail) || message.length < 5 || message.length > 2000) {
        return res.redirect(`${adUrl(ad)}?contact=error#contact`);
      }

      ads.createContactMessage({ ad_id: ad.id, from_name: fromName, from_email: fromEmail, body: message, ip_hash: hashIp(req.ip) });
      await mailer.sendContactRelay({
        to: ad.contact_email,
        adTitle: ad.title,
        adUrl: absolute(adUrl(ad)),
        fromName,
        fromEmail,
        body: message,
      });

      return res.redirect(`${adUrl(ad)}?contact=ok#contact`);
    } catch (err) {
      return next(err);
    }
  });

  // --- Report an ad ---------------------------------------------------------
  app.post('/ad/:publicId/report', actionLimiter, (req, res, next) => {
    try {
      const ad = ads.getByPublicId(req.params.publicId);
      const reason = String((req.body || {}).reason || '').trim();
      const message = String((req.body || {}).message || '').trim().slice(0, 1000);

      if (!ad || !reason) {
        return res.redirect(`${ad ? adUrl(ad) : '/'}?report=error#report`);
      }

      ads.createReport({ ad_id: ad.id, public_id: ad.public_id, reason, message, ip_hash: hashIp(req.ip) });
      return res.redirect(`${adUrl(ad)}?report=ok#report`);
    } catch (err) {
      return next(err);
    }
  });
};
