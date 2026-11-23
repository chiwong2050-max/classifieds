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

Every country is **catalogued**, but a market is only served when it has a real
region/city list. Countries without one stay `enabled: false` and render a
"coming soon" page (HTTP 200, `noindex,follow`) that links to the live markets —
never mock listings. The US (all 50 states + DC) and Australia are enabled, plus
a curated set of high-traffic markets; the rest enable as data is added. To
enable a country, add its regions to `regions.js` (and flip `enabled` in the
catalogue if it isn't derived from data).

### Databases

Each market gets its own SQLite file (`data/<code>.sqlite` by default) opened
lazily and cached per path. Sessions live in the same per-market file (cookie
`listnear.sid`), so a login on one market never leaks to another.

### UI text

**UI text lives in locale files** under [`locales/`](locales): `en.json` is the
base language dictionary, merged with the market's language file
(`<language>.json`) and locale overrides (`en-AU.json`, `en-US.json`). Views and
routes only ever reference keys (`t('nav.postAd')`) — there is no hard-coded
English in the templates, so a market can be re-worded without touching code.
Categories stay family-safe in every market: the category set contains **no
personals / dating / adult** options.

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
| `SITE_URL` | Public base URL (canonicals, magic links, sitemap). | `http://localhost:3000` |
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
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile keys. Leave blank to disable. | blank |
| `EMERGENCY_NUMBER` | Emergency number shown on the safety page. | market file |
| `SUPPORT_URL` | Footer support link. | market file |

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
| GET | `/:country/:state?/:city?/:category?` | Clean location/category listings. |
| GET | `/ad/:publicId/:slug?` | Ad detail (301 to canonical slug). |
| POST | `/ad/:publicId/contact` | Contact relay (hides poster email). |
| POST | `/ad/:publicId/report` | Report an ad. |
| GET/POST | `/post/` | Post-an-ad form + submission. |
| GET | `/verify/:token` | Magic-link email verification. |
| GET | `/manage/:token` · POST `/manage/:token/renew` | Manage / renew an ad. |
| GET | `/admin` (+ `/admin/login`, `/admin/ads/:id`, approve/reject, reports) | Moderation. |
| GET | `/api/locations` | Location data for the post-form cascade. |
| GET | `/robots.txt` · `/sitemap.xml` | SEO endpoints (per-market, from `SITE_URL`). |
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

1. Set the environment variables from `.env.example` (use real `SITE_URL`,
   `SESSION_SECRET`, `ADMIN_PASSWORD`, and SMTP/Turnstile keys as needed).
2. Use **persistent** storage for the SQLite file (`data/`) and `public/uploads/`
   — ephemeral filesystems will lose data between deploys.
3. Run `npm install && npm start`.

> For a single-container/small-VPS setup, mount a volume for `data/` and
> `public/uploads/` so the database and images survive restarts.

### Running several markets (one process)

A single instance serves **all** markets — no per-market process is needed. The
request `Host` header selects the market, so the only requirement is that the
reverse proxy forwards the original `Host` (do not rewrite it to the upstream).

```bash
# Production: ONE process, ONE port. No SITE= needed — hosts are detected.
NODE_ENV=production HOST=127.0.0.1 PORT=3000 SITE_URL=https://listnear.app npm start
```

Then point every hostname at that port and let the app route by `Host`:

| Host | Market | Database |
| ---- | ------ | -------- |
| `listnear.app` (US) | `us` | `data/us.sqlite` |
| `au.listnear.app` | `au` | `data/au.sqlite` |
| `gb.listnear.app` | `gb` | `data/gb.sqlite` |
| … | … | `data/<code>.sqlite` |

Each market's SQLite file is created on first request. Mount `data/` (and
`public/uploads/`) on persistent storage. The server admin's deploy script is at
`/root/ops/classifieds/deploy.sh` (git pull → `patch-source.py` → `npm ci
--omit=dev` → restart systemd); nothing here requires SSH access.

- **TLS & wildcard cert:** issue a certificate covering `listnear.app` **and
  `*.listnear.app`** so every country subdomain is served over HTTPS.
- **`HOST`:** keep `127.0.0.1` behind the proxy (set `0.0.0.0` only in a
  container without a loopback proxy).
- **`ROOT_DOMAIN`:** only set this if the apex domain changes.
- **Enabling a country:** the market exists as soon as the proxy resolves its
  hostname; if it has no region data yet it shows "coming soon" instead. Add its
  regions to `src/config/regions.js` to go live — no code changes, no new
  process.

---

## License

MIT
