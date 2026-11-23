'use strict';

/**
 * SEO helpers shared by the middleware and templates.
 */

/**
 * The path to use for cross-market links: `hreflang` alternates and the header
 * and footer country pickers.
 *
 * Generic pages (`/`, `/about/`, `/browse/`, `/post/`, ...) exist on every
 * market, so the same path is the true equivalent page. Location URLs begin
 * with a country segment (`/au/vic/melbourne/`) that only exists on their own
 * market, so those fall back to that market's home page rather than 404ing.
 *
 * @param {{ path?: string, originalUrl?: string }} req
 * @returns {string} a site-relative path (may include a query string)
 */
function alternatePathFor(req) {
  const pathOnly = (req && req.path) || '/';
  const isLocationPath = /^\/[a-z]{2}(\/|$)/.test(pathOnly);
  if (isLocationPath) return '/';
  return (req && (req.originalUrl || req.path)) || '/';
}

module.exports = { alternatePathFor };
