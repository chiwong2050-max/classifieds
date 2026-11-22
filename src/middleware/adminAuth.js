'use strict';

const config = require('../config');
const { safeEqual } = require('../utils/helpers');

/** True when an admin password has been configured at all. */
function adminConfigured() {
  return Boolean(config.admin.password);
}

/** Verify a submitted password against the env-configured admin password. */
function checkPassword(password) {
  if (!adminConfigured()) return false;
  return safeEqual(String(password || ''), config.admin.password);
}

/** Gate that protects all /admin routes except the login page. */
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

module.exports = { adminConfigured, checkPassword, requireAdmin };
