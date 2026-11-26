'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const config = require('./config');
const context = require('./config/context');
const { t } = require('./config/i18n');
const { localsMiddleware } = require('./middleware/locals');
const { marketMiddleware, marketGate } = require('./middleware/market');
const { browseLimiter } = require('./middleware/rateLimit');
const { ensureUploadDir } = require('./services/images');
const { expireDueAds, pruneExpiredTokens } = require('./db/ads');
const db = require('./db');
const SqliteSessionStore = require('./db/sessionStore');

const app = express();

// Behind a reverse proxy (Vercel/nginx), trust the first hop for correct IPs.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(config.root, 'views'));

// --- Security headers ------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'],
        'frame-src': ['https://challenges.cloudflare.com'],
        // Cloudflare Turnstile + Web Analytics (RUM beacon) endpoints.
        'connect-src': [
          "'self'",
          'https://challenges.cloudflare.com',
          'https://static.cloudflareinsights.com',
          'https://cloudflareinsights.com',
        ],
        // Area pages show a photo from Wikimedia Commons, so allow that host.
        'img-src': ["'self'", 'data:', 'https://upload.wikimedia.org', 'https://commons.wikimedia.org'],
        'style-src': ["'self'", "'unsafe-inline'"],
        // Keep https-only upgrades off for local dev over http.
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());

// --- Parsers ---------------------------------------------------------------
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(config.session.secret));

// --- Market resolution -----------------------------------------------------
// Resolve the market from the Host header *before* the session middleware, so
// session rows are read from / written to the correct market database.
app.use(marketMiddleware);

app.use(
  session({
    name: 'listnear.sid',
    secret: config.session.secret,
    // Persistent store so logins survive restarts (see src/db/sessionStore.js).
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: config.session.maxAgeMs,
    },
  })
);

// --- Static assets ---------------------------------------------------------
ensureUploadDir();

// User uploads live in a per-market directory (<base>/<cc>). Serve ONLY the
// current market's files at /uploads, so one country can never read another's
// images. A static handler is cached per directory to avoid rebuilding it on
// every request.
const uploadStaticCache = new Map();
function serveUploads(req, res, next) {
  const dir = config.uploads.dir;
  let handler = uploadStaticCache.get(dir);
  if (!handler) {
    handler = express.static(dir, { maxAge: config.isProduction ? '1d' : 0 });
    uploadStaticCache.set(dir, handler);
  }
  return handler(req, res, next);
}
app.use('/uploads', serveUploads);

// Everything else comes from the shared public bundle. The guard stops the
// generic handler from ever reaching upload files (handled above).
const publicStatic = express.static(path.join(config.root, 'public'), {
  maxAge: config.isProduction ? '7d' : 0,
  setHeaders(res, filePath) {
    const base = path.basename(filePath);
    // PWA entry points must always revalidate so new builds ship at once.
    if (base === 'sw.js' || base === 'manifest.webmanifest') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
});
app.use((req, res, next) => {
  if (/^\/uploads(\/|$)/.test(req.path)) return next();
  return publicStatic(req, res, next);
});

// Browsers and crawlers still ask for /favicon.ico; point them at our SVG mark.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

// --- App locals + rate limit ----------------------------------------------
app.use(localsMiddleware);
// Registered-but-disabled markets show "coming soon"; reserved/unknown 404.
// Placed after static assets so those pages still load their CSS/JS.
app.use(marketGate);
app.use(browseLimiter);

// --- Routes ----------------------------------------------------------------
require('./routes/seo')(app);
require('./routes/pages')(app);
require('./routes/post')(app);
require('./routes/ads')(app);
require('./routes/manage')(app);
require('./routes/admin')(app);
// The location/category resolver is greedy, so it must be registered last.
require('./routes/listings')(app);

// --- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('pages/error', {
    title: t('error.notFoundTitle'),
    status: 404,
    message: t('error.notFoundBody'),
  });
});

// --- Error handler ---------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).render('pages/error', {
    title: status === 403 ? t('error.forbiddenTitle') : t('error.genericTitle'),
    status,
    message:
      status === 500
        ? t('error.genericBody')
        : err.message || t('error.requestFailed'),
  });
});

// --- Background maintenance ------------------------------------------------
// Runs per market: iterate every database opened so far and expire/prune
// inside that market's context so the DB proxy targets the right file.
function runMaintenance() {
  for (const site of db.openSites()) {
    context.run({ site }, () => {
      try {
        const expired = expireDueAds();
        if (expired) console.log(`[maintenance] ${site.key}: expired ${expired} ad(s)`);
        pruneExpiredTokens();
        const stale = SqliteSessionStore.pruneExpired();
        if (stale) console.log(`[maintenance] ${site.key}: pruned ${stale} stale session(s)`);
      } catch (err) {
        console.warn(`[maintenance] ${site.key} failed:`, err.message);
      }
    });
  }
}
runMaintenance();
// Not referenced, so tests can load the app without the timer holding the
// process open; the running server keeps it alive in production.
setInterval(runMaintenance, 1000 * 60 * 60).unref(); // hourly

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`\n  ListNear multi-market server listening on http://${config.host}:${config.port}`);
    console.log(`  Default market (non-matching hosts): ${config.defaultSite.name} (${config.defaultSite.key}) - ${config.defaultSite.url}`);
    console.log(`  Markets resolved from Host header. Environment: ${config.env}\n`);
  });
}

module.exports = app;
