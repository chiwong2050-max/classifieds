'use strict';

const config = require('../config');
const { t, tp } = require('../config/i18n');
const { CATEGORIES } = require('../config/categories');
const { LOCATIONS, slugify } = require('../config/locations');
const { appsForMarket } = require('../config/apps');
const helpers = require('../utils/helpers');
const urls = require('../utils/urls');

/**
 * Injects values every template needs (site config, categories, helper
 * functions, current path) so views stay free of boilerplate.
 */
function localsMiddleware(req, res, next) {
  res.locals.site = config.site;
  // i18n helpers: all UI text is resolved from locale files via these.
  res.locals.t = t;
  res.locals.tp = tp;
  res.locals.locale = config.site.locale;
  res.locals.categories = CATEGORIES;
  res.locals.locations = LOCATIONS;
  // Footer "Our other free apps" (current market's directory listed first).
  res.locals.otherApps = appsForMarket(config.site.key);
  res.locals.slugify = slugify;
  res.locals.helpers = helpers;
  res.locals.urls = urls;
  res.locals.imageUrl = urls.imageUrl;
  res.locals.imageThumbUrl = urls.imageThumbUrl;
  res.locals.currentPath = req.path;
  res.locals.query = req.query || {};
  res.locals.isAdmin = Boolean(req.session && req.session.isAdmin);
  res.locals.maxImages = config.uploads.maxImages;
  res.locals.expiryDays = config.ad.expiryDays;
  res.locals.turnstileSiteKey = config.turnstile.siteKey;
  res.locals.turnstileEnabled = config.turnstile.enabled;
  res.locals.year = new Date().getFullYear();

  // Defaults that individual routes can override before render().
  res.locals.title = config.site.name;
  res.locals.metaDescription = config.site.tagline;
  res.locals.canonical = urls.absolute(req.path);
  res.locals.robots = 'index,follow';
  res.locals.jsonLd = null;
  res.locals.bodyClass = '';
  res.locals.flash = null;
  next();
}

module.exports = { localsMiddleware };
