'use strict';

/**
 * Catalogue of sibling apps shown in the footer ("Our other free apps").
 *
 * `market` marks the app that belongs to a given market's country so the
 * footer can list that directory first (Australia Web on AU, LocalUSA on US).
 * Display names and blurbs live in the locale files under `apps.<key>`; only
 * the links (with attribution) are defined here. Every outbound link carries
 * `?ref=listnear` so the destination can attribute the referral.
 */

const APPS = [
  { key: 'dealpass', url: 'https://dealpass.app' },
  { key: 'beatavo', url: 'https://beatavo.com' },
  { key: 'localusa', url: 'https://localusa.app', market: 'us' },
  { key: 'australiaweb', url: 'https://australiaweb.net', market: 'au' },
];

/** Append the `ref=listnear` attribution param without clobbering an existing query. */
function withRef(url) {
  return `${url}${url.includes('?') ? '&' : '?'}ref=listnear`;
}

/**
 * Apps ordered so the current market's own directory comes first, followed by
 * the rest in the order defined above. Each entry gains an `href` (with ref).
 */
function appsForMarket(marketKey) {
  const primary = APPS.filter((app) => app.market === marketKey);
  const rest = APPS.filter((app) => app.market !== marketKey);
  return primary.concat(rest).map((app) => ({ ...app, href: withRef(app.url) }));
}

module.exports = { APPS, withRef, appsForMarket };
