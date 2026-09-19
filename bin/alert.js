// cwi-milestone-wire / bin/alert.js
// Builds a structured, ethics-bound milestone alert payload. stdlib only.
'use strict';

const WIRE = 'cwi-milestone-wire';
const VERSION = '1.0.0';

// Suggested copy is ALWAYS labeled draft and is for CWI accounts only.
// Nothing here is authorized for Black's personal name, personal accounts,
// DMs, emails, or subscriber blasts — those need his exact-copy word.
function buildCopy(track, milestoneLine) {
  return {
    threads: `[DRAFT — CWI account only] MILESTONE: ${track} — ${milestoneLine}. Receipts at the wire. #ThatBoyHiHat #PostTrapFuturism`,
    instagram: `[DRAFT — CWI account only] MILESTONE: ${track} — ${milestoneLine}. Verified, receipts on the wire. #ThatBoyHiHat #PostTrapFuturism #RoadTo1M`,
    whatsapp: `[DRAFT — CWI street team only] MILESTONE: ${track} — ${milestoneLine}. Verified numbers only; share the receipt link, never inflate.`
  };
}

function buildAlert({ track, artist, milestone, detail, evidenceTier, verifiedDate, verification, receiptLink, baseline, demo }) {
  const tier = evidenceTier === 'SAMPLE' && demo ? 'SAMPLE (demo)' : evidenceTier;
  if (!['SILVER', 'BRONZE', 'REPORTED', 'SAMPLE (demo)'].includes(tier)) {
    throw new Error('REFUSED: alert requires a verified evidence tier (SILVER/BRONZE/REPORTED); got ' + evidenceTier);
  }
  return {
    wire: WIRE,
    version: VERSION,
    fired_at: new Date().toISOString(),
    demo: !!demo,
    track,
    artist: artist || 'That Boy Hi Hat',
    milestone,
    detail,
    evidence_tier: tier,
    verified_date: verifiedDate || null,
    verification,
    receipt_link: receiptLink || null,
    baseline: baseline || null,
    copy: buildCopy(track, detail),
    note: 'Suggested copy is draft-only. CWI accounts may fire per standing order; Black\'s personal name, DMs, emails, subscriber blasts, and personal Facebook stay gated.'
  };
}

module.exports = { buildAlert, WIRE, VERSION };
