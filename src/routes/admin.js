'use strict';

const config = require('../config');
const ads = require('../db/ads');
const mailer = require('../services/mailer');
const { requireAdmin, checkPassword, adminConfigured } = require('../middleware/adminAuth');
const { adminLoginLimiter } = require('../middleware/rateLimit');
const { provideCsrf, requireCsrf } = require('../middleware/csrf');
const { adUrl, absolute } = require('../utils/urls');
const { t } = require('../config/i18n');

module.exports = function adminRoutes(app) {
  // --- Login ----------------------------------------------------------------
  app.get('/admin/login', provideCsrf, (req, res) => {
    if (req.session && req.session.isAdmin) return res.redirect('/admin');
    res.render('pages/admin/login', {
      title: t('admin.signIn'),
      metaDescription: t('admin.signInMeta'),
      robots: 'noindex,nofollow',
      canonical: `${config.site.url}/admin/login`,
      error: null,
      adminConfigured: adminConfigured(),
    });
  });

  app.post('/admin/login', adminLoginLimiter, requireCsrf, (req, res) => {
    if (!adminConfigured()) {
      return res.status(500).render('pages/admin/login', {
        title: t('admin.signIn'),
        metaDescription: t('admin.signInMeta'),
        robots: 'noindex,nofollow',
        canonical: `${config.site.url}/admin/login`,
        error: t('admin.errorNoPassword'),
        adminConfigured: false,
      });
    }
    if (checkPassword((req.body || {}).password)) {
      req.session.isAdmin = true;
      return res.redirect('/admin');
    }
    return res.status(401).render('pages/admin/login', {
      title: t('admin.signIn'),
      metaDescription: t('admin.signInMeta'),
      robots: 'noindex,nofollow',
      canonical: `${config.site.url}/admin/login`,
      error: t('admin.errorWrongPassword'),
      adminConfigured: true,
    });
  });

  app.post('/admin/logout', requireCsrf, (req, res) => {
    if (req.session) req.session.isAdmin = false;
    res.redirect('/admin/login');
  });

  // --- Dashboard ------------------------------------------------------------
  app.get('/admin', requireAdmin, provideCsrf, (req, res) => {
    const status = ['pending', 'active', 'rejected', 'expired'].includes(req.query.status) ? req.query.status : 'pending';
    const list = ads.listForAdmin(status, { limit: 100 });
    res.render('pages/admin/dashboard', {
      title: t('admin.dashboardTitle'),
      metaDescription: t('admin.dashboardMeta'),
      robots: 'noindex,nofollow',
      canonical: `${config.site.url}/admin`,
      counts: ads.adminCounts(),
      status,
      list,
      reports: ads.listReports({ limit: 50 }),
    });
  });

  // --- Ad review ------------------------------------------------------------
  app.get('/admin/ads/:id', requireAdmin, provideCsrf, (req, res) => {
    const ad = ads.getById(parseInt(req.params.id, 10));
    if (!ad) {
      return res.status(404).render('pages/error', {
        title: t('admin.notFoundTitle'),
        status: 404,
        message: t('admin.notFoundBody'),
      });
    }
    res.render('pages/admin/ad-detail', {
      title: t('admin.reviewTitle', { title: ad.title }),
      metaDescription: t('admin.reviewMeta'),
      robots: 'noindex,nofollow',
      canonical: `${config.site.url}/admin/ads/${ad.id}`,
      ad,
      images: ads.getImages(ad.id),
      adLink: adUrl(ad),
    });
  });

  app.post('/admin/ads/:id/approve', requireAdmin, requireCsrf, async (req, res, next) => {
    try {
      const ad = ads.getById(parseInt(req.params.id, 10));
      if (!ad) return res.status(404).end();
      ads.approveAd(ad.id);
      await mailer.sendAdApproved({
        to: ad.contact_email,
        adTitle: ad.title,
        adUrl: absolute(adUrl(ad)),
      });
      return res.redirect('/admin');
    } catch (err) {
      return next(err);
    }
  });

  app.post('/admin/ads/:id/reject', requireAdmin, requireCsrf, async (req, res, next) => {
    try {
      const ad = ads.getById(parseInt(req.params.id, 10));
      if (!ad) return res.status(404).end();
      const reason = String((req.body || {}).reason || '').trim().slice(0, 500);
      ads.rejectAd(ad.id, reason);
      await mailer.sendAdRejected({ to: ad.contact_email, adTitle: ad.title, reason });
      return res.redirect('/admin');
    } catch (err) {
      return next(err);
    }
  });

  // --- Reports --------------------------------------------------------------
  app.post('/admin/reports/:id/handle', requireAdmin, requireCsrf, (req, res) => {
    ads.markReportHandled(parseInt(req.params.id, 10), true);
    res.redirect('/admin#reports');
  });
};
