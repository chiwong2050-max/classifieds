'use strict';

/**
 * Per-request market context.
 *
 * One Node process serves every market. The market is chosen from the incoming
 * `Host` header (see `src/config/market.js`) and stored in an AsyncLocalStorage
 * slot for the life of the request. Code that used to read a process-wide
 * `config.site` / `db` / `t()` now resolves them from this context, so the same
 * modules work for every country with no per-country copies.
 *
 * Outside a request (CLI scripts, startup, maintenance) `current()` returns
 * `null` and callers fall back to the default market.
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/** The active request context, or null when not inside a request. */
function current() {
  return storage.getStore() || null;
}

/** Run `fn` with `store` as the active market context (used by middleware). */
function run(store, fn) {
  return storage.run(store, fn);
}

module.exports = { current, run };
