'use strict';

/**
 * Location hierarchy: country > state/region > city.
 * Clean URL segments are lowercase slugs (e.g. /au/vic/melbourne/for-sale/).
 *
 * Australia is the launch market and is populated in most detail. Other
 * countries are seeded more lightly and can be extended without code changes.
 */
const LOCATIONS = {
  au: {
    name: 'Australia',
    currency: 'AUD',
    states: {
      nsw: { name: 'New South Wales', cities: ['Sydney', 'Newcastle', 'Wollongong', 'Central Coast', 'Albury', 'Wagga Wagga'] },
      vic: { name: 'Victoria', cities: ['Melbourne', 'Geelong', 'Ballarat', 'Bendigo', 'Shepparton', 'Warrnambool'] },
      qld: { name: 'Queensland', cities: ['Brisbane', 'Gold Coast', 'Sunshine Coast', 'Townsville', 'Cairns', 'Toowoomba'] },
      wa: { name: 'Western Australia', cities: ['Perth', 'Mandurah', 'Bunbury', 'Geraldton', 'Albany', 'Kalgoorlie'] },
      sa: { name: 'South Australia', cities: ['Adelaide', 'Mount Gambier', 'Whyalla', 'Murray Bridge', 'Port Augusta'] },
      tas: { name: 'Tasmania', cities: ['Hobart', 'Launceston', 'Devonport', 'Burnie'] },
      act: { name: 'Australian Capital Territory', cities: ['Canberra', 'Belconnen', 'Gungahlin', 'Tuggeranong'] },
      nt: { name: 'Northern Territory', cities: ['Darwin', 'Alice Springs', 'Palmerston'] },
    },
  },
  nz: {
    name: 'New Zealand',
    currency: 'NZD',
    states: {
      auk: { name: 'Auckland', cities: ['Auckland', 'Manukau', 'North Shore'] },
      wgn: { name: 'Wellington', cities: ['Wellington', 'Lower Hutt', 'Porirua'] },
      can: { name: 'Canterbury', cities: ['Christchurch', 'Timaru'] },
      ota: { name: 'Otago', cities: ['Dunedin', 'Queenstown'] },
    },
  },
  gb: {
    name: 'United Kingdom',
    currency: 'GBP',
    states: {
      eng: { name: 'England', cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Bristol'] },
      sct: { name: 'Scotland', cities: ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee'] },
      wls: { name: 'Wales', cities: ['Cardiff', 'Swansea', 'Newport'] },
      nir: { name: 'Northern Ireland', cities: ['Belfast', 'Londonderry'] },
    },
  },
  us: {
    name: 'United States',
    currency: 'USD',
    states: {
      ca: { name: 'California', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'Sacramento'] },
      ny: { name: 'New York', cities: ['New York City', 'Buffalo', 'Rochester', 'Albany'] },
      tx: { name: 'Texas', cities: ['Houston', 'Dallas', 'Austin', 'San Antonio'] },
      fl: { name: 'Florida', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville'] },
    },
  },
  ca: {
    name: 'Canada',
    currency: 'CAD',
    states: {
      on: { name: 'Ontario', cities: ['Toronto', 'Ottawa', 'Hamilton', 'London'] },
      bc: { name: 'British Columbia', cities: ['Vancouver', 'Victoria', 'Kelowna'] },
      qc: { name: 'Quebec', cities: ['Montreal', 'Quebec City'] },
      ab: { name: 'Alberta', cities: ['Calgary', 'Edmonton'] },
    },
  },
};

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

// Pre-build a fast lookup table of { country: { state: { citySlug: CityName } } }
const CITY_INDEX = {};
for (const [countrySlug, country] of Object.entries(LOCATIONS)) {
  CITY_INDEX[countrySlug] = {};
  for (const [stateSlug, state] of Object.entries(country.states)) {
    CITY_INDEX[countrySlug][stateSlug] = {};
    for (const cityName of state.cities) {
      CITY_INDEX[countrySlug][stateSlug][slugify(cityName)] = cityName;
    }
  }
}

function getCountry(countrySlug) {
  return LOCATIONS[String(countrySlug || '').toLowerCase()] || null;
}

function getState(countrySlug, stateSlug) {
  const country = getCountry(countrySlug);
  if (!country) return null;
  return country.states[String(stateSlug || '').toLowerCase()] || null;
}

function getCity(countrySlug, stateSlug, citySlug) {
  const index = CITY_INDEX[String(countrySlug || '').toLowerCase()];
  if (!index) return null;
  const stateCities = index[String(stateSlug || '').toLowerCase()];
  if (!stateCities) return null;
  const name = stateCities[String(citySlug || '').toLowerCase()];
  return name ? { slug: String(citySlug).toLowerCase(), name } : null;
}

/** Flatten every city into a list for sitemaps and search filters. */
function allCities() {
  const out = [];
  for (const [countrySlug, country] of Object.entries(LOCATIONS)) {
    for (const [stateSlug, state] of Object.entries(country.states)) {
      for (const cityName of state.cities) {
        out.push({
          country: countrySlug,
          countryName: country.name,
          state: stateSlug,
          stateName: state.name,
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
