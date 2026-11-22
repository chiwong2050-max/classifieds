'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { adUrl, absolute } = require('../utils/urls');
const { t } = require('../config/i18n');

module.exports = function manageRoutes(app) {
  // --- Manage / renew an ad via its private token ---------------------------
  app.get('/manage/:token', (req, res) => {
    const ad = ads.getByManageToken(req.params.token);
    if (!ad) {
      return res.status(404).render('pages/error', {
        title: t('manage.notFoundTitle'),
        status: 404,
        message: t('manage.notFoundBody'),
      });
    }

    res.render('pages/manage', {
      title: t('manage.title'),
      metaDescription: t('manage.metaDescription'),
      canonical: `${config.site.url}/manage/${req.params.token}`,
      robots: 'noindex,nofollow',
      ad,
      token: req.params.token,
      adLink: adUrl(ad),
      absoluteAdLink: absolute(adUrl(ad)),
      renewed: req.query.renewed === 'ok',
    });
  });

  // --- Renew -----------------------------------------------------------------
  app.post('/manage/:token/renew', (req, res) => {
    const renewed = ads.renewAd(req.params.token);
    if (!renewed) {
      return res.status(404).render('pages/error', {
        title: t('manage.notFoundTitle'),
        status: 404,
        message: t('manage.invalidBody'),
      });
    }
    return res.redirect(`/manage/${req.params.token}?renewed=ok`);
  });
};
