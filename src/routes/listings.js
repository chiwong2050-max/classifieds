'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { CATEGORIES, getCategory, categoryName } = require('../config/categories');
const { getCountry, getState, getCity, slugify } = require('../config/locations');
const { listingUrl, absolute } = require('../utils/urls');
const { breadcrumbJsonLd } = require('../utils/jsonld');

const PER_PAGE = 24;
const SORTS = ['recent', 'price-asc', 'price-desc'];

function toCents(dollars) {
  if (dollars === undefined || dollars === null || dollars === '') return null;
  const n = Number(String(dollars).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Resolve a `/country/state/city/category/` style path into location parts.
 * Returns null when the path is not a valid location hierarchy.
 */
function resolveLocation(segments) {
  const country = segments[0];
  const countryObj = getCountry(country);
  if (!countryObj) return null;

  const parts = { country, countryName: countryObj.name, state: null, stateName: null, city: null, cityName: null, category: null };
  let i = 1;

  if (i < segments.length && getState(country, segments[i])) {
    parts.state = segments[i];
    parts.stateName = getState(country, parts.state).name;
    i += 1;
  }
  if (parts.state && i < segments.length) {
    const city = getCity(country, parts.state, segments[i]);
    if (city) {
      parts.city = city.slug;
      parts.cityName = city.name;
      i += 1;
    }
  }
  if (i < segments.length && getCategory(segments[i])) {
    parts.category = segments[i];
    i += 1;
  }
  if (i !== segments.length) return null;
  return parts;
}

/**
 * Build a location object from query params, used by the global /search page
 * so keyword searches can still be scoped to a country/state/city/category.
 */
function locationFromQuery(query) {
  const requested = String(query.country || config.site.defaultCountry).toLowerCase();
  const countrySlug = getCountry(requested) ? requested : config.site.defaultCountry;
  const countryObj = getCountry(countrySlug);
  const parts = { country: countrySlug, countryName: countryObj.name, state: null, stateName: null, city: null, cityName: null, category: null };

  if (query.state && getState(parts.country, query.state)) {
    parts.state = query.state;
    parts.stateName = getState(parts.country, parts.state).name;
  }
  if (parts.state && query.city) {
    const city = getCity(parts.country, parts.state, query.city);
    if (city) {
      parts.city = city.slug;
      parts.cityName = city.name;
    }
  }
  if (query.category && getCategory(query.category)) parts.category = query.category;
  return parts;
}

/**
 * Shared renderer for location/category listing pages and the global search
 * page. Keeps filtering, pagination and metadata in one place.
 */
function renderListing(req, res, { loc, baseUrl, isSearch = false }) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'recent';
  const filters = {
    country: loc.country,
    state: loc.state,
    city: loc.city,
    category: loc.category,
    q: (req.query.q || '').trim() || null,
    priceMin: toCents(req.query.priceMin),
    priceMax: toCents(req.query.priceMax),
  };

  const { rows, total } = ads.searchAds(filters, {
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
    sort,
  });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // --- Titles, meta, canonical, robots, breadcrumbs ---
  const placeLabel = loc.cityName || loc.stateName || loc.countryName;
  const catLabel = loc.category ? categoryName(loc.category) : 'All categories';
  const pageLabel = page > 1 ? ` (Page ${page})` : '';

  let title;
  let metaDescription;
  let canonical;
  let robots;
  let crumbs;

  if (isSearch) {
    title = filters.q ? `Search results for "${filters.q}"${pageLabel}` : `Search classifieds in ${placeLabel}${pageLabel}`;
    metaDescription = `Search results on ${config.site.name}${filters.q ? ` for "${filters.q}"` : ''} in ${placeLabel}. Family-safe and reviewed.`;
    // Search result pages are not canonical and are kept out of the index.
    canonical = null;
    robots = 'noindex,follow';
    crumbs = [{ name: 'Home', url: '/' }, { name: 'Search', url: '/search' }];
  } else {
    title = loc.category
      ? `${catLabel} in ${placeLabel}${pageLabel}`
      : `Classifieds in ${placeLabel} - ${catLabel}${pageLabel}`;
    metaDescription = loc.category
      ? `Browse ${total} ${catLabel.toLowerCase()} listings in ${placeLabel}. Buy and sell safely on ${config.site.name} - every ad is reviewed.`
      : `Browse ${total} classified ads in ${placeLabel}: jobs, cars, property, services and more. Family-safe and reviewed on ${config.site.name}.`;
    canonical = absolute(listingUrl(loc));
    const hasFilterQuery = Boolean(filters.q || filters.priceMin != null || filters.priceMax != null || sort !== 'recent' || page > 1);
    robots = hasFilterQuery ? 'noindex,follow' : 'index,follow';
    crumbs = [{ name: 'Home', url: '/' }];
    crumbs.push({ name: loc.countryName, url: listingUrl({ country: loc.country }) });
    if (loc.state) crumbs.push({ name: loc.stateName, url: listingUrl({ country: loc.country, state: loc.state }) });
    if (loc.city) crumbs.push({ name: loc.cityName, url: listingUrl({ country: loc.country, state: loc.state, city: loc.city }) });
    if (loc.category) crumbs.push({ name: catLabel, url: listingUrl(loc) });
  }

  // Sibling navigation.
  const categoryCounts = ads.categoryCounts({ country: loc.country, state: loc.state, city: loc.city });
  const countryObj = getCountry(loc.country);
  const siblingCities = loc.state
    ? countryObj.states[loc.state].cities.map((name) => ({ slug: slugify(name), name }))
    : [];

  res.render('pages/listing', {
    title,
    metaDescription,
    canonical,
    robots,
    jsonLd: breadcrumbJsonLd(crumbs),
    loc,
    crumbs,
    rows,
    total,
    page,
    totalPages,
    sort,
    baseUrl,
    categoryCounts,
    allCategories: CATEGORIES,
    siblingCities,
    isSearch,
  });
}

module.exports = function listingRoutes(app) {
  // Global keyword search (target of the header search box). Registered before
  // the greedy location route so `/search` is not mistaken for a country slug.
  app.get('/search', (req, res) => {
    const loc = locationFromQuery(req.query);
    renderListing(req, res, { loc, baseUrl: '/search', isSearch: true });
  });

  app.get('/:a/:b?/:c?/:d?', (req, res, next) => {
    const segments = [req.params.a, req.params.b, req.params.c, req.params.d].filter(Boolean);
    const loc = resolveLocation(segments);
    if (!loc) return next(); // fall through to 404

    renderListing(req, res, { loc, baseUrl: listingUrl(loc) });
  });
};
