'use strict';

const rateLimit = require('express-rate-limit');

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
  message: jsonMessage('Too many requests. Please slow down.'),
});

// Posting an ad (form submit + magic-link request).
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('You have reached the posting limit. Please try again later.'),
});

// Contact relay + report submissions.
const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many submissions. Please try again shortly.'),
});

// Admin login (brute-force protection).
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please try again later.',
});

module.exports = { browseLimiter, postLimiter, actionLimiter, adminLoginLimiter };
