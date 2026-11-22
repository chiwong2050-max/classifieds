'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const config = require('./config');
const { t } = require('./config/i18n');
const { localsMiddleware } = require('./middleware/locals');
const { browseLimiter } = require('./middleware/rateLimit');
const { ensureUploadDir } = require('./services/images');
const { expireDueAds, pruneExpiredTokens } = require('./db/ads');

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
        'script-src': ["'self'", 'https://challenges.cloudflare.com'],
        'frame-src': ['https://challenges.cloudflare.com'],
        'connect-src': ["'self'", 'https://challenges.cloudflare.com'],
        'img-src': ["'self'", 'data:'],
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

app.use(
  session({
    name: 'listnear.sid',
    secret: config.session.secret,
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
app.use(
  express.static(path.join(config.root, 'public'), {
    maxAge: config.isProduction ? '7d' : 0,
    setHeaders(res, filePath) {
      // User uploads are immutable-ish; cache them a little longer.
      if (filePath.includes(`${path.sep}uploads${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

// --- App locals + rate limit ----------------------------------------------
app.use(localsMiddleware);
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
function runMaintenance() {
  try {
    const expired = expireDueAds();
    if (expired) console.log(`[maintenance] expired ${expired} ad(s)`);
    pruneExpiredTokens();
  } catch (err) {
    console.warn('[maintenance] failed:', err.message);
  }
}
runMaintenance();
setInterval(runMaintenance, 1000 * 60 * 60); // hourly

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`\n  ${config.site.name} (${config.site.key}) listening on http://${config.host}:${config.port}`);
    console.log(`  Public URL: ${config.site.url}`);
    console.log(`  Environment: ${config.env}\n`);
  });
}

module.exports = app;
