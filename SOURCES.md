# Data sources & licences

ListNear ships a per-country catalogue and a seeded `region > city` hierarchy.
Everything is derived from public, openly documented references — no towns or
numbers are invented. This file records where each piece of data comes from.

## Country / territory list

The catalogue in [`src/config/countries.js`](src/config/countries.js) covers the
countries and territories where **Google AdSense is supported**, matching the
list published at:

- **Google AdSense — supported countries/territories**
  <https://support.google.com/adsense/answer/13402307>

Countries that are *not* AdSense markets (e.g. Crimea, Cuba, Iran, North Korea
and the so-called DNR/LNR) are intentionally **absent**. Uninhabited territories
(Antarctica, Bouvet Island, Heard & McDonald Islands, South Georgia & the South
Sandwich Islands, French Southern Territories, British Indian Ocean Territory,
and similar) are catalogued but carry **no region data** and stay
`enabled: false`, so no placeholder content is ever served for them.

## Per-country metadata

| Field | Source | Licence / terms |
| ----- | ------ | --------------- |
| `code`, `name` | ISO 3166-1 alpha-2 (country codes) and ISO 3166-1 English short names | ISO 3166 is freely usable for the codes and short names |
| `currency` | ISO 4217 currency codes | Public standard |
| `locale` | BCP 47 (IETF language tags), Unicode CLDR conventions | Public standard |
| `language` | BCP 47 primary language subtags | Public standard |
| `phone.dialCode` | ITU-T E.164 international dialling codes | Public standard |
| `emergencyNumber` | Public national emergency-number tables (national government / Wikipedia "List of emergency telephone numbers") | Facts, not copyrightable; verified per country |

Where a country has **no single national emergency number**, the field is left
blank rather than guessed, and the Safety page falls back to a generic line.

## Region & city seed data

[`src/config/regions.js`](src/config/regions.js) seeds administrative regions
(states/provinces) and their well-known cities, matching the depth already used
for the United States (all 50 states + DC) and Australia (all states/territories).

- **GeoNames** — <https://www.geonames.org/> — licence **CC BY 4.0**
  (<https://creativecommons.org/licenses/by/4.0/>). Used to confirm administrative
  region names and major cities.
- **Wikidata** — <https://www.wikidata.org/> — data released under **CC0 1.0**
  (<https://creativecommons.org/publicdomain/zero/1.0/>). Used for cross-checking
  city/region names and spellings.

City display names are normalised to URL-safe slugs at runtime by the
`slugify` helper in [`src/config/locations.js`](src/config/locations.js)
(NFKD, accents stripped, lowercased, non-alphanumerics → `-`).

Region/city seeding is **locations only** — it never creates ads. Empty markets
show an invitation to post rather than sample listings, and `npm run seed`
(local development only) is the sole path that ever inserts examples, all
prefixed `[SAMPLE]`.
