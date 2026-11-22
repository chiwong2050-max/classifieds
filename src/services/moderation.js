'use strict';

const { scan } = require('../config/keywords');
const { t } = require('../config/i18n');

/**
 * Run moderation over an ad submission.
 *
 * Policy: every ad requires human approval, so status is always 'pending'
 * here. This function only decides whether the ad should be auto-flagged for
 * the admin (e.g. spam / adult / gambling / weapons / drugs keywords), along
 * with a human-readable list of matched reasons.
 *
 * @param {{title:string, description:string, category?:string}} ad
 * @returns {{ status:'pending', isFlagged:boolean, severity:'block'|'flag'|null, reasons:Array }}
 */
function moderateAd(ad) {
  const haystack = `${ad.title || ''}\n${ad.description || ''}`;
  const { matches, worstSeverity } = scan(haystack);

  const reasons = matches.map((m) => ({
    category: m.category,
    severity: m.severity,
    term: m.term,
  }));

  // Additionally flag if the category policy text is violated (pets live sales).
  if (ad.category === 'pets') {
    const liveSale = /\b(for sale|sell(ing)? (my|our)|puppies for sale|kittens for sale|breeder)\b/i.test(haystack);
    if (liveSale && !reasons.length) {
      reasons.push({ category: 'restricted_species', severity: 'flag', term: t('moderation.liveAnimalSale') });
    }
  }

  return {
    status: 'pending',
    isFlagged: reasons.length > 0,
    severity: worstSeverity || (reasons.length ? 'flag' : null),
    reasons,
  };
}

module.exports = { moderateAd };
