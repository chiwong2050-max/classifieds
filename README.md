# Classifieds

A modern, **family-safe** classifieds web app — built to compete with the big
generalists while keeping the experience clean, fast and trustworthy.

- **Mobile-first & SEO-first** — server-rendered HTML, unique titles/meta and
  JSON-LD on every meaningful page, `sitemap.xml` and `robots.txt` generated
  from live data.
- **No accounts required** to post — email magic-link verification instead.
- **Reviewed by default** — every new ad starts as `pending` and a keyword
  filter auto-flags spam, adult, gambling/casino, weapons and drugs.
- **No personals / dating / adult categories at all.** Not a toggle — the
  category set simply doesn't contain them.
- **Multi-market engine** — one codebase runs several independent sites (e.g.
  an Australian site and a US site) on different domains, each with its own
  branding, currency, locale, date/units format and database.

The product name is a placeholder and is configurable via `SITE_NAME`.

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

1. **Categories** — Jobs, For Sale, Vehicles, Property / Rentals, Services,
   Community, Pets (rehoming only, restricted species prohibited) and Events.
   There are **no personals / dating / adult categories**.
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
   JSON-LD (`WebSite`, `BreadcrumbList`, `Product`, `JobPosting`, `Event`),
   canonical URLs and `robots.txt`.
8. **Abuse protection** — rate limiting, a honeypot field and a Cloudflare
   Turnstile placeholder (site key/secret via env; disabled when unset).
9. **Policy pages** — Privacy, Terms and Safety Tips, with a "Buy Me a Coffee"
   link in the footer.
10. **PWA** — manifest + service worker for the app shell.
11. **Developer friendly** — `.env.example`, a seed script with clearly-marked
    `[SAMPLE]` ads, and a DB reset script.

---

## Multi-market sites

The same codebase can run as several separate classifieds sites — for example a
US site and an Australian site — on different domains, each with its own
database and its own wording.

A **market** is a small JSON file in [`src/config/sites/`](src/config/sites)
(`au.json`, `us.json`, …) that defines:

| Field | Example | Purpose |
| ----- | ------- | ------- |
| `key` | `au` | Market identifier. |
| `name` / `tagline` | `Classifieds Australia` | Branding shown across the UI. |
| `country` / `countryName` | `au` / `Australia` | Country slug used in URLs (`/au/...`) and location data. |
| `currency` | `AUD` | Default currency for new ads. |
| `locale` / `language` | `en-AU` / `en` | Locale file selection and date/price formatting. |
| `dateFormat` | `D MMM YYYY` | Date pattern (`D MMM YYYY` vs `MMM D, YYYY`). |
| `units` | `metric` | Measurement system: `metric` (km) or `imperial` (mi). |
| `url` | `https://example.com` | Public base URL (canonicals, links, sitemap). |
| `database` | `data/au.sqlite` | Per-market SQLite file. |
| `supportUrl` / `emergencyNumber` | — | Footer support link and the safety page's emergency number. |
| `regions` | `{ vic: { name, cities: [...] } }` | Seeded `region > city` hierarchy for that market. |

**Run a market** by selecting it at start-up:

```bash
SITE=au npm start        # Australian site, data/au.sqlite
SITE=us npm start        # US site, data/us.sqlite
```

- Point `SITE_CONFIG` at any path to load a custom market file instead of a
  built-in one.
- Every value can be overridden with environment variables (`SITE_NAME`,
  `SITE_CURRENCY`, `SITE_URL`, `DB_PATH`, `SITE_LOCALE`, …), so the same build
  serves different domains with separate databases and no code changes.
- Deploy each market as its own process/container with its own `SITE` (or
  `SITE_CONFIG`), `SITE_URL`, `DB_PATH` and volume.

**UI text lives in locale files** under [`locales/`](locales): `en.json` is the
base language dictionary and is merged with the market's locale overrides
(`en-AU.json`, `en-US.json`). Views and routes only ever reference keys
(`t('nav.postAd')`) — there is no hard-coded English in the templates, so a
market can be re-worded without touching code. Categories stay family-safe in
every market: the category set contains **no personals / dating / adult**
options.

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
| `SITE` | Which market to run (a file in `src/config/sites/<key>.json`). | `au` |
| `SITE_CONFIG` | Path to a custom market JSON file (overrides `SITE`). | unset |
| `SITE_NAME` | Product name shown across the UI. | market file |
| `SITE_TAGLINE` | Short tagline for the home page. | market file |
| `SITE_URL` | Public base URL (canonicals, magic links, sitemap). | `http://localhost:3000` |
| `SITE_COUNTRY` | Two-letter country slug used in URLs (`/au/...`). | market file |
| `SITE_COUNTRY_NAME` | Country display name (meta/policy text). | market file |
| `SITE_CURRENCY` | Default currency for new ads (ISO 4217). | market file |
| `SITE_LOCALE` | Locale for date/price formatting and locale-file overrides. | market file |
| `SITE_LANGUAGE` | Base language dictionary (`locales/<lang>.json`). | `en` |
| `SITE_DATE_FORMAT` | Date pattern, e.g. `D MMM YYYY` or `MMM D, YYYY`. | market file |
| `SITE_UNITS` | `metric` (km) or `imperial` (mi). | market file |
| `DB_PATH` | Per-market SQLite file. | market file |
| `PORT` | HTTP port. | `3000` |
| `NODE_ENV` | `development` or `production`. | `development` |
| `SESSION_SECRET` | Signs session cookies. **Change in production.** | dev fallback |
| `ADMIN_PASSWORD` | Password for `/admin`. | unset (admin disabled) |
| `MAIL_TRANSPORT` | `console` (logs links) or `smtp`. | `console` |
| `MAIL_FROM` | From address for outgoing mail. | `Classifieds <no-reply@example.com>` |
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
classifieds/
├─ src/
│  ├─ config/            # Env config, i18n, categories, locations, sites/<key>.json markets
│  ├─ db/                # Connection, schema.sql, ads repository, seed + reset scripts
│  ├─ middleware/        # Locals, rate limits, Turnstile, admin auth, uploads
│  ├─ routes/            # pages, post, ads, manage, admin, seo, listings
│  ├─ services/          # mailer, images (sharp -> WebP), moderation
│  ├─ utils/             # helpers, url builders, JSON-LD builders
│  └─ server.js          # App entrypoint: security, sessions, routes, maintenance
├─ locales/              # UI text: en.json (base) + en-AU.json / en-US.json (market overrides)
├─ views/                # EJS templates (partials + pages, incl. admin)
├─ public/               # CSS, vanilla JS, icons, manifest, service worker, uploads
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
| GET | `/robots.txt` · `/sitemap.xml` | SEO endpoints. |
| GET | `/privacy/` · `/terms/` · `/safety/` | Policy pages. |

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

### Running several markets

To serve multiple markets (e.g. an AU and a US site), deploy **one instance per
market** and give each its own branding, domain, database and storage:

| Instance | `SITE` | `SITE_URL` | `DB_PATH` |
| -------- | ------ | ---------- | --------- |
| AU site  | `au`   | `https://example.com.au` | `data/au.sqlite` |
| US site  | `us`   | `https://example.com`    | `data/us.sqlite` |

Each instance needs its own `data/` and `public/uploads/` volume. Custom markets
can be added by dropping a JSON file in `src/config/sites/` (or pointing
`SITE_CONFIG` at one) — the code itself never changes.

---

## License

MIT
