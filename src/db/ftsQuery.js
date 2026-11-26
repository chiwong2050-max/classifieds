'use strict';

/**
 * Turn a user-supplied search string into a safe FTS5 MATCH phrase.
 *
 * FTS5 treats a lot of characters as query syntax: `"`, `*`, `(`, `)`, `:`,
 * `^`, `-`, `{column}` filters, and bare keywords like AND/OR/NEAR. Feeding raw
 * user input straight into `... MATCH ?` therefore lets a visitor crash the
 * query with a SqliteError (e.g. `q=*`, `q={search_term_string}`,
 * `q=' OR 1=1--`).
 *
 * To be safe we strip everything except letters, numbers and whitespace, then
 * wrap the remainder in double quotes so FTS5 matches it as a single literal
 * phrase - never as syntax. There is nothing left that can escape the quotes.
 *
 * @param {*} query raw user input
 * @returns {string|null} a quoted FTS5 phrase, or null when there is nothing
 *   searchable (the caller should then fall back to non-FTS filtering).
 */
function toFtsPhrase(query) {
  const cleaned = String(query == null ? '' : query)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop FTS operators and punctuation
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  return `"${cleaned}"`;
}

/**
 * The same input as {@link toFtsPhrase}, but each word is quoted and combined
 * with `AND`. Used as a fallback when the exact phrase matched nothing, so a
 * query like "red bike" still finds an ad that contains both words but not the
 * phrase. Every word is quoted individually, so none can act as FTS5 syntax.
 *
 * @returns {string|null} an FTS5 query, or null for single-word / empty input
 *   (in which case the phrase form is already equivalent).
 */
function toFtsAllWords(query) {
  const cleaned = String(query == null ? '' : query)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  return words.map((word) => `"${word}"`).join(' AND ');
}

module.exports = { toFtsPhrase, toFtsAllWords };
