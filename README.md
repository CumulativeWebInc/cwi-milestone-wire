# cwi-milestone-wire

A milestone-detection sensor for Cumulative Web Inc. It watches **verified**
data sources — playlist placements and stream counts — and emits a structured
alert payload when a **real** milestone fires.

Current state: **NO VERIFIED MILESTONE YET — sensor armed.**

## Why it exists

When That Boy Hi Hat hits a real milestone (a verified playlist add, a stream
crossing on the Road to 1M), the moment should be caught, receipted, and turned
into promo copy the same day — not found weeks later in a spreadsheet. This wire
is the parked-open sensor for that job: armed, honest, silent until there is
something real to say.

## The honesty rules (hard, enforced in code)

1. **Only verified numbers fire.** An alert requires evidence tier `SILVER`
   (distributor/label dashboard), `BRONZE` (public third-party API), or
   `REPORTED` (dated, attributed manager/team statement). Anything else is
   rejected — `buildAlert()` throws `REFUSED`.
2. **SAMPLE and PROJECTED records never fire.** The repo ships with
   `fixtures/sample-crossing.json` for demonstrations; it is ignored by the
   live run. `--demo` mode fires on samples only to show the payload shape,
   stamps every alert `demo:true` / `evidence_tier:"SAMPLE (demo)"`, and **never
   writes state**.
3. **No projection is presented as achieved.** Streams fire on crossings of
   recorded, dated figures, never forecasts. Baselines only advance on verified
   (or demo) data.
4. **Baselines are pre-armed.** Placements verified before 2026-09-19 are the
   known baseline (5 verified placements in `sources/placements.json`) — they
   never fire. Only *new* verified placements, position jumps ≥ 5, #1s, and
   stream crossings above the last verified figure fire.
5. **Copy is draft-only.** Every alert carries suggested Threads/Instagram/
   WhatsApp copy labeled `[DRAFT]`. Per standing order, CWI accounts may fire;
   Black's personal name, DMs, emails, subscriber blasts, and personal Facebook
   stay gated — nothing here bypasses that.

## Run

```
node bin/detect.js              # live run: checks sources, updates state/, emits alerts/
node bin/detect.js --demo       # demo run: fires on SAMPLE fixtures, no state writes
node --test tests/test.js       # 9 tests
```

Alerts land as JSON in `alerts/`. `state/state.json` always carries the honest
current status string.

## Thresholds

`config/thresholds.json`: ROAD-1M crossings for Zooted Zone at 500K / 750K / 1M
lifetime Spotify plays (current verified baseline: 307,000 REPORTED, 2026-09-14);
50K / 100K / 250K for Diabolique, Shaka Zulu, Doves & Diamonds.
Placement rules: new verified playlist = milestone; position jump ≥ 5 =
milestone; reaching #1 = milestone.

## Sources

- `sources/placements.json` — verified playlist scans (evidence tier BRONZE)
- `sources/streams.json` — verified stream figures with dates + attribution

To feed a new verified figure, add a record to the source file with its
`verified_date`, `verification_method`, and evidence tier, then run the sensor.

## Kill rule

Event-driven: no verified milestone in 120 days from arming (2026-09-19) →
**PARK** the lane (not kill). A parked lane keeps the sensor runnable but stops
scheduled checks. The wire itself is $0 and dependency-free.

$0 build. Zero dependencies — Node stdlib only. No secrets, no credentials,
no network calls.
