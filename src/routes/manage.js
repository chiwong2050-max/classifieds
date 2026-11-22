'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { adUrl, absolute } = require('../utils/urls');

module.exports = function manageRoutes(app) {
  // --- Manage / renew an ad via its private token ---------------------------
  app.get('/manage/:token', (req, res) => {
    const ad = ads.getByManageToken(req.params.token);
    if (!ad) {
      return res.status(404).render('pages/error', {
        title: 'Link not found',
        status: 404,
        message: 'This manage link is not valid. Please check the link in your email.',
      });
    }

    res.render('pages/manage', {
      title: `Manage your ad`,
      metaDescription: 'Manage or renew your ad.',
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
        title: 'Link not found',
        status: 404,
        message: 'This manage link is not valid.',
      });
    }
    return res.redirect(`/manage/${req.params.token}?renewed=ok`);
  });
};
