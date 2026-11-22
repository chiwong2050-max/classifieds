'use strict';

/**
 * Seed script - inserts a handful of CLEARLY-MARKED sample ads so you can see
 * the site working immediately. Every seeded ad:
 *   - has a title prefixed with "[SAMPLE]"
 *   - uses obviously fake contact details (@example.com)
 *   - is published as an approved, active ad
 *
 * Run with:  npm run seed
 * Re-running is safe: it clears previously-seeded SAMPLE ads first.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const config = require('../config');
const db = require('./index');
const ads = require('./ads');
const { shortId, randomToken, sqliteNow, sqliteNowPlusDays } = require('../utils/helpers');
const { getCity } = require('../config/locations');

const SAMPLES = [
  {
    title: '[SAMPLE] Vintage road bike, recently serviced',
    description:
      'Classic steel-frame road bike in great condition. New tyres and brake pads fitted last month. Rides smoothly, ideal for commuting or weekend rides. Pick-up only, happy to answer any questions.',
    category: 'for-sale',
    country: 'au', state: 'vic', city: 'melbourne',
    price: 320, price_type: 'negotiable',
    attrs: { condition: 'Good' },
    contact_name: 'Sample Seller',
    contact_email: 'seller.bike@example.com',
    colors: ['#0b6bcb', '#128a4b'],
  },
  {
    title: '[SAMPLE] 2016 hatchback, low kilometres, logbooks',
    description:
      'Reliable and economical hatchback with full service history and logbooks. Two owners from new, regularly serviced, new battery. Registered and ready to go. Inspections welcome.',
    category: 'vehicles',
    country: 'au', state: 'nsw', city: 'sydney',
    price: 12500, price_type: 'fixed',
    attrs: { make: 'Sample Motors', model: 'Compact', year: '2016', odometer: '78000' },
    contact_name: 'Sample Dealer',
    contact_email: 'cars@example.com',
    colors: ['#b26a00', '#c62828'],
  },
  {
    title: '[SAMPLE] Two-bedroom unit close to transport',
    description:
      'Bright two-bedroom unit a short walk from the train station and shops. Freshly painted, built-in robes and a sunny balcony. Available now, inspections by appointment.',
    category: 'property-rentals',
    country: 'au', state: 'qld', city: 'brisbane',
    price: 520, price_type: 'fixed',
    attrs: { bedrooms: '2', bathrooms: '1' },
    contact_name: 'Sample Agent',
    contact_email: 'rentals@example.com',
    colors: ['#128a4b', '#0b6bcb'],
  },
  {
    title: '[SAMPLE] Friendly local gardener, mowing & hedges',
    description:
      'Local gardening service covering mowing, edging, weeding and hedge trimming. Fully insured, own equipment, friendly service. Free quotes for regular or one-off jobs.',
    category: 'services',
    country: 'au', state: 'wa', city: 'perth',
    price: 60, price_type: 'contact',
    attrs: {},
    contact_name: 'Sample Gardener',
    contact_email: 'garden@example.com',
    colors: ['#0e6e3c', '#3ec27e'],
  },
  {
    title: '[SAMPLE] Casual cafe team member wanted',
    description:
      'Busy neighbourhood cafe looking for a friendly casual team member. Barista experience a bonus but full training provided. Weekend availability essential. Great team, flexible hours.',
    category: 'jobs',
    country: 'au', state: 'sa', city: 'adelaide',
    price: null, price_type: 'contact',
    attrs: { job_type: 'Casual', salary: '$30 per hour' },
    contact_name: 'Sample Cafe',
    contact_email: 'jobs@example.com',
    colors: ['#5b6b7c', '#0b6bcb'],
  },
  {
    title: '[SAMPLE] Community garage sale this Saturday',
    description:
      'Neighbourhood garage sale this Saturday from 8am. Household items, books, toys and furniture. Everything priced to go. Come along and say hello - cash only, please.',
    category: 'community',
    country: 'au', state: 'tas', city: 'hobart',
    price: null, price_type: 'free',
    attrs: {},
    contact_name: 'Sample Neighbour',
    contact_email: 'community@example.com',
    colors: ['#b26a00', '#128a4b'],
  },
];

/** Build a simple horizontal-gradient WebP (no SVG, so no font dependencies). */
async function makeImage(name, [c1, c2], width = 1200, height = 900) {
  const parse = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const [r1, g1, b1] = parse(c1);
  const [r2, g2, b2] = parse(c2);
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = x / (width - 1);
      const i = (y * width + x) * 3;
      raw[i] = Math.round(r1 + (r2 - r1) * t);
      raw[i + 1] = Math.round(g1 + (g2 - g1) * t);
      raw[i + 2] = Math.round(b1 + (b2 - b1) * t);
    }
  }
  const dir = config.uploads.dir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await sharp(raw, { raw: { width, height, channels: 3 } }).webp({ quality: 80 }).toFile(path.join(dir, name));
  const thumb = name.replace(/\.webp$/, '-thumb.webp');
  await sharp(raw, { raw: { width, height, channels: 3 } }).resize(480, 360, { fit: 'cover' }).webp({ quality: 72 }).toFile(path.join(dir, thumb));
  return { filename: name, width, height };
}

async function seed() {
  // Clear previous sample ads so re-seeding stays tidy.
  const existing = db.prepare("SELECT id FROM ads WHERE title LIKE '[SAMPLE]%'").all();
  if (existing.length) {
    const del = db.prepare('DELETE FROM ads WHERE id = ?');
    const tx = db.transaction((rows) => rows.forEach((r) => del.run(r.id)));
    tx(existing);
    console.log(`Removed ${existing.length} previous sample ad(s).`);
  }

  for (const s of SAMPLES) {
    const created = ads.createAd({
      public_id: shortId(),
      slug: `${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55)}-${shortId(4)}`,
      title: s.title,
      description: s.description,
      category: s.category,
      country: s.country,
      state: s.state,
      city: s.city,
      city_name: getCity(s.country, s.state, s.city).name,
      price_cents: s.price ? Math.round(s.price * 100) : null,
      price_type: s.price_type,
      currency: 'AUD',
      attrs: s.attrs,
      contact_name: s.contact_name,
      contact_email: s.contact_email,
      status: 'pending',
      manage_token: randomToken(24),
    });

    // Publish immediately (these are demonstration ads).
    ads.approveAd(created.id);
    db.prepare('UPDATE ads SET created_at = ?, published_at = ?, expires_at = ? WHERE id = ?').run(
      sqliteNow(), sqliteNow(), sqliteNowPlusDays(config.ad.expiryDays), created.id
    );

    const img = await makeImage(`sample-${created.id}-${shortId(5)}.webp`, s.colors);
    ads.addImage(created.id, { ...img, bytes: null, position: 0 });

    console.log(`Seeded: ${s.title}`);
  }

  console.log('\nSeed complete. Sample ads are marked "[SAMPLE]" and use @example.com contacts.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
