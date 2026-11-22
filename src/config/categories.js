'use strict';

/**
 * Category definitions.
 *
 * IMPORTANT POLICY: this site is family-safe. There are deliberately NO
 * personals / dating / adult categories, and pet listings for restricted
 * species are prohibited (enforced in config/keywords.js and the post flow).
 *
 * Display strings (name / blurb / policy) come from locale files so the same
 * category set can be re-worded per market without touching code.
 *
 * `group` is used purely for grouping on the home page.
 * `icon` maps to an inline SVG symbol key in views.
 */
const { t } = require('./i18n');

const CATEGORY_DEFS = [
  { slug: 'for-sale', group: 'Buy & Sell', icon: 'tag' },
  { slug: 'jobs', group: 'Work', icon: 'briefcase' },
  { slug: 'services', group: 'Work', icon: 'wrench' },
  { slug: 'property-rentals', group: 'Property', icon: 'home' },
  { slug: 'vehicles', group: 'Buy & Sell', icon: 'car' },
  { slug: 'community', group: 'Local', icon: 'users' },
  { slug: 'wanted', group: 'Buy & Sell', icon: 'search' },
  { slug: 'pets', group: 'Local', icon: 'paw', hasPolicy: true },
];

const CATEGORIES = CATEGORY_DEFS.map((def) => ({
  slug: def.slug,
  group: def.group,
  icon: def.icon,
  name: t(`categories.${def.slug}.name`),
  blurb: t(`categories.${def.slug}.blurb`),
  // Policy note surfaced in the post form and on the category page.
  ...(def.hasPolicy ? { policy: t(`categories.${def.slug}.policy`) } : {}),
}));

const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

function getCategory(slug) {
  return CATEGORY_BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

function categoryName(slug) {
  const c = getCategory(slug);
  return c ? c.name : t('listing.allCategories');
}

module.exports = { CATEGORIES, getCategory, categoryName };
