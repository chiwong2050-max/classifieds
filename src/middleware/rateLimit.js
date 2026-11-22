'use strict';

const rateLimit = require('express-rate-limit');
const { t } = require('../config/i18n');

/**
 * Rate limiters. Limits are intentionally generous for browsing (SEO crawlers
 * included) and tighter for state-changing endpoints (posting, reports,
 * contact relay, admin login).
 */

const jsonMessage = (message) => ({ error: message });

// Broad limiter for normal page views.
const browseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage(t('limits.browse')),
});

// Posting an ad (form submit + magic-link request).
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage(t('limits.post')),
});

// Contact relay + report submissions.
const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage(t('limits.action')),
});

// Admin login (brute-force protection).
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: t('limits.adminLogin'),
});

module.exports = { browseLimiter, postLimiter, actionLimiter, adminLoginLimiter };
