'use strict';

/**
 * Keyword moderation rules.
 *
 * Every rule has a `category` (used for admin triage) and a `severity`:
 *   - 'block': the ad is rejected/held and clearly surfaced to the admin.
 *   - 'flag' : the ad is auto-flagged as suspicious and held as "pending".
 *
 * This is intentionally conservative and easily extensible. It is a first
 * line of defence only - humans approve every ad. Each term is matched on
 * word boundaries to reduce false positives.
 */

const RULES = [
  // --- Adult / explicit (policy: no adult content at all) ---
  { category: 'adult', severity: 'block', terms: ['escort', 'escorts', 'massage parlour', 'happy ending', 'onlyfans', 'nsfw', 'xxx', 'porn', 'pornographic', 'adult services', 'sugar daddy', 'sugar baby', 'hookup', 'hook up', 'camgirl', 'webcam girls'] },
  { category: 'adult', severity: 'flag', terms: ['dating', 'sexy', 'lingerie modelling', 'nude', 'nudes'] },

  // --- Gambling / casino ---
  { category: 'gambling', severity: 'flag', terms: ['casino', 'poker', 'betting', 'sportsbet', 'bookmaker', 'roulette', 'slots bonus', 'free spins', 'gambling', 'online casino', 'bet now'] },

  // --- Weapons ---
  { category: 'weapons', severity: 'block', terms: ['firearm', 'handgun', 'glock', 'rifle', 'ammunition', 'silencer', 'suppressor', 'explosive', 'grenade', 'ghost gun', 'machine gun', 'switchblade'] },
  { category: 'weapons', severity: 'flag', terms: ['crossbow', 'pepper spray', 'knuckle duster', 'taser'] },

  // --- Drugs ---
  { category: 'drugs', severity: 'block', terms: ['cocaine', 'heroin', 'methamphetamine', 'ice pipe', 'mdma', 'ecstasy', 'crystal meth', 'fentanyl', 'steroids for sale', 'party pills'] },
  { category: 'drugs', severity: 'flag', terms: ['weed for sale', 'marijuana', 'cannabis oil', 'vape cart', 'pharmacy grade'] },

  // --- General spam / scams ---
  { category: 'spam', severity: 'flag', terms: ['bitcoin investment', 'double your money', 'guaranteed returns', 'forex signals', 'crypto giveaway', 'work from home earn', 'click here to win', 'loan approved', 'western union only', 'gift card payment', 'wire transfer only', 'whatsapp only', 'telegram only'] },
  { category: 'spam', severity: 'flag', terms: ['urgent payment required', 'send deposit first', 'no inspection', 'overseas seller'] },

  // --- Restricted species (pets policy) ---
  { category: 'restricted_species', severity: 'block', terms: ['crocodile for sale', 'venomous snake', 'rattlesnake', 'monkey for sale', 'lion cub', 'tiger cub', 'elephant', 'primates', 'exotic reptile', 'protected wildlife', 'cane toad'] },
  { category: 'restricted_species', severity: 'flag', terms: ['live export', 'wild caught', 'cites'] },
];

// Pre-compile word-boundary regexes once.
const COMPILED = RULES.map((rule) => ({
  ...rule,
  patterns: rule.terms.map((term) => ({
    term,
    regex: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  })),
}));

/**
 * Scan free text (title + body) for moderation rules.
 * @param {string} text
 * @returns {{ matches: Array<{category:string,severity:string,term:string}>, worstSeverity: 'block'|'flag'|null }}
 */
function scan(text) {
  const haystack = String(text || '');
  const matches = [];
  for (const rule of COMPILED) {
    for (const { term, regex } of rule.patterns) {
      if (regex.test(haystack)) {
        matches.push({ category: rule.category, severity: rule.severity, term });
      }
    }
  }

  let worstSeverity = null;
  if (matches.some((m) => m.severity === 'block')) worstSeverity = 'block';
  else if (matches.length) worstSeverity = 'flag';

  return { matches, worstSeverity };
}

module.exports = { RULES, scan };
