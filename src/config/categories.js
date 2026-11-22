'use strict';

/**
 * Category definitions.
 *
 * IMPORTANT POLICY: this site is family-safe. There are deliberately NO
 * personals / dating / adult categories, and pet listings for restricted
 * species are prohibited (enforced in config/keywords.js and the post flow).
 *
 * `group` is used purely for grouping on the home page.
 * `icon` maps to an inline SVG symbol key in views.
 */
const CATEGORIES = [
  {
    slug: 'jobs',
    name: 'Jobs',
    group: 'Work',
    icon: 'briefcase',
    blurb: 'Full-time, part-time and casual roles.',
  },
  {
    slug: 'for-sale',
    name: 'For Sale',
    group: 'Buy & Sell',
    icon: 'tag',
    blurb: 'Second-hand and new goods.',
  },
  {
    slug: 'vehicles',
    name: 'Vehicles',
    group: 'Buy & Sell',
    icon: 'car',
    blurb: 'Cars, bikes, boats and parts.',
  },
  {
    slug: 'property-rentals',
    name: 'Property / Rentals',
    group: 'Property',
    icon: 'home',
    blurb: 'Rentals, share houses and land.',
  },
  {
    slug: 'services',
    name: 'Services',
    group: 'Work',
    icon: 'wrench',
    blurb: 'Trades, tutoring, cleaning and more.',
  },
  {
    slug: 'community',
    name: 'Community',
    group: 'Local',
    icon: 'users',
    blurb: 'Notices, groups and local happenings.',
  },
  {
    slug: 'pets',
    name: 'Pets',
    group: 'Local',
    icon: 'paw',
    blurb: 'Rehoming, accessories and supplies.',
    // Policy note surfaced in the post form and category page.
    policy:
      'Live animal sales are restricted. Rehoming/adoption notices only, and never for restricted species.',
  },
  {
    slug: 'events',
    name: 'Events',
    group: 'Local',
    icon: 'calendar',
    blurb: 'What is on near you.',
  },
];

const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

function getCategory(slug) {
  return CATEGORY_BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

function categoryName(slug) {
  const c = getCategory(slug);
  return c ? c.name : 'All categories';
}

module.exports = { CATEGORIES, getCategory, categoryName };
