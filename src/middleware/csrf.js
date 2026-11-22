'use strict';

const crypto = require('crypto');
const { t } = require('../config/i18n');

/**
 * Lightweight session-backed CSRF protection.
 *
 * A random token is stored on the session and echoed into forms as a hidden
 * `_csrf` field. State-changing requests must send it back. Only the admin and
 * manage areas enforce it (see routes/admin.js, routes/manage.js); public
 * forms keep their existing honeypot / rate-limit defences.
 */

/** Return the session's CSRF token, creating one on first use. */
function ensureToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/** Expose the token to templates (safe on GET; renders the form). */
function provideCsrf(req, res, next) {
  res.locals.csrfToken = ensureToken(req);
  next();
}

/** Reject state-changing requests whose token is missing or wrong. */
function requireCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const expected = req.session && req.session.csrfToken;
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');

  if (!expected || !sent || sent !== expected) {
    return res.status(403).render('pages/error', {
      title: t('error.forbiddenTitle'),
      status: 403,
      message: t('error.csrfFailed'),
    });
  }
  // Expose the (still valid) token so any re-render of the form keeps working.
  res.locals.csrfToken = expected;
  return next();
}

module.exports = { ensureToken, provideCsrf, requireCsrf };
