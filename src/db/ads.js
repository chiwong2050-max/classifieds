'use strict';

const db = require('./index');
const { shortId, randomToken, sqliteNow, sqliteNowPlusDays } = require('../utils/helpers');
const { toFtsPhrase, toFtsAllWords } = require('./ftsQuery');
const config = require('../config');

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

function hydrateAd(row) {
  if (!row) return null;
  return {
    ...row,
    attrs: safeJson(row.attrs, {}),
    flag_reasons: safeJson(row.flag_reasons, []),
    is_flagged: Boolean(row.is_flagged),
  };
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const IMAGE_SELECT = `
  SELECT id, ad_id, filename, width, height, bytes, position
  FROM ad_images WHERE ad_id = ? ORDER BY position ASC, id ASC
`;

// Sub-select for a listing's first image (used to render card thumbnails).
const PRIMARY_IMAGE_SUBQUERY = `(
  SELECT filename FROM ad_images WHERE ad_id = a.id ORDER BY position ASC, id ASC LIMIT 1
) AS primary_image`;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Insert a new ad. Always created with status 'pending' unless explicitly set.
 * @returns {number} the new ad id
 */
function createAd(data) {
  const publicId = data.public_id || shortId();
  const manageToken = data.manage_token || randomToken(24);
  const attrs = JSON.stringify(data.attrs || {});
  const flagReasons = JSON.stringify(data.flag_reasons || []);

  const stmt = db.prepare(`
    INSERT INTO ads (
      public_id, slug, title, description, category,
      country, state, city, city_name,
      price_cents, price_type, currency, attrs,
      contact_name, contact_email, status, is_flagged, flag_reasons,
      manage_token, ip_hash, created_at, updated_at
    ) VALUES (
      @public_id, @slug, @title, @description, @category,
      @country, @state, @city, @city_name,
      @price_cents, @price_type, @currency, @attrs,
      @contact_name, @contact_email, @status, @is_flagged, @flag_reasons,
      @manage_token, @ip_hash, @created_at, @created_at
    )
  `);

  const info = stmt.run({
    public_id: publicId,
    slug: data.slug,
    title: data.title,
    description: data.description,
    category: data.category,
    country: data.country,
    state: data.state,
    city: data.city,
    city_name: data.city_name,
    price_cents: data.price_cents ?? null,
    price_type: data.price_type || 'fixed',
    currency: data.currency || config.site.currency,
    attrs,
    contact_name: data.contact_name,
    contact_email: data.contact_email,
    status: data.status || 'pending',
    is_flagged: data.is_flagged ? 1 : 0,
    flag_reasons: flagReasons,
    manage_token: manageToken,
    ip_hash: data.ip_hash || null,
    created_at: sqliteNow(),
  });

  return { id: info.lastInsertRowid, public_id: publicId, manage_token: manageToken };
}

function addImage(adId, image) {
  db.prepare(`
    INSERT INTO ad_images (ad_id, filename, width, height, bytes, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(adId, image.filename, image.width || null, image.height || null, image.bytes || null, image.position || 0);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function getByPublicId(publicId, { includeInactive = false } = {}) {
  const row = db.prepare('SELECT * FROM ads WHERE public_id = ?').get(publicId);
  if (!row) return null;
  if (!includeInactive && row.status !== 'active') return null;
  return hydrateAd(row);
}

function getById(id) {
  return hydrateAd(db.prepare('SELECT * FROM ads WHERE id = ?').get(id));
}

function getImages(adId) {
  return db.prepare(IMAGE_SELECT).all(adId);
}

function getPrimaryImage(adId) {
  return db.prepare(IMAGE_SELECT).get(adId) || null;
}

// ---------------------------------------------------------------------------
// Listing / search
// ---------------------------------------------------------------------------

function buildFilterSql(filters, params, { useFts, ftsPhrase }) {
  const clauses = ["a.status = 'active'"];
  if (filters.country) { clauses.push('a.country = @country'); params.country = filters.country; }
  if (filters.state) { clauses.push('a.state = @state'); params.state = filters.state; }
  if (filters.city) { clauses.push('a.city = @city'); params.city = filters.city; }
  if (filters.category) { clauses.push('a.category = @category'); params.category = filters.category; }

  if (filters.priceMin != null) {
    clauses.push("((a.price_type = 'free' AND 0 >= @priceMin) OR (a.price_cents IS NOT NULL AND a.price_cents >= @priceMin))");
    params.priceMin = filters.priceMin;
  }
  if (filters.priceMax != null) {
    clauses.push("((a.price_type = 'free') OR (a.price_cents IS NOT NULL AND a.price_cents <= @priceMax))");
    params.priceMax = filters.priceMax;
  }
  if (useFts) {
    // ftsPhrase is pre-escaped (see ftsQuery.toFtsPhrase) so user input is
    // matched as a literal phrase, never as FTS5 syntax.
    clauses.push('ads_fts MATCH @q');
    params.q = ftsPhrase;
  }
  return clauses.join(' AND ');
}

const SORTS = {
  recent: 'a.published_at DESC, a.id DESC',
  'price-asc': "CASE WHEN a.price_type='free' THEN 0 ELSE COALESCE(a.price_cents, 999999999) END ASC, a.id DESC",
  'price-desc': "CASE WHEN a.price_type='free' THEN 0 ELSE COALESCE(a.price_cents, -1) END DESC, a.id DESC",
};

/**
 * Run one search with a pre-escaped FTS query string (`ftsPhrase`), or without
 * FTS when that is null.
 * @returns {{ rows: object[], total: number }}
 */
function runSearch(filters, { limit, offset, sort, ftsPhrase }) {
  const params = {};
  const useFts = Boolean(ftsPhrase);
  const where = buildFilterSql(filters, params, { useFts, ftsPhrase });
  const orderBy = SORTS[sort] || SORTS.recent;

  const from = useFts
    ? 'ads_fts JOIN ads a ON a.id = ads_fts.rowid'
    : 'ads a';

  // When using FTS without an explicit sort, order by relevance (bm25).
  const rankedOrder = useFts && sort === 'recent'
    ? 'bm25(ads_fts) ASC, a.published_at DESC'
    : orderBy;

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`)
    .get(params).n;

  const rows = db
    .prepare(`SELECT a.*, ${PRIMARY_IMAGE_SUBQUERY} FROM ${from} WHERE ${where} ORDER BY ${rankedOrder} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return { rows: rows.map(hydrateAd), total };
}

/**
 * Query active ads with optional filters and full-text search.
 *
 * The user's words are matched as an exact phrase first (see ftsQuery). If that
 * finds nothing and the query has more than one word, we retry with all the
 * words AND-ed together, so a search still works when the words appear apart.
 * @returns {{ rows: object[], total: number }}
 */
function searchAds(filters = {}, { limit = 24, offset = 0, sort = 'recent' } = {}) {
  const phrase = toFtsPhrase(filters.q);
  const result = runSearch(filters, { limit, offset, sort, ftsPhrase: phrase });

  if (result.total === 0) {
    const allWords = toFtsAllWords(filters.q);
    if (allWords && allWords !== phrase) {
      return runSearch(filters, { limit, offset, sort, ftsPhrase: allWords });
    }
  }

  return result;
}

function countByLocation(country, state, city, category) {
  const params = { country, status: 'active', category };
  let sql = "SELECT COUNT(*) AS n FROM ads WHERE country = @country AND status = @status";
  if (state) { sql += ' AND state = @state'; params.state = state; }
  if (city) { sql += ' AND city = @city'; params.city = city; }
  if (category) sql += ' AND category = @category';
  else delete params.category;
  return db.prepare(sql).get(params).n;
}

function categoryCounts({ country, state, city } = {}) {
  const params = { status: 'active' };
  const clauses = ['status = @status'];
  if (country) { clauses.push('country = @country'); params.country = country; }
  if (state) { clauses.push('state = @state'); params.state = state; }
  if (city) { clauses.push('city = @city'); params.city = city; }
  const rows = db
    .prepare(`SELECT category, COUNT(*) AS n FROM ads WHERE ${clauses.join(' AND ')} GROUP BY category`)
    .all(params);
  const map = {};
  for (const r of rows) map[r.category] = r.n;
  return map;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function incrementViews(id) {
  db.prepare('UPDATE ads SET views = views + 1 WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

function approveAd(id) {
  const expiresAt = sqliteNowPlusDays(config.ad.expiryDays);
  db.prepare(`
    UPDATE ads
    SET status = 'active', published_at = COALESCE(published_at, @now),
        expires_at = @expires, reject_reason = NULL, updated_at = @now
    WHERE id = @id
  `).run({ id, now: sqliteNow(), expires: expiresAt });
}

function rejectAd(id, reason) {
  db.prepare(`
    UPDATE ads SET status = 'rejected', reject_reason = @reason, updated_at = @now WHERE id = @id
  `).run({ id, reason: reason || null, now: sqliteNow() });
}

function listForAdmin(status = 'pending', { limit = 100, offset = 0 } = {}) {
  const rows = db
    .prepare(`SELECT a.*, ${PRIMARY_IMAGE_SUBQUERY} FROM ads a WHERE status = ? ORDER BY is_flagged DESC, created_at DESC LIMIT ? OFFSET ?`)
    .all(status, limit, offset);
  return rows.map(hydrateAd);
}

function adminCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM ads GROUP BY status').all();
  const out = { pending: 0, active: 0, rejected: 0, expired: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

// ---------------------------------------------------------------------------
// Expiry / renew
// ---------------------------------------------------------------------------

/** Move active ads past their expiry to 'expired'. Returns count changed. */
function expireDueAds() {
  const info = db.prepare(`
    UPDATE ads SET status = 'expired', updated_at = @now
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < @now
  `).run({ now: sqliteNow() });
  return info.changes;
}

/** Ads expiring soon (for renewal reminder emails). */
function adsExpiringWithin(days = 3) {
  return db.prepare(`
    SELECT * FROM ads
    WHERE status = 'active' AND expires_at IS NOT NULL
      AND expires_at <= datetime('now', '+' || ? || ' days')
      AND expires_at > datetime('now')
  `).all(days).map(hydrateAd);
}

function getByManageToken(token) {
  return hydrateAd(db.prepare('SELECT * FROM ads WHERE manage_token = ?').get(token));
}

/** Renew an ad (by manage token) for another expiry window. */
function renewAd(token) {
  const ad = getByManageToken(token);
  if (!ad) return null;
  const expiresAt = sqliteNowPlusDays(config.ad.expiryDays);
  db.prepare(`
    UPDATE ads
    SET status = 'active', expires_at = @expires, renewed_at = @now, updated_at = @now
    WHERE id = @id
  `).run({ id: ad.id, expires: expiresAt, now: sqliteNow() });
  return { ...ad, expires_at: expiresAt, status: 'active' };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function createReport({ ad_id, public_id, reason, message, ip_hash }) {
  db.prepare(`
    INSERT INTO reports (ad_id, public_id, reason, message, ip_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(ad_id || null, public_id || null, reason, message || null, ip_hash || null);
}

function listReports({ limit = 100 } = {}) {
  return db.prepare(`
    SELECT r.*, a.title AS ad_title, a.status AS ad_status
    FROM reports r LEFT JOIN ads a ON a.id = r.ad_id
    ORDER BY r.handled ASC, r.created_at DESC LIMIT ?
  `).all(limit);
}

function markReportHandled(id, handled = 1) {
  db.prepare('UPDATE reports SET handled = ? WHERE id = ?').run(handled ? 1 : 0, id);
}

// ---------------------------------------------------------------------------
// Contact relay
// ---------------------------------------------------------------------------

function createContactMessage({ ad_id, from_name, from_email, body, ip_hash }) {
  db.prepare(`
    INSERT INTO contact_messages (ad_id, from_name, from_email, body, ip_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(ad_id || null, from_name, from_email, body, ip_hash || null);
}

// ---------------------------------------------------------------------------
// Verification tokens (magic links)
// ---------------------------------------------------------------------------

function createVerificationToken({ email, payload, ttlMinutes = 60 }) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + ttlMinutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`
    INSERT INTO verification_tokens (token, email, payload, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, email, JSON.stringify(payload), expires);
  return token;
}

/** Consume a token (marks used). Returns the token row or null if invalid/expired/used. */
function consumeVerificationToken(token) {
  const row = db.prepare('SELECT * FROM verification_tokens WHERE token = ?').get(token);
  if (!row) return null;
  if (row.used_at) return null;
  if (row.expires_at < sqliteNow()) return null;
  db.prepare('UPDATE verification_tokens SET used_at = ? WHERE id = ?').run(sqliteNow(), row.id);
  return { ...row, payload: safeJson(row.payload, null) };
}

function pruneExpiredTokens() {
  db.prepare("DELETE FROM verification_tokens WHERE expires_at < datetime('now', '-1 day')").run();
}

// ---------------------------------------------------------------------------
// Sitemap helpers
// ---------------------------------------------------------------------------

function allActiveForSitemap() {
  return db.prepare(`
    SELECT public_id, slug, category, country, state, city, updated_at, published_at
    FROM ads WHERE status = 'active'
    ORDER BY published_at DESC
  `).all();
}

function distinctActiveLocations() {
  return db.prepare(`
    SELECT country, state, city, city_name, COUNT(*) AS n
    FROM ads WHERE status = 'active'
    GROUP BY country, state, city
  `).all();
}

function distinctActiveCategoryLocations() {
  return db.prepare(`
    SELECT country, state, city, category, COUNT(*) AS n
    FROM ads WHERE status = 'active'
    GROUP BY country, state, city, category
  `).all();
}

module.exports = {
  createAd,
  addImage,
  getByPublicId,
  getById,
  getImages,
  getPrimaryImage,
  searchAds,
  countByLocation,
  categoryCounts,
  incrementViews,
  approveAd,
  rejectAd,
  listForAdmin,
  adminCounts,
  expireDueAds,
  adsExpiringWithin,
  getByManageToken,
  renewAd,
  createReport,
  listReports,
  markReportHandled,
  createContactMessage,
  createVerificationToken,
  consumeVerificationToken,
  pruneExpiredTokens,
  allActiveForSitemap,
  distinctActiveLocations,
  distinctActiveCategoryLocations,
};
