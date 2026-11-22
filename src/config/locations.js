'use strict';

/**
 * Location hierarchy for the active market: country > region (state) > city.
 *
 * The hierarchy is seeded from the market config (`config.site.regions`), so
 * each site ships its own regions and cities and no code changes are needed to
 * launch a new market. Clean URL segments are lowercase slugs
 * (e.g. /au/vic/melbourne/for-sale/).
 *
 * Note: routes and the database refer to the middle level as `state`
 * (the column/URL segment); in the config files it is called `regions`.
 */

const config = require('./index');

/** Convert a display name to a URL-safe slug (also used for ad title slugs). */
function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// A market is a single country; expose it in the same shape the app expects.
const LOCATIONS = {
  [config.site.country]: {
    name: config.site.countryName,
    currency: config.site.currency,
    regions: config.site.regions,
  },
};

// Pre-build a fast lookup table of { country: { region: { citySlug: CityName } } }
const CITY_INDEX = {};
for (const [countrySlug, country] of Object.entries(LOCATIONS)) {
  CITY_INDEX[countrySlug] = {};
  for (const [regionSlug, region] of Object.entries(country.regions)) {
    CITY_INDEX[countrySlug][regionSlug] = {};
    for (const cityName of region.cities) {
      CITY_INDEX[countrySlug][regionSlug][slugify(cityName)] = cityName;
    }
  }
}

function getCountry(countrySlug) {
  return LOCATIONS[String(countrySlug || '').toLowerCase()] || null;
}

function getState(countrySlug, stateSlug) {
  const country = getCountry(countrySlug);
  if (!country) return null;
  return country.regions[String(stateSlug || '').toLowerCase()] || null;
}

function getCity(countrySlug, stateSlug, citySlug) {
  const index = CITY_INDEX[String(countrySlug || '').toLowerCase()];
  if (!index) return null;
  const regionCities = index[String(stateSlug || '').toLowerCase()];
  if (!regionCities) return null;
  const name = regionCities[String(citySlug || '').toLowerCase()];
  return name ? { slug: String(citySlug).toLowerCase(), name } : null;
}

/** Flatten every city into a list for sitemaps and search filters. */
function allCities() {
  const out = [];
  for (const [countrySlug, country] of Object.entries(LOCATIONS)) {
    for (const [regionSlug, region] of Object.entries(country.regions)) {
      for (const cityName of region.cities) {
        out.push({
          country: countrySlug,
          countryName: country.name,
          state: regionSlug,
          stateName: region.name,
          city: slugify(cityName),
          cityName,
        });
      }
    }
  }
  return out;
}

module.exports = {
  LOCATIONS,
  slugify,
  getCountry,
  getState,
  getCity,
  allCities,
};
