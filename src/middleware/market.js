'use strict';

/**
 * Host-based market resolution.
 *
 * Every request is mapped to a market from its `Host` header and that market is
 * published on an AsyncLocalStorage slot (see `src/config/context.js`) so the
 * rest of the app - including the DB proxy and i18n - follows it. This must run
 * before the session middleware so session reads/writes hit the right database.
 *
 * Decisions (see `resolveHost`):
 *   ok        -> serve that market
 *   redirect  -> 301 to the canonical host (apex / alias)
 *   reserved  -> a non-country label (www, api, cdn, ...) -> 404
 *   unknown   -> an undeclared subdomain -> 404
 *   external  -> not our root domain (localhost, IP, proxy) -> local-dev market
 */

const config = require('../config');
const context = require('../config/context');
const { siteFor, resolveHost } = require('../config/market');
const { t } = require('../config/i18n');

/** Map the Host header to a market and run the rest of the chain inside it. */
function marketMiddleware(req, res, next) {
  const decision = resolveHost(req.headers.host);

  // Canonical-host redirects (preserve path + query): us. -> apex, uk. -> gb.
  if (decision.kind === 'redirect') {
    return res.redirect(301, `${decision.to}${req.originalUrl || '/'}`);
  }

  const site = decision.kind === 'ok' ? siteFor(decision.code) : config.defaultSite;

  context.run({ site }, () => {
    req.market = site;
    // 'ok' markets that are registered but not yet seeded show "coming soon".
    req.marketState = decision.kind;
    next();
  });
}

/**
 * Gate that runs after the static-asset and locals middleware: reserved or
 * unknown subdomains 404, and registered-but-disabled markets render the
 * "coming soon" page. Static assets are served before this so those pages
 * still load their CSS/JS.
 */
function marketGate(req, res, next) {
  if (req.marketState === 'reserved' || req.marketState === 'unknown') {
    return res.status(404).render('pages/error', {
      title: t('error.notFoundTitle'),
      status: 404,
      message: t('error.notFoundBody'),
    });
  }

  if (req.marketState === 'ok' && req.market && req.market.enabled === false) {
    const site = req.market;
    return res.status(200).render('pages/coming-soon', {
      title: t('comingSoon.title', { countryName: site.countryName, siteName: site.name }),
      metaDescription: t('comingSoon.metaDescription', {
        countryName: site.countryName,
        siteName: site.name,
      }),
      canonical: `${site.url}/`,
      robots: 'noindex,follow',
      markets: site.alternates,
    });
  }

  next();
}

module.exports = { marketMiddleware, marketGate };
