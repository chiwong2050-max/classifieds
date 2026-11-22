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
| `SITE_NAME` | Product name shown across the UI. | `Classifieds` |
| `SITE_TAGLINE` | Short tagline for the home page. | `Buy, sell and connect locally` |
| `SITE_URL` | Public base URL (canonicals, magic links, sitemap). | `http://localhost:3000` |
| `DEFAULT_COUNTRY` | Default country slug. | `au` |
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
| `BUYMEACOFFEE_URL` | Footer support link. | `https://buymeacoffee.com/aussieloo?ref=classifieds` |

> **Secrets:** `.env` is git-ignored. Never commit real secrets. Only
> `.env.example` (placeholders) is tracked.

---

## Project structure

```
classifieds/
├─ src/
│  ├─ config/            # Categories, locations (country>state>city), banned keywords, env config
│  ├─ db/                # Connection, schema.sql, ads repository, seed + reset scripts
│  ├─ middleware/        # Locals, rate limits, Turnstile, admin auth, uploads
│  ├─ routes/            # pages, post, ads, manage, admin, seo, listings
│  ├─ services/          # mailer, images (sharp -> WebP), moderation
│  ├─ utils/             # helpers, url builders, JSON-LD builders
│  └─ server.js          # App entrypoint: security, sessions, routes, maintenance
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

---

## License

MIT
