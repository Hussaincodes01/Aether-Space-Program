# aether-harness, vendored

Source: `aether-harness.zip`, unpacked alongside this repo. Python, not TypeScript, and
deliberately outside the pnpm workspace — `pnpm build`, `lint` and `typecheck` do not see it.

## Why it is here

It was not under version control anywhere. The calibration run described below found three
defects and the fixes for them existed only as loose edits on one machine, which is not a
place to keep the thing that decides what every planet looks like.

The plan (`docs/ARCHITECTURE.md` §13.1) has it becoming an offline build step: it emits frozen,
content-addressed specs, and the web client reads `pipeline[]` and dispatches on `op`. No
Python at runtime.

## Running it

```bash
cd tools/aether-harness
python -m tests.test_harness                     # 76 checks

# Regenerate the Solar System cards from our own body tables, then calibrate against them.
cd ../.. && pnpm --filter @aether/solar-system run export:cards
cd tools/aether-harness
python -m aether_harness.cli build \
    --cards ../../packages/solar-system/solar-system-cards.json \
    --offline --res 224 --ledger solar.ledger.json --outdir solar-out
```

## Local changes against the vendored drop

Three defects, all found by running it over the Solar System rather than over exoplanets —
which is the entire argument for calibrating at home first.

1. **All four giants classified as `ice_world`** and were being handed a surface to generate.
   Density cannot separate a giant from an ice moon: Jupiter is 1326 kg/m³, Titan 1882,
   Europa 3013. So `rho < 3000` scored `volatile_envelope +2.5`, the cold-body rule then added
   `ice_world +3.0` for Jupiter's 112 K, and ice won.

   Radius is the missing half, recoverable from what `classify()` already holds since
   `g = (4/3)πGρR`, accurate to 4% against the real bodies. Giants land at 3.8–10.5 R⊕, every
   moon at or below 0.41.

2. **Tidal heating was a one-point fit** — `4.1e-10 · m^2.5 · e² / a^7.5`, calibrated so Io
   reproduced its observed 2.5 W/m². It does reproduce Io. It also gives **the Moon 552 W/m²
   against an observed ~1e-5**, seven orders of magnitude out, because the Moon sits at
   nearly Io's semi-major axis with thirteen times the eccentricity and nothing in a
   single-body fit constrains that.

   Replaced with the standard relation `E = (21/2)(k₂/Q)n⁵R⁵e²/G`, with `n` from the orbital
   period and `k₂` from rigidity. Plus a melt feedback: rigid-body dissipation alone gives Io
   0.15 W/m², and the gap to 2.5 is real physics — once heating outruns conduction, silicate
   partially melts, rigidity collapses and k₂ rises by an order of magnitude. Triggered against
   a radiogenic-scale flux, not a threshold chosen to make Io pass.

   | body | before | after | observed |
   | --- | --- | --- | --- |
   | Moon | 552.3 | 0.00002 | ~1e-5 |
   | Io | 2.51 | 3.40 | ~2.5 |
   | Europa | 0.079 | 0.0081 | ~0.20 |
   | Enceladus | 0.000 | 0.00001 | ~0.20 |

3. **The relief ceiling saturated at 45,000 m** for every small body, so Mimas at a 198 km
   radius was allowed 45 km of relief — 23% of itself — and Mimas, Enceladus, Phobos, Pluto
   and Eris all shared one value. The strength limit goes as 1/g and diverges. Bounded now by
   the body's own size as well: 5% of radius, generous next to Earth at 0.31%, Mars 0.87% and
   the Moon 1.1%, and it binds only where the strength limit has stopped meaning anything.

## Known limits, unchanged

Europa and Enceladus are still under-predicted by 25× and more. Both have subsurface oceans,
where k₂ is far above the rigid-rock value the model assumes. It under-predicts rather than
over-predicts, which is the right direction to be wrong in, and it is the decade-scale k₂/Q
variation the upstream README already warns about. Not fixed, because fixing it means
measuring an interior rather than choosing a constant.

`_accumulate` remains an explicit Python loop and is the bottleneck above ~256 rows.
