'use strict';

const config = require('../config');

/** Build the clean listing URL for a location [+ category]. */
function listingUrl({ country, state, city, category } = {}) {
  const parts = [];
  if (country) parts.push(country);
  if (state) parts.push(state);
  if (city) parts.push(city);
  if (category) parts.push(category);
  return `/${parts.join('/')}/`;
}

/** Clean canonical URL for an individual ad. */
function adUrl(ad) {
  if (!ad) return '/';
  return `/ad/${ad.public_id}/${ad.slug}`;
}

/** Absolute URL given a site-relative path. */
function absolute(pathname = '/') {
  return `${config.site.url}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

/** Absolute ad URL. */
function absoluteAdUrl(ad) {
  return absolute(adUrl(ad));
}

/** Prepend the public uploads prefix to an image filename. */
function imageUrl(filename) {
  if (!filename) return null;
  return `${config.uploads.publicPath}/${filename}`;
}

/** Thumbnail URL for a stored image filename. */
function imageThumbUrl(filename) {
  if (!filename) return null;
  const base = filename.replace(/\.webp$/i, '');
  return `${config.uploads.publicPath}/${base}-thumb.webp`;
}

/** Build a query string preserving existing params with overrides. */
function withQuery(current, overrides) {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

module.exports = { listingUrl, adUrl, absolute, absoluteAdUrl, imageUrl, imageThumbUrl, withQuery };
