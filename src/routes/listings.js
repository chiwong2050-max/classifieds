'use strict';

const config = require('../config');
const ads = require('../db/ads');
const areas = require('../config/areas');
const { CATEGORIES, getCategory, categoryName } = require('../config/categories');
const { getCountry, getState, getCity, slugify } = require('../config/locations');
const { listingUrl, absolute } = require('../utils/urls');
const { breadcrumbJsonLd } = require('../utils/jsonld');
const { t } = require('../config/i18n');

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
    } else if (!getCategory(segments[i])) {
      // Not a seeded city. Accept it when the server team has dropped an area
      // file for it, so any suburb or town gets an area page too.
      const slug = String(segments[i]).toLowerCase();
      const area = areas.loadArea(country, parts.state, slug);
      if (area) {
        parts.city = slug;
        parts.cityName = area.name;
        i += 1;
      }
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
  const requested = String(query.country || config.site.country).toLowerCase();
  const countrySlug = getCountry(requested) ? requested : config.site.country;
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
  const catLabel = loc.category ? categoryName(loc.category) : t('listing.allCategories');
  const pageLabel = page > 1 ? t('listing.pageSuffix', { page }) : '';

  let title;
  let metaDescription;
  let canonical;
  let robots;
  let crumbs;

  if (isSearch) {
    title = filters.q
      ? t('listing.searchResultsFor', { query: filters.q }) + pageLabel
      : t('listing.searchIn', { place: placeLabel }) + pageLabel;
    metaDescription = t('listing.metaSearch', {
      siteName: config.site.name,
      queryClause: filters.q ? ` for "${filters.q}"` : '',
      place: placeLabel,
    });
    // Search result pages are not canonical and are kept out of the index.
    canonical = null;
    robots = 'noindex,follow';
    crumbs = [{ name: t('breadcrumb.home'), url: '/' }, { name: t('nav.search'), url: '/search' }];
  } else {
    title = loc.category
      ? t('listing.titleCategory', { category: catLabel, place: placeLabel }) + pageLabel
      : t('listing.titleAll', { place: placeLabel, category: catLabel }) + pageLabel;
    metaDescription = loc.category
      ? t('listing.metaCategory', { count: total, category: catLabel.toLowerCase(), place: placeLabel, siteName: config.site.name })
      : t('listing.metaAll', { count: total, place: placeLabel, siteName: config.site.name });
    canonical = absolute(listingUrl(loc));
    const hasFilterQuery = Boolean(filters.q || filters.priceMin != null || filters.priceMax != null || sort !== 'recent' || page > 1);
    robots = hasFilterQuery ? 'noindex,follow' : 'index,follow';
    crumbs = [{ name: t('breadcrumb.home'), url: '/' }];
    crumbs.push({ name: loc.countryName, url: listingUrl({ country: loc.country }) });
    if (loc.state) crumbs.push({ name: loc.stateName, url: listingUrl({ country: loc.country, state: loc.state }) });
    if (loc.city) crumbs.push({ name: loc.cityName, url: listingUrl({ country: loc.country, state: loc.state, city: loc.city }) });
    if (loc.category) crumbs.push({ name: catLabel, url: listingUrl(loc) });
  }

  // Area hub: a plain city page (never a category or search page) that has
  // real content dropped by the server team. Sections render only when the
  // data exists (see the areaHub partial); nothing is ever placeholder text.
  // loadArea also enforces the AREA_PAGES_ENABLED rollout allow-list, so a
  // disabled country/state simply renders the plain classifieds page.
  let areaHub = !isSearch && loc.city && !loc.category
    ? areas.loadArea(loc.country, loc.state, loc.city)
    : null;
  if (areaHub) {
    // Area pages sit behind a kill-switch. They are noindex unless indexing is
    // enabled AND the page is rich (see config/areas.isRich); the sitemap omits
    // them on the same terms.
    robots = config.areaPages.indexing && areas.isRich(areaHub, total)
      ? 'index,follow'
      : 'noindex,follow';
    // Link a nearby area only when it actually has a page (a seeded city or an
    // area file), so we never render a link that 404s.
    areaHub = {
      ...areaHub,
      nearby: areaHub.nearby.map((n) => ({
        name: n.name,
        km: n.km,
        href: getCity(loc.country, loc.state, n.slug) || areas.loadArea(loc.country, loc.state, n.slug)
          ? listingUrl({ country: loc.country, state: loc.state, city: n.slug })
          : null,
      })),
    };
  }

  // Sibling navigation.
  const categoryCounts = ads.categoryCounts({ country: loc.country, state: loc.state, city: loc.city });
  const countryObj = getCountry(loc.country);
  const siblingCities = loc.state
    ? countryObj.regions[loc.state].cities.map((name) => ({ slug: slugify(name), name }))
    : [];

  res.render('pages/listing', {
    title,
    metaDescription,
    canonical,
    robots,
    jsonLd: breadcrumbJsonLd(crumbs),
    loc,
    crumbs,
    areaHub,
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
