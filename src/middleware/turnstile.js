'use strict';

const config = require('../config');
const { t } = require('../config/i18n');

/**
 * Cloudflare Turnstile verification (bot protection).
 *
 * This is a *placeholder-ready* integration: when TURNSTILE_SITE_KEY and
 * TURNSTILE_SECRET_KEY are set, submissions are verified against Cloudflare's
 * siteverify endpoint. When they are not set, verification is skipped so the
 * app works out of the box in development.
 *
 * The verify widget is rendered client-side (see views/partials/turnstile.ejs).
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile response token.
 * @param {string} token the `cf-turnstile-response` form value
 * @param {string} remoteIp client IP
 * @returns {Promise<{ ok: boolean, skipped?: boolean }>}
 */
async function verifyToken(token, remoteIp) {
  if (!config.turnstile.enabled) return { ok: true, skipped: true };
  if (!token) return { ok: false };

  const body = new URLSearchParams();
  body.append('secret', config.turnstile.secretKey);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    const data = await res.json();
    return { ok: Boolean(data.success) };
  } catch {
    // Fail closed when Turnstile is configured but unreachable.
    return { ok: false };
  }
}

/** Express middleware for form POSTs that include a Turnstile widget. */
function turnstileMiddleware(req, res, next) {
  if (!config.turnstile.enabled) return next();
  const token = req.body['cf-turnstile-response'] || req.body.turnstileToken;
  verifyToken(token, req.ip).then(({ ok }) => {
    if (!ok) {
      return res.status(400).render('pages/error', {
        title: t('error.verifyFailedTitle'),
        status: 400,
        message: t('error.verifyFailedBody'),
      });
    }
    next();
  });
}

module.exports = { verifyToken, turnstileMiddleware };
