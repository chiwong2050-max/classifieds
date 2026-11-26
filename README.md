# ListNear

**Buy, sell, jobs, services and more near you.**

ListNear is a modern, **family-safe** local marketplace — built to compete with
the big generalists while keeping the experience clean, fast and trustworthy.

- **Mobile-first & SEO-first** — server-rendered HTML, unique titles/meta and
  JSON-LD on every meaningful page, `sitemap.xml` and `robots.txt` generated
  from live data.
- **No accounts required** to post — email magic-link verification instead.
- **Reviewed by default** — every new ad starts as `pending` and a keyword
  filter auto-flags spam, adult, gambling/casino, weapons and drugs.
- **No personals / dating / adult categories at all.** Not a toggle — the
  category set simply doesn't contain them.
- **Multi-market engine, one process** — a single Node process serves **every
  Google AdSense-supported country/territory**. The United States runs on
  [listnear.app](https://listnear.app); every other country runs on its own
  country subdomain, e.g. **Australia** at
  [au.listnear.app](https://au.listnear.app). The market is resolved from the
  request's `Host` header — each market gets its own branding, currency, locale,
  date/units format and database. Markets are linked by a header country picker,
  a footer switcher and path-equivalent `hreflang` alternates.

---

## Tech stack

| Concern        | Choice                                                            |
| -------------- | ----------------------------------------------------------------- |
| Runtime        | Node.js (>= 20, tested on 24)                                     |
| Web framework  | Express 4                                                         |
| Templating     | EJS (server-side rendered) + a little vanilla JS                  |
| Database       | SQLite via `better-sqlite3` (WAL mode, foreign keys on)           |
| Full-text search | SQLite **FTS5** (porter + unicode61) kept in sync via triggers  |
| Images         | `sharp` → resize/compress uploads to **WebP** (+ thumbnails)      |
| Uploads        | `multer` (in-memory, then processed by `sharp`)                   |
| Email          | `nodemailer` (`console` transport in dev, `smtp` in production)   |
| Security       | `helmet` (CSP), `express-rate-limit`, honeypot, Cloudflare Turnstile placeholder |
| Theming        | CSS variables + `prefers-color-scheme` (light/dark)               |
| PWA            | Web app manifest + service worker (app shell only)                |

No React. No client-side framework. Pages are just HTML.

---

## Features

1. **Categories** — For Sale, Jobs, Services, Housing / Rentals, Vehicles,
   Community, Wanted and Pets (rehoming only, restricted species prohibited).
   There are **no personals / dating / adult categories**, and a server-side
   keyword filter blocks gambling/casino/adult words on posting.
2. **Locations** — `country > state > city` with clean URLs such as
   `/au/vic/melbourne/for-sale/`, each with unique title and meta description.
3. **Post an ad without an account** — a magic link verifies the poster's
   email, up to 6 images are resized/compressed to WebP server-side, a price can
   be set, and buyers contact the poster through a **relay form** that never
   reveals the poster's email address.
4. **Moderation** — every ad goes to `pending`; the admin page at `/admin`
   (password from `ADMIN_PASSWORD`) approves/rejects; a keyword filter
   auto-flags spam, adult, gambling/casino, weapons and drugs; every ad has a
   **report** button.
5. **Expiry** — ads expire after 30 days (`AD_EXPIRY_DAYS`) with a
   renew-by-email link and a `/manage/:token` page.
6. **Search & filters** — keyword + category + location + price range, powered
   by SQLite FTS5 with `bm25()` ranking.
7. **SEO** — `sitemap.xml` generated from live ads and category/location pages,
   JSON-LD (`WebSite`, `BreadcrumbList`, `Product`, `JobPosting`), canonical
   URLs, Open Graph tags, per-market `robots.txt`, and `hreflang` alternates
   across all live markets — each alternate points at the **equivalent path**
   (e.g. `https://au.listnear.app/about/`), with `x-default` pointing at the US.
8. **Abuse protection** — rate limiting (post/contact/login), a honeypot field
   and a Cloudflare Turnstile placeholder (site key/secret via env; disabled
   when unset).
9. **Policy pages** — About, Contact, Privacy, Terms and Safety Tips, with a
   "Buy Me a Coffee" link in the footer. No ad scripts of any kind.
10. **PWA** — manifest + icons (192, 512, maskable) and a service worker that
    serves the home page offline.
11. **Developer friendly** — `.env.example`, a seed script with clearly-marked
    `[SAMPLE]` ads, and a DB reset script.
12. **Area pages** — each suburb or town can become a mini community hub
    (Wikipedia intro, Commons photo, population, nearby areas, local places and
    businesses) with that area's free ads as one section. Content is loaded
    **only** from real JSON files dropped by the server team — never scraped,
    never invented. See [Area pages](#area-pages).

---

## Multi-market sites

**One process serves every market.** The market is detected per request from the
`Host` header, so no process-wide `SITE=` env is needed in production.

- **United States** → `https://listnear.app` (apex; `www` 301s to the apex).
- **Every other country** → `https://<cc>.listnear.app` (e.g. `au`, `gb`, `jp`).

The resolved market is published on an `AsyncLocalStorage` slot
([`src/config/context.js`](src/config/context.js)) so config, i18n, the location
hierarchy and the database all follow it. `config.site` is a live getter:
inside a request it returns that request's market; outside one (CLI scripts,
start-up, maintenance) it returns the **default market** (`SITE`/`SITE_KEY`,
default `us`) — which is only a local-dev fallback.

Host rules ([`src/config/market.js`](src/config/market.js)):

| Host | Behaviour |
| ---- | --------- |
| `listnear.app` | US market (apex). |
| `www.listnear.app` | 301 → `listnear.app`. |
| `<cc>.listnear.app` | That country's market (e.g. `au.listnear.app`). |
| `us.listnear.app` | 301 → `listnear.app` (US is apex-only). |
| `uk.listnear.app` | 301 → `gb.listnear.app` (`uk` is an alias; ISO code is `gb`). |
| `www`, `mail`, `admin`, `api`, `static`, `cdn`, `m`, `dev`, `staging`, `origin`, `ns`, `ftp`, `smtp` | Reserved — never a country; 404. |
| Any other undeclared subdomain | 404. |
| Anything off the root domain (localhost, IP, proxy) | Default market (local dev). |

### The country catalogue

[`src/config/countries.js`](src/config/countries.js) is the **single source of
truth**: one entry per Google AdSense-supported country/territory. Each entry
provides:

| Field | Example | Purpose |
| ----- | ------- | ------- |
| `code` | `au` | ISO 3166-1 alpha-2 (lowercase) — the subdomain, except US. |
| `name` / `nativeName` | `Australia` / `Deutschland` | English short name + optional local name for the picker. |
| `subdomain` | `au` (`null` for US) | Host label; US is apex-only. |
| `url` | `https://au.listnear.app` | Canonical origin, no trailing slash. |
| `currency` | `AUD` | ISO 4217 currency for new ads. |
| `locale` / `language` | `en-AU` / `en` | Locale for formatting and the base locale file. |
| `languages` | `['en']` | UI languages the market may use later (hooks only). |
| `dateFormat` | `D MMM YYYY` | Optional override; otherwise `Intl.DateTimeFormat` with `locale`. |
| `phone` | `{ dialCode: '+61', example: '...' }` | ITU E.164 dial code (safety/contact pages). |
| `units` | `metric` / `imperial` | Distance units (US is imperial). |
| `emergencyNumber` | `000`, `911`, `112` | Real national emergency number, or blank if none. |
| `contactEmail` | `support@listnear.app` | Address on the `/contact` page. |
| `supportUrl` | `https://buymeacoffee.com/aussieloo?ref=listnear` | Footer support link. |
| `enabled` | `true` / `false` | Feature flag — see below. |
| `regions` | `{ vic: { name, cities: [...] } }` | Seeded real `region > city` hierarchy. |

Region/city seeds live in [`src/config/regions.js`](src/config/regions.js),
keyed by country code. **Real public data only** — provenance and licence are
recorded in [SOURCES.md](SOURCES.md).

### Enabled vs coming-soon

Every country is **catalogued** (so DNS/SSL can be prepared), but a market is
only served when its host is **live**. Two switches decide that:

1. the `enabled` flag on the catalogue entry (defaults to the repo's
   `DEFAULT_ENABLED_CODES`, currently `us` + `au`), and
2. an optional env **allow-list**: set `LISTNEAR_ENABLED_COUNTRIES=us,au,gb` to
   turn batches on without a code edit — when set, it *is* the allow-list.

A country must also have a real region/city list in
[`regions.js`](src/config/regions.js) to go live. Everything else answers on its
Host with a "coming soon" page (HTTP 200, `noindex,follow`) that links to the
live markets — never mock listings or another country's ads. **US and AU ship
live**; the rest enable as data is added.

### Databases & uploads

**One SQLite file per country** (`data/<cc>.sqlite` by default, or
`<DB_DIR>/<cc>.sqlite` when `DB_DIR` is set), opened lazily on first request and
cached per path — the whole country set is never opened at start-up. Sessions
live in the same per-market file (cookie `listnear.sid`, host-only), so a login
on one market never leaks to another. Uploads are likewise per country
(`<UPLOAD_DIR>/<cc>`), and only the **current** market's directory is served at
`/uploads`.

### UI text

**UI text lives in locale files** under [`locales/`](locales): `en.json` is the
base language dictionary, merged with the market's language file
(`<language>.json`) and locale overrides (`en-AU.json`, `en-US.json`). Views and
routes only ever reference keys (`t('nav.postAd')`) — there is no hard-coded
English in the templates, so a market can be re-worded without touching code.
Categories stay family-safe in every market: the category set contains **no
personals / dating / adult** options.

---

## Area pages

Each suburb or town can get an **area page** at `/<country>/<state>/<slug>/`
(e.g. [`/au/vic/bendigo/`](https://au.listnear.app/au/vic/bendigo/)) — a small
community hub built **only from real data**, with that area's free classifieds as
one section. The page is plain server-rendered HTML (no client framework).

### Data comes from files (no scraping)

The app never scrapes. The server team drops one JSON file per area at
`<AREAS_DIR>/<cc>/<state>/<slug>.json` (default
[`data/areas/`](data/areas), e.g. `data/areas/au/vic/bendigo.json`). The loader
in [`src/config/areas.js`](src/config/areas.js) validates every field and
**skips a bad file with a single log line** — it never throws, and one broken
file never takes a page (or the process) down.

Schema:

| Field | Shape |
| ----- | ----- |
| `name`, `state`, `country`, `lga` | strings (`name` is required) |
| `wiki` | `{ extract, title, url, licence: "CC BY-SA 4.0" }` or `null` |
| `photo` | `{ file, url, author, licence, commonsUrl }` or `null` — **Wikimedia Commons only** |
| `population` | `{ value, year, source, sourceUrl }` or `null` |
| `nearby` | `[{ name, slug, km }]` (`km` may be `null`) |
| `places` | `[{ name, type, osmUrl }]` (e.g. parks, libraries, playgrounds from OpenStreetMap) |
| `businesses` | `[{ name, category, url }]` (links to our own directory listings) |

Leave anything unknown as `null` — no invented numbers, posts or businesses.
Sections render **only when their data exists**; there is no placeholder content.
The three files committed under `data/areas/au/vic/` (bendigo, ballarat, geelong)
are **tests-only examples** built from visible Wikipedia / Wikimedia Commons /
OpenStreetMap data.

### Richness gate and the indexing kill-switch

A page is **rich** if it has a Wikipedia extract **and** at least two other real
sections, **or** at least one real post. `AREA_PAGES_INDEXING` (default
`false`) is the kill-switch:

- **off** → every area page is `noindex,follow` and **no** area page appears in
  `/sitemap.xml`;
- **on** → only **rich** pages become `index,follow` and are listed in the
  sitemap.

The flag ships **off** and is turned on only after the content is reviewed.

---

## Getting started

### Prerequisites

- Node.js **20+** (Node 24 recommended)
- npm

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
# ...then edit .env and set SESSION_SECRET and ADMIN_PASSWORD

# 3. Seed the database with clearly-marked [SAMPLE] ads
npm run seed

# 4. Start the app
npm start
```

Open http://localhost:3000. The admin area is at http://localhost:3000/admin.

### Scripts

| Command           | Description                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `npm start`       | Start the production server.                                       |
| `npm run dev`     | Start with `node --watch` for auto-reload.                         |
| `npm run seed`    | Insert a handful of `[SAMPLE]` ads (safe to re-run; replaces them).|
| `npm run reset-db`| Delete the SQLite database (and WAL/SHM files) and start fresh.    |

---

## Configuration

All configuration is via environment variables (see [.env.example](.env.example)).
The app boots with safe defaults and **zero config** for local development.

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `SITE` / `SITE_KEY` | Default market for non-matching hosts (local dev / CLI). | `us` |
| `SITE_CONFIG` | Path to a JSON overlay merged into the **default** market only. | unset |
| `ROOT_DOMAIN` | Apex domain used for host resolution and country subdomains. | `listnear.app` |
| `SITE_NAME` | Product name shown across the UI. | catalogue |
| `SITE_TAGLINE` | Short tagline for the home page. | catalogue |
| `SITE_URL` | Public base URL of the **default** market (canonicals, magic links, sitemap). Other markets use their own origin. | market origin |
| `SITE_CURRENCY` | Default currency for new ads (ISO 4217). | catalogue |
| `SITE_LOCALE` | Locale for date/price formatting and locale-file overrides. | catalogue |
| `SITE_LANGUAGE` | Base language dictionary (`locales/<lang>.json`). | `en` |
| `SITE_DATE_FORMAT` | Date pattern, e.g. `D MMM YYYY` or `MMM D, YYYY`. | catalogue |
| `SITE_UNITS` | `metric` (km) or `imperial` (mi). | catalogue |
| `SITE_CONTACT_EMAIL` | Address shown on the `/contact` page. | catalogue |
| `DB_PATH` | SQLite file for the default market. | `data/<code>.sqlite` |
| `HOST` | Bind address. Defaults to loopback; set `0.0.0.0` behind a reverse proxy/container. | `127.0.0.1` |
| `PORT` | HTTP port. | `3000` |
| `NODE_ENV` | `development` or `production`. | `development` |
| `SESSION_SECRET` | Signs session cookies. **Change in production.** | dev fallback |
| `ADMIN_PASSWORD` | Password for `/admin`. | unset (admin disabled) |
| `MAIL_TRANSPORT` | `console` (logs links) or `smtp`. | `console` |
| `MAIL_FROM` | From address for outgoing mail. | `ListNear <no-reply@listnear.app>` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP settings (used when `MAIL_TRANSPORT=smtp`). | – |
| `UPLOAD_DIR` | Where processed images are stored. | `public/uploads` |
| `MAX_IMAGES_PER_AD` | Max images per ad. | `6` |
| `AD_EXPIRY_DAYS` | Days before an ad expires. | `30` |
| `AREAS_DIR` | Root directory for area JSON files (`<AREAS_DIR>/<cc>/<state>/<slug>.json`). | `data/areas` |
| `AREA_PAGES_INDEXING` | Kill-switch for area-page indexing. Off → all area pages `noindex,follow` and excluded from the sitemap. | `false` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile keys. Leave blank to disable. | blank |
| `EMERGENCY_NUMBER` | Emergency number shown on the safety page. | market file |
| `SUPPORT_URL` | Footer support link. | market file |
| `ADS_ENABLED` | Ad-network switch. Off by default — **no ads are served**. | `false` |

> **Secrets:** `.env` is git-ignored. Never commit real secrets. Only
> `.env.example` (placeholders) is tracked.

---

## Project structure

```
listnear/
├─ src/
│  ├─ config/            # Env config, countries catalogue, market resolution, i18n, categories, locations
│  │                     #   countries.js (catalogue) · regions.js (city seeds) · market.js · context.js
│  ├─ db/                # Per-market connections, schema.sql, ads repository, seed + reset scripts
│  ├─ middleware/        # Market detection + gate, locals, rate limits, Turnstile, admin auth, uploads
│  ├─ routes/            # pages, post, ads, manage, admin, seo, listings
│  ├─ services/          # mailer, images (sharp -> WebP), moderation
│  ├─ utils/             # helpers, url builders, JSON-LD builders
│  └─ server.js          # App entrypoint: security, sessions, routes, maintenance
├─ locales/              # UI text: en.json (base) + <language>.json / en-AU.json, en-US.json overrides
├─ data/areas/           # Area JSON, one file per suburb/town: <cc>/<state>/<slug>.json
├─ views/                # EJS templates (partials + pages, incl. admin)
├─ public/               # CSS, vanilla JS, icons, manifest, service worker, uploads
├─ SOURCES.md            # Provenance & licences for country/region/city data
├─ .env.example
└─ package.json
```

### Route map (high level)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/` | Home: categories, counts, recent ads. |
| GET | `/browse/` | Full category + location index. |
| GET | `/search` | Global keyword search (filters: category, location, price). |
| GET | `/:country/:state?/:city?/:category?` | Clean location/category listings. A city URL with an area JSON file renders the [area hub](#area-pages) above its listings. |
| GET | `/ad/:publicId/:slug?` | Ad detail (301 to canonical slug). |
| POST | `/ad/:publicId/contact` | Contact relay (hides poster email). |
| POST | `/ad/:publicId/report` | Report an ad. |
| GET/POST | `/post/` | Post-an-ad form + submission. |
| GET | `/verify/:token` | Magic-link email verification. |
| GET | `/manage/:token` · POST `/manage/:token/renew` | Manage / renew an ad. |
| GET | `/admin` (+ `/admin/login`, `/admin/ads/:id`, approve/reject, reports) | Moderation. |
| GET | `/api/locations` | Location data for the post-form cascade. |
| GET | `/robots.txt` · `/sitemap.xml` | SEO endpoints — per-market, from the request's own origin. |
| GET | `/about/` · `/contact/` · `/privacy/` · `/terms/` · `/safety/` | Informational / policy pages. |

---

## How an ad gets published

1. The poster fills in `/post/` (no account). A honeypot field and Turnstile
   guard against bots; rate limits apply.
2. The submission is held as a signed payload in `verification_tokens` and an
   **email magic link** is sent to the poster.
3. Visiting `/verify/:token` creates the ad as **`pending`** and processes any
   uploaded images (resize + compress to WebP, plus a 480×360 thumbnail).
4. The keyword filter flags suspicious ads for review. An admin approves or
   rejects the ad in `/admin`; the poster is notified by email.
5. Published ads appear in listings, search and `sitemap.xml`. After
   `AD_EXPIRY_DAYS`, ads expire and can be renewed via `/manage/:token`.

---

## Security notes

- Helmet with a strict Content-Security-Policy (allowing `challenges.cloudflare.com`
  for Turnstile).
- Sessions are `httpOnly`, `sameSite=lax`, and `secure` in production.
- Poster email addresses are never exposed — contact happens through a relay.
- IPs are hashed (HMAC-SHA256) for rate limiting; raw IPs are never stored.
- Uploads are stored as WebP with EXIF rotation applied; filenames are
  generated server-side.
- Admin access requires `ADMIN_PASSWORD`; login is rate-limited.

---

## Deployment

This is a standard Node/Express app. On a host that supports Node (e.g. Vercel,
Railway, Fly.io, or a small VPS):

1. Set the environment variables from `.env.example` (use real
   `SESSION_SECRET`, `ADMIN_PASSWORD`, and SMTP/Turnstile keys as needed).
2. Use **persistent** storage for the databases and uploads (`data/` and
   `public/uploads/` by default, or `DB_DIR` / `UPLOAD_DIR`) — ephemeral
   filesystems will lose data between deploys.
3. Run `npm install && npm start`.

> For a single-container/small-VPS setup, mount a volume for the data directory
> and uploads so the databases and images survive restarts.

### Running several markets (one process)

A single instance serves **all** markets — no per-market process is needed. The
request `Host` header selects the market, so the only requirement is that the
reverse proxy forwards the original `Host` (do not rewrite it to the upstream).

```bash
# Production: ONE process, ONE loopback port. No SITE= needed — hosts are detected.
NODE_ENV=production HOST=127.0.0.1 PORT=3000 npm start
```

Then point every hostname at that port and let the app route by `Host`:

| Host | Market | Database |
| ---- | ------ | -------- |
| `listnear.app` / `www.listnear.app` | `us` (apex; `www` 301s) | `data/us.sqlite` |
| `au.listnear.app` | `au` | `data/au.sqlite` |
| `gb.listnear.app` | `gb` | `data/gb.sqlite` |
| … | … | `data/<cc>.sqlite` |

Each market's SQLite file is created on first request. The server admin's deploy
script is at `/root/ops/classifieds/deploy.sh` (git pull → `patch-source.py` →
`npm ci --omit=dev` → restart systemd); nothing here requires SSH access.

#### Production notes (server admin)

- **DNS:** one wildcard record — `*.listnear.app` — plus the apex,
  `listnear.app`, and `www.listnear.app`. Every country subdomain resolves to
  the same host; the app routes by `Host`.
- **TLS:** a wildcard certificate covering `listnear.app` **and
  `*.listnear.app`**, so every country subdomain is served over HTTPS.
- **Reverse proxy:** one `server_name listnear.app www.listnear.app
  *.listnear.app;` block that forwards the original `Host` header (do **not**
  rewrite it) to the single Node process on `127.0.0.1`.
- **One process:** the Node app runs once and is the only thing listening;
  `HOST=127.0.0.1` behind the proxy.
- **Per-country data:** keep separate databases and uploads per country. Set
  `DB_DIR` and `UPLOAD_DIR` to persistent, backed-up locations (each country is
  `<DB_DIR>/<cc>.sqlite` and `<UPLOAD_DIR>/<cc>`) so one corrupt or locked file
  stays contained and backups/rollbacks can be per country.
- **Google Search Console:** verify a **Domain property** for `listnear.app` so
  every subdomain is covered, and submit the apex sitemap.
- **`ROOT_DOMAIN`:** only set this if the apex domain changes.
- **Enabling a country:** once its host resolves and a certificate exists, set
  `LISTNEAR_ENABLED_COUNTRIES` (or the catalogue flag) and make sure it has
  region/city data. Until then it shows "coming soon" — no code changes, no new
  process.
- **No ads:** no AdSense (or any ad) script is loaded; `ADS_ENABLED` is off and
  no ad slots are rendered.

---

## License

MIT
