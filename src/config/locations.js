'use strict';

/**
 * Location hierarchy for the active market: country > region (state) > city.
 *
 * The hierarchy is seeded from the market catalogue (`country.regions` in
 * src/config/countries.js), so each site ships its own regions and cities and
 * no code changes are needed to launch a new market. Because one process
 * serves every market, every accessor resolves from the active request's
 * `config.site`. Clean URL segments are lowercase slugs
 * (e.g. /au/vic/melbourne/for-sale/).
 *
 * Note: routes and the database refer to the middle level as `state`
 * (the column/URL segment); in the catalogue it is called `regions`.
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

/**
 * A market is a single country; expose it in the same shape the app expects
 * (`{ [country]: { name, currency, regions } }`) for templates that iterate it.
 */
function locationsFor(site) {
  const s = site || config.site;
  return {
    [s.country]: {
      name: s.countryName,
      currency: s.currency,
      regions: s.regions || {},
    },
  };
}

// Fast lookup table { region: { citySlug: CityName } } per country. The
// catalogue's regions never change at runtime, so caching by country is safe.
const indexCache = new Map();

function cityIndexFor(site) {
  const s = site || config.site;
  const country = String(s.country || '').toLowerCase();
  if (indexCache.has(country)) return indexCache.get(country);
  const index = {};
  for (const [regionSlug, region] of Object.entries(s.regions || {})) {
    index[regionSlug] = {};
    for (const cityName of region.cities || []) {
      index[regionSlug][slugify(cityName)] = cityName;
    }
  }
  indexCache.set(country, index);
  return index;
}

function getCountry(countrySlug) {
  return locationsFor(config.site)[String(countrySlug || '').toLowerCase()] || null;
}

function getState(countrySlug, stateSlug) {
  const country = getCountry(countrySlug);
  if (!country) return null;
  return country.regions[String(stateSlug || '').toLowerCase()] || null;
}

function getCity(countrySlug, stateSlug, citySlug) {
  const countries = locationsFor(config.site);
  const countrySlugLc = String(countrySlug || '').toLowerCase();
  if (!countries[countrySlugLc]) return null;
  const regionCities = cityIndexFor(config.site)[String(stateSlug || '').toLowerCase()];
  if (!regionCities) return null;
  const name = regionCities[String(citySlug || '').toLowerCase()];
  return name ? { slug: String(citySlug).toLowerCase(), name } : null;
}

/** Flatten every city in the active market for sitemaps and search filters. */
function allCities() {
  const out = [];
  for (const [countrySlug, country] of Object.entries(locationsFor(config.site))) {
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

/**
 * Per-market `{ [country]: { name, currency, regions } }` view of the active
 * market. Exposed as a Proxy so direct indexing (`LOCATIONS[country]`),
 * iteration (`Object.entries(locations)` in views) and serialisation
 * (`res.json(LOCATIONS)`) all resolve against the current request's market.
 */
const LOCATIONS = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'then') return undefined; // never treat as a thenable
    if (typeof prop !== 'string') return undefined;
    return locationsFor(config.site)[prop];
  },
  has(_t, prop) {
    return Object.prototype.hasOwnProperty.call(locationsFor(config.site), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(locationsFor(config.site));
  },
  getOwnPropertyDescriptor(_t, prop) {
    const obj = locationsFor(config.site);
    if (!Object.prototype.hasOwnProperty.call(obj, prop)) return undefined;
    return { value: obj[prop], enumerable: true, configurable: true, writable: true };
  },
});

module.exports = {
  LOCATIONS,
  locationsFor,
  // Convenience accessor for the active market (used by routes).
  locations: () => locationsFor(config.site),
  slugify,
  getCountry,
  getState,
  getCity,
  allCities,
};
