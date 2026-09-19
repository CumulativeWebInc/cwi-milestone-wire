#!/usr/bin/env node
// cwi-milestone-wire tests. Zero deps, Node stdlib only: node tests/test.js
'use strict';
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../bin/detect.js');
const { buildAlert } = require('../bin/alert.js');

const ROOT = path.resolve(__dirname, '..');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-'));
  fs.mkdirSync(dir + '/sources'); fs.mkdirSync(dir + '/state'); fs.mkdirSync(dir + '/alerts');
  const state = {
    schema_version: '1.0.0',
    status: 'NO VERIFIED MILESTONE YET - sensor armed',
    armed_at: '2026-09-19',
    known_placement_ids: ['p-known'],
    known_positions: { 'p-known': 30 },
    baselines: { 'zooted-zone': { plays: 307000, as_of: '2026-09-14', tier: 'REPORTED' } },
    kill_rule: 'no verified milestone in 120 days -> PARK (not kill)'
  };
  fs.writeFileSync(dir + '/state/state.json', JSON.stringify(state));
  return dir;
}
function writeSources(dir, placements, records) {
  fs.writeFileSync(dir + '/sources/placements.json', JSON.stringify({ schema_version: '1.0.0', placements }));
  fs.writeFileSync(dir + '/sources/streams.json', JSON.stringify({ schema_version: '1.0.0', records }));
}
function run(dir, extraArgs) {
  const logs = [];
  const orig = console.log;
  console.log = (s) => logs.push(s);
  let code;
  try { code = main(['--sources=' + dir + '/sources', '--state=' + dir + '/state', '--alerts=' + dir + '/alerts', ...(extraArgs || [])]); }
  finally { console.log = orig; }
  return { code, out: JSON.parse(logs.join('\n')), alertFiles: fs.readdirSync(dir + '/alerts') };
}

const SILVER_STREAM = { track_key: 'zooted-zone', track: 'Zooted Zone', artist: 'That Boy Hi Hat', plays: 500000, source: 'Spotify', as_of: '2026-09-19', evidence_tier: 'SILVER', verification: 'DistroKid dashboard screenshot' };
const KNOWN_PLACEMENT = [{ id: 'p-known', track: 'Zooted Zone', artist: 'That Boy Hi Hat', curator: 'C', playlist: 'P', playlist_id: 'spotify:playlist:x', position: 30, playlist_total: 140, verified_date: '2026-09-19', verification_method: 'playlist scan', evidence_tier: 'BRONZE' }];

test('fires on a real stream crossing with verified tier', () => {
  const dir = sandbox();
  writeSources(dir, KNOWN_PLACEMENT, [SILVER_STREAM]);
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.equal(r.out.alerts_fired, 1);
  const a = r.out.alerts[0];
  assert.equal(a.milestone, 'stream_crossing');
  assert.equal(a.evidence_tier, 'SILVER');
  assert.equal(a.demo, false);
  assert.ok(a.copy.threads.startsWith('[DRAFT'));
  assert.equal(r.alertFiles.length, 1);
  const st = JSON.parse(fs.readFileSync(dir + '/state/state.json', 'utf8'));
  assert.ok(st.status.startsWith('1 verified milestone fired'));
  assert.equal(st.baselines['zooted-zone'].plays, 500000);
});

test('stays silent on stale data (same as baseline)', () => {
  const dir = sandbox();
  writeSources(dir, KNOWN_PLACEMENT, [{ ...SILVER_STREAM, plays: 307000 }]);
  const r = run(dir);
  assert.equal(r.out.alerts_fired, 0);
  assert.equal(r.alertFiles.length, 0);
  const st = JSON.parse(fs.readFileSync(dir + '/state/state.json', 'utf8'));
  assert.equal(st.status, 'NO VERIFIED MILESTONE YET - sensor armed');
});

test('stays silent on PROJECTED data', () => {
  const dir = sandbox();
  writeSources(dir, KNOWN_PLACEMENT, [{ ...SILVER_STREAM, plays: 900000, evidence_tier: 'PROJECTED' }]);
  const r = run(dir);
  assert.equal(r.out.alerts_fired, 0);
  assert.equal(r.alertFiles.length, 0);
});

test('never fires on SAMPLE fixtures unless --demo', () => {
  // SAMPLE stream at a crossing threshold
  const dir = sandbox();
  writeSources(dir, KNOWN_PLACEMENT, [{ ...SILVER_STREAM, evidence_tier: 'SAMPLE' }]);
  const r = run(dir);
  assert.equal(r.out.alerts_fired, 0);
  // demo mode fires but stamps demo:true and does not persist state
  const dir2 = sandbox();
  writeSources(dir2, KNOWN_PLACEMENT, [{ ...SILVER_STREAM, evidence_tier: 'SAMPLE' }]);
  const r2 = run(dir2, ['--demo']);
  assert.equal(r2.out.alerts_fired, 2); // test stream + the repo's own SAMPLE fixture record
  assert.ok(r2.out.alerts.every(a => a.demo === true));
  assert.ok(r2.out.alerts.every(a => a.evidence_tier.includes('demo')));
  const st2 = JSON.parse(fs.readFileSync(dir2 + '/state/state.json', 'utf8'));
  assert.equal(st2.status, 'NO VERIFIED MILESTONE YET - sensor armed'); // not persisted
});

test('fires on a new verified placement', () => {
  const dir = sandbox();
  const fresh = { id: 'p-new', track: 'Diabolique', artist: 'That Boy Hi Hat', curator: 'New Curator', playlist: 'Fresh List', playlist_id: 'spotify:playlist:y', position: 5, playlist_total: 50, verified_date: '2026-09-19', verification_method: 'full playlist scan', evidence_tier: 'BRONZE' };
  writeSources(dir, [...KNOWN_PLACEMENT, fresh], [{ ...SILVER_STREAM, plays: 307000 }]);
  const r = run(dir);
  assert.equal(r.out.alerts_fired, 1);
  assert.equal(r.out.alerts[0].milestone, 'new_verified_placement');
  assert.equal(r.out.alerts[0].verification, 'full playlist scan');
});

test('fires on position jump >= 5, silent on smaller moves', () => {
  const dir = sandbox();
  const jumped = [{ ...KNOWN_PLACEMENT[0], position: 24 }]; // 30 -> 24 = +6
  writeSources(dir, jumped, [{ ...SILVER_STREAM, plays: 307000 }]);
  const r = run(dir);
  assert.equal(r.out.alerts_fired, 1);
  assert.equal(r.out.alerts[0].milestone, 'position_jump');

  const dir2 = sandbox();
  const small = [{ ...KNOWN_PLACEMENT[0], position: 28 }]; // +2, silent
  writeSources(dir2, small, [{ ...SILVER_STREAM, plays: 307000 }]);
  const r2 = run(dir2);
  assert.equal(r2.out.alerts_fired, 0);
});

test('dedupe: second run on the same data stays silent', () => {
  const dir = sandbox();
  writeSources(dir, KNOWN_PLACEMENT, [SILVER_STREAM]);
  run(dir);
  const r2 = run(dir); // same sources dir, state already advanced
  assert.equal(r2.out.alerts_fired, 0);
  assert.equal(r2.alertFiles.length, 1); // only the first run's file
});

test('buildAlert refuses unverified tiers', () => {
  assert.throws(() => buildAlert({ track: 'T', milestone: 'stream_crossing', detail: 'x', evidenceTier: 'PROJECTED' }), /REFUSED/);
  assert.throws(() => buildAlert({ track: 'T', milestone: 'stream_crossing', detail: 'x', evidenceTier: 'SAMPLE' }), /REFUSED/);
  const demo = buildAlert({ track: 'T', milestone: 'stream_crossing', detail: 'x', evidenceTier: 'SAMPLE', demo: true });
  assert.ok(demo.evidence_tier.includes('demo'));
});

test('fires on playlist #1', () => {
  const dir = sandbox();
  const num1 = [{ ...KNOWN_PLACEMENT[0], position: 1 }];
  writeSources(dir, num1, [{ ...SILVER_STREAM, plays: 307000 }]);
  const r = run(dir);
  assert.equal(r.out.alerts_fired, 1);
  assert.equal(r.out.alerts[0].milestone, 'playlist_number_one');
});
