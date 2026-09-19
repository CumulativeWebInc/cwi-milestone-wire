#!/usr/bin/env node
// cwi-milestone-wire / bin/detect.js
// Milestone-detection sensor. Zero dependencies, Node stdlib only.
//
// Compares VERIFIED sources against thresholds and emits alert payloads
// only on real crossings. Rules (ethics-bound):
//   - evidence_tier must be SILVER, BRONZE, or REPORTED. SAMPLE and
//     PROJECTED records NEVER fire — unless --demo is passed, in which
//     case the alert is stamped demo:true and labeled SAMPLE.
//   - placements verified before the wire armed are the baseline; they
//     never fire. New verified placements and position jumps do.
//   - a stream milestone fires only when a new figure EXCEEDS the last
//     verified figure and crosses a configured threshold.
//   - state/state.json always carries the honest current status.
'use strict';

const fs = require('fs');
const path = require('path');
const { buildAlert } = require('./alert.js');

const ROOT = path.resolve(__dirname, '..');
const VERIFIED_TIERS = new Set(['SILVER', 'BRONZE', 'REPORTED']);

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function nowISO() { return new Date().toISOString().slice(0, 10); }
function todayStamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

function main(argv) {
  const opts = {
    demo: argv.includes('--demo'),
    sourcesDir: ROOT + '/sources',
    stateDir: ROOT + '/state',
    alertsDir: ROOT + '/alerts'
  };
  for (const a of argv) {
    if (a.startsWith('--sources=')) opts.sourcesDir = path.resolve(a.slice(10));
    if (a.startsWith('--state=')) opts.stateDir = path.resolve(a.slice(8));
    if (a.startsWith('--alerts=')) opts.alertsDir = path.resolve(a.slice(9));
  }
  const fixturesDir = ROOT + '/fixtures';

  const thresholds = readJSON(ROOT + '/config/thresholds.json');
  const state = readJSON(opts.stateDir + '/state.json');
  const knownIds = new Set(state.known_placement_ids || []);
  const knownPositions = state.known_positions || {};
  const baselines = state.baselines || {};

  // Load sources: verified sources dir, plus SAMPLE fixtures only in demo mode.
  const placementRecords = readJSON(opts.sourcesDir + '/placements.json').placements;
  const streamRecords = readJSON(opts.sourcesDir + '/streams.json').records;
  if (opts.demo) {
    for (const f of fs.readdirSync(fixturesDir)) {
      if (!f.endsWith('.json')) continue;
      const fx = readJSON(fixturesDir + '/' + f);
      if (fx.placements) placementRecords.push(...fx.placements);
      if (fx.streams) streamRecords.push(...fx.streams);
    }
  }

  const alerts = [];
  const errors = [];

  // ---- stream crossings ----
  for (const s of streamRecords) {
    const key = s.track_key;
    const th = thresholds.stream_crossings[key];
    if (!th) { errors.push('no thresholds for track_key ' + key); continue; }
    if (s.plays == null) continue;
    const base = baselines[key] || { plays: null };
    const isVerifiedTier = VERIFIED_TIERS.has(s.evidence_tier) || (opts.demo && s.evidence_tier === 'SAMPLE');
    if (!isVerifiedTier) continue; // PROJECTED/SAMPLE silent (SAMPLE only in demo)
    if (base.plays != null && s.plays <= base.plays) continue; // stale or backwards
    const crossed = (th.crossings || []).filter(c => s.plays >= c && (base.plays == null || base.plays < c));
    for (const c of crossed) {
      try {
        alerts.push(buildAlert({
          track: s.track, artist: s.artist,
          milestone: 'stream_crossing',
          detail: c.toLocaleString('en-US') + ' lifetime ' + (s.source || 'Spotify') + ' plays',
          evidenceTier: opts.demo && s.evidence_tier === 'SAMPLE' ? 'SAMPLE' : s.evidence_tier,
          verifiedDate: s.as_of,
          verification: s.verification || null,
          receiptLink: s.receipt_link || null,
          baseline: base.plays == null ? null : { plays: base.plays, as_of: base.as_of },
          demo: opts.demo
        }));
      } catch (e) { errors.push(e.message); }
    }
    // advance baseline on verified-or-demo data
    baselines[key] = { plays: s.plays, as_of: s.as_of, tier: s.evidence_tier, verification: s.verification || null };
  }

  // ---- placements ----
  for (const p of placementRecords) {
    const isVerifiedTier = VERIFIED_TIERS.has(p.evidence_tier) || (opts.demo && p.evidence_tier === 'SAMPLE');
    if (!isVerifiedTier) continue;
    const wasKnown = knownIds.has(p.id);
    if (!wasKnown) {
      try {
        alerts.push(buildAlert({
          track: p.track, artist: p.artist,
          milestone: 'new_verified_placement',
          detail: 'added to "' + p.playlist + '" (' + (p.curator || 'unknown curator') + ')'
            + (p.position != null ? ', position ' + p.position + '/' + (p.playlist_total || '?') : ''),
          evidenceTier: opts.demo && p.evidence_tier === 'SAMPLE' ? 'SAMPLE' : p.evidence_tier,
          verifiedDate: p.verified_date,
          verification: p.verification_method || null,
          receiptLink: p.receipt_link || null,
          baseline: null,
          demo: opts.demo
        }));
      } catch (e) { errors.push(e.message); }
      knownIds.add(p.id);
      if (p.position != null) knownPositions[p.id] = p.position;
      continue;
    }
    // known: position jump / position #1
    if (p.position != null && knownPositions[p.id] != null) {
      const oldPos = knownPositions[p.id];
      const jump = oldPos - p.position;
      const rules = thresholds.placement_rules;
      if (p.position === 1 && oldPos !== 1) {
        try {
          alerts.push(buildAlert({
            track: p.track, artist: p.artist,
            milestone: 'playlist_number_one',
            detail: 'reached #1 on "' + p.playlist + '" (' + (p.curator || 'unknown curator') + '), up from ' + oldPos,
            evidenceTier: p.evidence_tier,
            verifiedDate: p.verified_date,
            verification: p.verification_method || null,
            receiptLink: p.receipt_link || null,
            baseline: { position: oldPos },
            demo: opts.demo
          }));
        } catch (e) { errors.push(e.message); }
      } else if (jump >= (rules.min_position_jump || 5)) {
        try {
          alerts.push(buildAlert({
            track: p.track, artist: p.artist,
            milestone: 'position_jump',
            detail: 'moved from ' + oldPos + ' to ' + p.position + ' on "' + p.playlist + '" (' + (p.curator || 'unknown curator') + ')',
            evidenceTier: p.evidence_tier,
            verifiedDate: p.verified_date,
            verification: p.verification_method || null,
            receiptLink: p.receipt_link || null,
            baseline: { position: oldPos },
            demo: opts.demo
          }));
        } catch (e) { errors.push(e.message); }
      }
      knownPositions[p.id] = p.position;
    }
  }

  // ---- write state (demo mode NEVER persists: it must not pollute the honest live state) ----
  if (!opts.demo) {
    state.known_placement_ids = [...knownIds];
    state.known_positions = knownPositions;
    state.baselines = baselines;
    state.last_check = nowISO();
    if (alerts.length > 0) {
      state.status = alerts.length + ' verified milestone' + (alerts.length === 1 ? '' : 's') + ' fired (last: ' + nowISO() + ')';
      state.alerts_fired = (state.alerts_fired || []).concat(alerts.map(a => ({
        track: a.track, milestone: a.milestone, detail: a.detail,
        evidence_tier: a.evidence_tier, fired_at: a.fired_at
      })));
    }
    fs.writeFileSync(opts.stateDir + '/state.json', JSON.stringify(state, null, 1) + '\n');
  } else {
    // demo: reflect the would-be state in memory only, for the console report
    state.known_placement_ids = [...knownIds];
    state.known_positions = knownPositions;
    state.baselines = baselines;
    state.last_check = nowISO();
  }

  // ---- emit alerts ----
  if (!fs.existsSync(opts.alertsDir)) fs.mkdirSync(opts.alertsDir, { recursive: true });
  for (const a of alerts) {
    const slug = (a.track + '-' + a.milestone).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fp = opts.alertsDir + '/' + todayStamp() + '-' + slug + (opts.demo ? '-demo' : '') + '.json';
    fs.writeFileSync(fp, JSON.stringify(a, null, 1) + '\n');
  }

  const out = {
    wire: 'cwi-milestone-wire',
    checked_at: nowISO(),
    demo: opts.demo,
    alerts_fired: alerts.length,
    alerts,
    state_status: state.status,
    errors
  };
  console.log(JSON.stringify(out, null, 1));
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
