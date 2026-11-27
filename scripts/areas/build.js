#!/usr/bin/env node
'use strict';

/**
 * Area-JSON build job (run by a server admin; NOT started by the web process).
 *
 * Reads LOCAL source caches and writes one JSON file per suburb/town into an
 * output tree that can be copied to the app host's `AREAS_DIR`. Network is a
 * last resort (`--allow-network`) for a missing Wikipedia extract only, and is
 * rate-limited and cached.
 *
 * Where it runs: on the machine that holds the caches (today: UltaHost), where
 * the OSM extracts, the Wikipedia/Commons cache and the directory databases
 * live. The app host (OVH #2) only receives the finished JSON tree - it has no
 * extracts, caches or directory DBs.
 *
 * Usage:
 *   node scripts/areas/build.js --country au --state vic
 *   node scripts/areas/build.js --country us --state ca --limit 20 --dry-run
 *
 * Operator wrap (low impact):
 *   nice -n 19 ionice -c idle node scripts/areas/build.js --country au --state nsw
 *
 * Options:
 *   --country <cc>       limit to one country (ISO code)
 *   --state <slug>       limit to one state/territory slug (e.g. vic, nsw)
 *   --sources <dir>      source directory              (default data/areas-src)
 *   --out <dir>          output tree                   (default data/areas-out)
 *   --cache <dir>        network cache                 (default .cache/areas)
 *   --nearby-max-km <n>  neighbour radius in km        (default 120)
 *   --nearby-limit <n>   neighbours per area           (default 5)
 *   --limit <n>          cap the number of areas       (trials)
 *   --dry-run            build in memory, write nothing
 *   --allow-network      allow the rate-limited Wikipedia fallback
 *   --help               show this message
 *
 * The job is idempotent: it stages files and then renames each into place, so
 * a reader never sees a half-written file. It also honours the load gate at
 * /usr/local/bin/main-ok.sh when that exists, and drops to the lowest CPU/IO
 * priority. Do not schedule it at 03:00 Australia/Melbourne.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./lib');
const network = require('./network');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULTS = {
  sources: 'data/areas-src',
  out: 'data/areas-out',
  cache: '.cache/areas',
};
const LOAD_GATE = '/usr/local/bin/main-ok.sh';

const log = (...args) => console.log('[areas]', new Date().toISOString(), ...args);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [rawKey, inline] = token.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) {
        args[key] = inline;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      'Area-JSON build job. Reads local source caches and writes one JSON file',
      'per suburb/town into an output tree for the app host\'s AREAS_DIR.',
      '',
      'Usage:',
      '  node scripts/areas/build.js --country au --state vic',
      '',
      'Options:',
      '  --country <cc>       limit to one country (ISO code)',
      '  --state <slug>       limit to one state/territory slug (e.g. vic, nsw)',
      `  --sources <dir>      source directory   (default ${DEFAULTS.sources})`,
      `  --out <dir>          output tree        (default ${DEFAULTS.out})`,
      `  --cache <dir>        network cache      (default ${DEFAULTS.cache})`,
      '  --nearby-max-km <n>  neighbour radius in km (default 120)',
      '  --nearby-limit <n>   neighbours per area (default 5)',
      '  --limit <n>          cap the number of areas (trials)',
      '  --dry-run            build in memory, write nothing',
      '  --allow-network      allow the rate-limited Wikipedia fallback',
      '  --help               show this message',
      '',
    ].join('\n')
  );
}

/** Respect the host load gate when the admin has installed one. */
function loadGateOk() {
  if (!fs.existsSync(LOAD_GATE)) return true;
  const result = spawnSync(LOAD_GATE, { stdio: 'ignore' });
  return result.status === 0;
}

/** Best-effort low priority; the operator wrapper (nice/ionice) is stronger. */
function applyLowPriority() {
  try {
    os.setPriority(0, 19);
  } catch {
    /* not permitted on this platform - ignore */
  }
}

/** Fill missing Wikipedia extracts from the (rate-limited, cached) network. */
async function enrichFromNetwork(entries, wiki, cacheDir) {
  for (const entry of entries) {
    const existing = wiki[entry.slug];
    if (existing && existing.extract) continue;
    try {
      const summary = await network.wikiSummary(entry.name, { cacheDir });
      if (summary) wiki[entry.slug] = { ...(existing || {}), ...summary };
    } catch (err) {
      log(`network lookup failed for ${entry.slug}: ${err.message}`);
    }
  }
}

function groupSummary(areas) {
  const groups = new Map();
  for (const area of areas) {
    const key = `${area.country}/${area.state}`;
    const g = groups.get(key) || { areas: 0, wiki: 0, photo: 0, population: 0, nearby: 0, places: 0, businesses: 0 };
    g.areas += 1;
    if (area.wiki) g.wiki += 1;
    if (area.photo) g.photo += 1;
    if (area.population) g.population += 1;
    if (area.nearby.length) g.nearby += 1;
    if (area.places.length) g.places += 1;
    if (area.businesses.length) g.businesses += 1;
    groups.set(key, g);
  }
  return groups;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { help: true };
  }

  const country = args.country ? String(args.country).toLowerCase() : null;
  const state = args.state ? String(args.state).toLowerCase() : null;
  const sourcesDir = path.resolve(ROOT, args.sources || DEFAULTS.sources);
  const outDir = path.resolve(ROOT, args.out || DEFAULTS.out);
  const cacheDir = path.resolve(ROOT, args.cache || DEFAULTS.cache);
  const limit = args.limit ? Math.max(0, parseInt(args.limit, 10)) : 0;
  const maxKm = args.nearbyMaxKm ? Number(args.nearbyMaxKm) : 120;
  const nearbyLimit = args.nearbyLimit ? parseInt(args.nearbyLimit, 10) : 5;
  const dryRun = Boolean(args.dryRun);
  const allowNetwork = Boolean(args.allowNetwork);

  log(`start country=${country || 'all'} state=${state || 'all'} sources=${sourcesDir} out=${outDir} network=${allowNetwork ? 'on' : 'off'}${dryRun ? ' dry-run' : ''}`);

  if (!loadGateOk()) {
    log('load gate not ok (main-ok.sh); skipping this run');
    return { skipped: 'load-gate' };
  }
  applyLowPriority();

  const src = lib.loadSources(sourcesDir, { maxKm, limit: nearbyLimit });
  log(
    `sources: places=${src.entries.length} wiki=${Object.keys(src.wiki).length}` +
      ` unique-coords=${src.coords.size} places.json=${Object.keys(src.places).length}` +
      ` businesses=${Object.keys(src.businesses).length} nearby=${src.nearby ? 'yes' : 'no'}`
  );
  let entries = src.entries;
  if (country) entries = entries.filter((e) => e.country === country);
  if (state) entries = entries.filter((e) => e.state === state);
  if (limit > 0) entries = entries.slice(0, limit);

  if (!entries.length) {
    log('no places matched the filter; nothing to do');
    return { written: [], areas: [] };
  }

  if (allowNetwork) await enrichFromNetwork(entries, src.wiki, cacheDir);

  const areas = entries.map((entry) => lib.buildArea(entry, src));
  for (const [key, g] of groupSummary(areas)) {
    log(`${key}: ${g.areas} area(s) (wiki ${g.wiki}, photo ${g.photo}, population ${g.population}, nearby ${g.nearby}, places ${g.places}, businesses ${g.businesses})`);
  }

  if (dryRun) {
    log(`dry-run: would write ${areas.length} file(s) under ${outDir}`);
    return { dryRun: true, areas };
  }

  const written = lib.writeAreas(outDir, areas);
  log(`wrote ${written.length} file(s) under ${outDir}`);
  return { written, areas };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[areas] failed:', err.message);
      process.exit(1);
    });
}

module.exports = { main, parseArgs, loadGateOk, DEFAULTS };
