'use strict';

const config = require('../config');
const { absolute, adUrl, imageUrl } = require('./urls');
const { categoryName } = require('../config/categories');

/**
 * Build JSON-LD blocks. Output is a JSON string that is safe to embed inside a
 * <script type="application/ld+json"> tag (we escape "<" to avoid breaking out).
 */
function toSafeJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function websiteJsonLd() {
  return toSafeJson({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: config.site.name,
    url: config.site.url,
    description: config.site.tagline,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${config.site.url}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  });
}

function breadcrumbJsonLd(items) {
  return toSafeJson({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url ? absolute(it.url) : undefined,
    })),
  });
}

/** Product schema for goods/vehicles/property-lite listings. */
function productJsonLd(ad, images = []) {
  const offers = {
    '@type': 'Offer',
    priceCurrency: ad.currency || 'AUD',
    availability: 'https://schema.org/InStock',
    url: absolute(adUrl(ad)),
  };
  if (ad.price_type === 'free') {
    offers.price = 0;
  } else if (ad.price_cents != null) {
    offers.price = (ad.price_cents / 100).toFixed(2);
  } else {
    delete offers.price;
    offers.priceSpecification = { '@type': 'PriceSpecification', priceCurrency: ad.currency || 'AUD' };
  }

  return toSafeJson({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: ad.title,
    description: ad.description.slice(0, 400),
    category: categoryName(ad.category),
    image: images.map((img) => absolute(imageUrl(img.filename))),
    offers,
    ...(ad.published_at ? { datePublished: ad.published_at.slice(0, 10) } : {}),
  });
}

/** JobPosting schema for Jobs category. */
function jobPostingJsonLd(ad) {
  const attrs = ad.attrs || {};
  const employmentType = attrs.job_type ? String(attrs.job_type).toUpperCase().replace(/[^A-Z]/g, '_') : 'OTHER';
  const block = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: ad.title,
    description: ad.description,
    datePosted: (ad.published_at || ad.created_at || '').slice(0, 10),
    employmentType,
    hiringOrganization: { '@type': 'Organization', name: config.site.name },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: ad.city_name,
        addressRegion: ad.state,
        addressCountry: ad.country.toUpperCase(),
      },
    },
  };
  if (ad.expires_at) block.validThrough = ad.expires_at.slice(0, 10);
  if (ad.price_cents != null && ad.price_cents > 0) {
    block.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: ad.currency || 'AUD',
      value: { '@type': 'QuantitativeValue', value: ad.price_cents / 100, unitText: 'YEAR' },
    };
  }
  return toSafeJson(block);
}

/** Event schema for Events category. */
function eventJsonLd(ad) {
  const attrs = ad.attrs || {};
  const block = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ad.title,
    description: ad.description,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: {
      '@type': 'Place',
      name: ad.city_name,
      address: {
        '@type': 'PostalAddress',
        addressLocality: ad.city_name,
        addressRegion: ad.state,
        addressCountry: ad.country.toUpperCase(),
      },
    },
    organizer: { '@type': 'Organization', name: config.site.name, url: config.site.url },
  };
  if (attrs.event_date) {
    block.startDate = attrs.event_date;
  }
  return toSafeJson(block);
}

/** Pick the most appropriate schema for a given ad. */
function adJsonLd(ad, images = []) {
  if (ad.category === 'jobs') return jobPostingJsonLd(ad);
  if (ad.category === 'events') return eventJsonLd(ad);
  return productJsonLd(ad, images);
}

module.exports = {
  websiteJsonLd,
  breadcrumbJsonLd,
  productJsonLd,
  jobPostingJsonLd,
  eventJsonLd,
  adJsonLd,
};
