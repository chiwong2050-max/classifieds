'use strict';

/**
 * Central configuration. Reads environment variables (via dotenv) and
 * exposes typed values with safe defaults so the app boots with zero config.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env from the project root (silent if it doesn't exist).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ROOT = path.resolve(__dirname, '../..');

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 3000),
  root: ROOT,

  site: {
    name: process.env.SITE_NAME || 'Classifieds',
    tagline: process.env.SITE_TAGLINE || 'Buy, sell and connect locally',
    url: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    defaultCountry: (process.env.DEFAULT_COUNTRY || 'au').toLowerCase(),
    buyMeACoffeeUrl: process.env.BUYMEACOFFEE_URL || 'https://buymeacoffee.com/aussieloo?ref=classifieds',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    // 30 days, matches ad expiry window for user convenience.
    maxAgeMs: 1000 * 60 * 60 * 24 * 30,
  },

  admin: {
    password: process.env.ADMIN_PASSWORD || '',
  },

  mail: {
    transport: process.env.MAIL_TRANSPORT || 'console',
    from: process.env.MAIL_FROM || 'Classifieds <no-reply@example.com>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: int(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },

  uploads: {
    // Absolute path to the upload directory.
    dir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'public/uploads'),
    // Public URL prefix used when rendering <img src>.
    publicPath: '/uploads',
    maxImages: int(process.env.MAX_IMAGES_PER_AD, 6),
    maxFileSizeBytes: 8 * 1024 * 1024, // 8MB per uploaded file
    maxWidth: 1600,
    webpQuality: 80,
  },

  ad: {
    expiryDays: int(process.env.AD_EXPIRY_DAYS, 30),
  },

  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    get enabled() {
      return Boolean(this.siteKey && this.secretKey);
    },
  },
};

module.exports = config;
