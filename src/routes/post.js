'use strict';

const config = require('../config');
const ads = require('../db/ads');
const { getCategory } = require('../config/categories');
const { getCountry, getState, getCity, slugify } = require('../config/locations');
const { shortId, hashIp } = require('../utils/helpers');
const { processUploads } = require('../services/images');
const { moderateAd } = require('../services/moderation');
const mailer = require('../services/mailer');
const { upload } = require('../middleware/upload');
const { postLimiter } = require('../middleware/rateLimit');
const { turnstileMiddleware } = require('../middleware/turnstile');
const { t } = require('../config/i18n');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sentinel value for the "City not listed" free-text option in the city select.
const OTHER_CITY = '__other__';

function parsePrice(body) {
  if (body.price_type === 'free') return { price_cents: null, price_type: 'free' };
  if (body.price_type === 'contact') return { price_cents: null, price_type: 'contact' };
  const raw = String(body.price || '').replace(/[^0-9.]/g, '');
  const value = Number(raw);
  const cents = Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  return { price_cents: cents, price_type: body.price_type === 'negotiable' ? 'negotiable' : 'fixed' };
}

function collectAttrs(body) {
  const attrs = {};
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('attr_')) {
      const clean = String(value || '').trim();
      if (clean) attrs[key.slice(5)] = clean.slice(0, 120);
    }
  }
  return attrs;
}

function validate(body) {
  const errors = {};
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || '').trim();
  const country = String(body.country || config.site.country).trim().toLowerCase();
  const state = String(body.state || '').trim().toLowerCase();
  const city = String(body.city || '').trim().toLowerCase();
  const cityOther = String(body.city_other || '').trim();
  const contactName = String(body.contact_name || '').trim();
  const contactEmail = String(body.contact_email || '').trim();

  if (title.length < 6) errors.title = t('post.errorTitle');
  if (title.length > 120) errors.title = t('post.errorTitleMax');
  if (description.length < 20) errors.description = t('post.errorDescription');
  if (description.length > 5000) errors.description = t('post.errorDescriptionMax');
  if (!getCategory(category)) errors.category = t('post.errorCategory');
  if (!getCountry(country)) errors.country = t('post.errorCountry');
  if (!state || !getState(country, state)) {
    errors.state = t('post.errorState');
  } else if (!city) {
    errors.city = t('post.errorCity');
  } else if (city === OTHER_CITY) {
    // "City not listed" fallback: accept a free-text city so posters in small
    // towns are never blocked by the seeded city list.
    if (cityOther.length < 2) errors.city = t('post.errorCityOther');
  } else if (!getCity(country, state, city)) {
    errors.city = t('post.errorCity');
  }
  if (!contactName) errors.contact_name = t('post.errorName');
  if (!EMAIL_RE.test(contactEmail)) errors.contact_email = t('post.errorEmail');
  if (String(body.agree || '') !== 'yes') errors.agree = t('post.errorAgree');

  return {
    errors,
    values: { title, description, category, country, state, city, cityOther, contactName, contactEmail },
    hasErrors: Object.keys(errors).length > 0,
  };
}

/**
 * Resolve the final city slug + display name. Known cities use the seeded
 * config; the "city not listed" option stores the free-text value directly.
 */
function resolveCity(country, state, city, cityOther) {
  if (city === OTHER_CITY) {
    return { slug: slugify(cityOther) || 'other', name: cityOther };
  }
  const found = getCity(country, state, city);
  return found ? { slug: found.slug, name: found.name } : null;
}

/**
 * Multer wrapper: on an upload error (e.g. a non-image file), re-render the
 * form with HTTP 400 instead of letting it bubble up as an unhelpful 500.
 */
function uploadImages(req, res, next) {
  upload.array('images', config.uploads.maxImages)(req, res, (err) => {
    if (err) {
      const body = req.body || {};
      return res.status(400).render('pages/post', {
        title: t('post.title'),
        metaDescription: t('post.metaDescription', { siteName: config.site.name }),
        canonical: `${config.site.url}/post/`,
        robots: 'noindex,follow',
        errors: { images: err.message || t('post.errorImages') },
        values: { ...body },
        preselect: {
          country: body.country || config.site.country,
          state: body.state || '',
          city: body.city || '',
          category: body.category || '',
        },
      });
    }
    return next();
  });
}

module.exports = function postRoutes(app) {
  // --- Form -----------------------------------------------------------------
  app.get('/post/', (req, res) => {
    res.render('pages/post', {
      title: t('post.title'),
      metaDescription: t('post.metaDescription', { siteName: config.site.name }),
      canonical: `${config.site.url}/post/`,
      robots: 'noindex,follow',
      errors: {},
      values: { country: req.query.country || config.site.country, category: req.query.category || '' },
      preselect: { country: req.query.country || config.site.country, state: req.query.state || '', city: req.query.city || '', category: req.query.category || '' },
    });
  });

  // --- Submit ---------------------------------------------------------------
  app.post(
    '/post/',
    postLimiter,
    uploadImages,
    turnstileMiddleware,
    async (req, res, next) => {
      try {
        const body = req.body || {};

        // Honeypot: a hidden field that humans never fill in. If present, we
        // silently pretend success so bots don't learn to retry.
        if (String(body.website || '').trim() !== '') {
          return res.render('pages/verify-sent', {
            title: t('verifySent.title'),
            metaDescription: t('verifySent.metaDescription'),
            robots: 'noindex,nofollow',
            submittedEmail: String(body.contact_email || '').trim(),
            honeypotDropped: true,
          });
        }

        const { errors, values, hasErrors } = validate(body);
        if (hasErrors) {
          // Preserve the user's input (files can't be preserved across a
          // re-render, so we ask them to re-select if needed).
          return res.status(400).render('pages/post', {
            title: t('post.title'),
            robots: 'noindex,follow',
            canonical: `${config.site.url}/post/`,
            errors,
            values: { ...values, ...body, images: req.files },
            preselect: { country: values.country, state: values.state, city: values.city, category: values.category },
          });
        }

        const price = parsePrice(body);
        const attrs = collectAttrs(body);
        const moderation = moderateAd({ title: values.title, description: values.description, category: values.category });

        const images = await processUploads(req.files || []);

        const slugBase = slugify(values.title) || 'ad';
        const slug = `${slugBase.slice(0, 60)}-${shortId(4)}`;

        const place = resolveCity(values.country, values.state, values.city, values.cityOther);

        const payload = {
          ad: {
            public_id: shortId(),
            slug,
            title: values.title,
            description: values.description,
            category: values.category,
            country: values.country,
            state: values.state,
            city: place.slug,
            city_name: place.name,
            price_cents: price.price_cents,
            price_type: price.price_type,
            currency: config.site.currency,
            attrs,
            contact_name: values.contactName,
            contact_email: values.contactEmail,
            status: 'pending',
            is_flagged: moderation.isFlagged,
            flag_reasons: moderation.reasons,
            ip_hash: hashIp(req.ip),
          },
          images,
        };

        const token = ads.createVerificationToken({ email: values.contactEmail, payload });
        const verifyUrl = `${config.site.url}/verify/${token}`;
        await mailer.sendMagicLink({ to: values.contactEmail, verifyUrl });

        return res.render('pages/verify-sent', {
          title: t('verifySent.title'),
          metaDescription: t('verifySent.metaDescription'),
          robots: 'noindex,nofollow',
          submittedEmail: values.contactEmail,
          // Real submissions must pass this so verify-sent.ejs does not throw.
          // The honeypot path above sets it to true.
          honeypotDropped: false,
        });
      } catch (err) {
        return next(err);
      }
    }
  );

  // --- Magic-link verification ---------------------------------------------
  app.get('/verify/:token', (req, res) => {
    const record = ads.consumeVerificationToken(req.params.token);
    if (!record || !record.payload) {
      return res.status(400).render('pages/error', {
        title: t('error.linkExpiredTitle'),
        status: 400,
        message: t('error.linkExpiredBody'),
      });
    }

    const { ad, images = [] } = record.payload;
    const created = ads.createAd(ad);
    images.forEach((img, i) => ads.addImage(created.id, { ...img, position: i }));

    return res.render('pages/post-success', {
      title: t('postSuccess.title'),
      metaDescription: t('postSuccess.metaDescription'),
      robots: 'noindex,nofollow',
      adPublicId: created.public_id,
      manageToken: created.manage_token,
      isFlagged: Boolean(ad.is_flagged),
    });
  });
};
