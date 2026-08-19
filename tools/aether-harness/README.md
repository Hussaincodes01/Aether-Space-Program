# aether-harness

An LLM harness for parameterised exoplanet surface generation.

Observational data goes in. A **frozen, content-addressed JSON spec** comes out —
an immutable definition of one planet's surface, permanent for the lifetime of the
universe it belongs to. The LLM's job is to select generation algorithms and their
parameters from a fixed catalog; it never writes code, never invents a parameter
name, and never authors a number that physics can compute.

```
data source ──▶ PlanetDataCard ──▶ derive() ──▶ DerivedEnvironment
                (measured,           physics      (g, v_esc, T_eq, shoreline,
                 with sigma          closed-form   tidal heating, relief ceiling,
                 and provenance)                   archetype, capabilities)
                                          │
                                          ▼
                                  FeasibilityEnvelope
                        (allowed / required / forbidden operators,
                         physics-narrowed parameter ranges, cost budget)
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
                  prompt (catalog +                   JSON schema
                   constraints +                    (op enum = allowed)
                    exemplar)                              │
                        └─────────────────┬─────────────────┘
                                          ▼
                                    LLM proposal
                                          │
                              validate ───┤ soft failure → repair + record
                                          │ hard failure → structured error,
                                          │                retry in-context
                                          ▼
                                     TerrainSpec
                              freeze() → blake2b hash → ledger
                                          │
                                          ▼
                        executor (numpy) / your engine / a shader
```

## Why it is built this way

**The model chooses, physics constrains, the harness enforces.** An LLM is a good
prior over *what a plausible landscape looks like* and a bad prior over *what is
numerically consistent with 0.4 g and 3 W/m² of insolation*. So everything
closed-form is computed before the model is called, and turned into a hard
admissible action space. Rivers are not "discouraged" on an airless rock — the
operator is absent from the catalog, absent from the JSON schema's `op` enum, and
rejected by the validator if it appears anyway.

**The action space is enumerable.** Operators are registered declarations with typed,
bounded, unit-carrying parameters. The prompt, the JSON schema, the validator and
the executor are all generated from that one declaration, so they cannot drift.
Adding an algorithm means registering one class.

**Failures are repaired, not re-rolled.** A number outside a bound is clamped and
recorded; an operator that does not exist is a structured error fed back into the
same conversation alongside the rejected proposal. If every attempt fails — or the
provider is down — a deterministic archetype template takes over. The harness never
returns "no universe".

**A universe is immutable.** Specs are content-addressed over canonically serialised
JSON with quantised floats, so `0.1 + 0.2` cannot fork a universe. Every random draw
descends from the universe seed through SplitMix64 — no global RNG, no clock, no
dict-ordering dependence. Asking for the same planet twice is a ledger hit, not a
second model call. Regeneration is explicit, bumps a revision, and records the hash
it superseded.

**Provenance survives to the renderer.** Every value carries `measured`, `derived`,
`assumed`, `ai_inferred` or `repaired`. You can always answer "did we observe this,
or did a model make it up?" — including for numbers the validator silently fixed.

## Install and run

```bash
pip install numpy pillow          # pillow optional (PGM fallback without it)

# offline: no API key, deterministic archetype templates, full pipeline exercised
python -m aether_harness.cli build --cards examples/planets.json --offline \
    --render --preview --res 256 --outdir out

# with a model
export ANTHROPIC_API_KEY=...
python -m aether_harness.cli build --planet "Kepler-442 b" --provider anthropic

# other providers
python -m aether_harness.cli build --cards examples/planets.json \
    --provider openai --model gpt-4.1
python -m aether_harness.cli build --cards examples/planets.json \
    --provider ollama --model qwen2.5:14b        # local, no key

# bulk from the NASA Exoplanet Archive
python -m aether_harness.cli build \
    --query "pl_rade < 1.8 and pl_insol between 0.3 and 1.5" --limit 40

python -m aether_harness.cli inspect --spec specs/Kepler-442_b.json --params
python -m aether_harness.cli render  --spec specs/Kepler-442_b.json --res 512 --preview
python -m aether_harness.cli catalog --archetype ice_world
python -m aether_harness.cli audit
python -m tests.test_harness
```

Library use:

```python
from aether_harness import Harness, HarnessConfig, execute
from aether_harness.sources import from_archive

h = Harness(HarnessConfig(universe_seed=20260819, provider="anthropic"))
spec = h.build(from_archive("TRAPPIST-1 e")).spec
fields, report = execute(spec, h.registry, resolution=512)

fields.get("elevation_m")        # metres, about the datum
fields.get("mask_ocean")
fields.get("flow_accumulation")
report.diagnostics               # relief, hypsometric integral, drainage density, ...
```

## The algorithm catalog

26 operators in eight categories. Each declares what channels it reads and writes,
which physical capabilities it requires, and its compute cost.

| category | operators |
|---|---|
| `base_surface` | `spectral_fbm` (1/f^β), `ridged_multifractal`, `billow_basins`, `cellular_provinces`, `domain_warp`, `driver_fields` |
| `tectonics` | `plates` (spherical mosaic + convergence), `orogeny`, `fracture_network`, `tidal_bulge` |
| `erosion` | `stream_power` (D8 LEM), `thermal_talus`, `hydraulic_droplet`, `aeolian_dunes` |
| `impacts` | `crater_field` (power-law SFD, rim/peak/ejecta) |
| `volcanism` | `shield_volcano`, `flood_basalt`, `magma_ocean` |
| `cryosphere` | `ice_shell`, `glacial_carve` |
| `hydrosphere` | `sea_level` |
| `field_utility` | `hypsometry_match`, `remap_curve`, `blend_noise`, `mask_from_elevation`, `normalise_relief` |

The pipeline carries **channels**, not just a heightmap: `elevation`, `uplift`,
`erodibility`, `runoff`, `sediment`, `ice`, `lava`, `flow_accumulation`, plus
`mask_*` gates. That separation is the point — `erosion.stream_power` integrates

```
dz/dt = U − K·R·A^m·S^n + D·∇²z
```

with real D8 routing and topologically ordered drainage accumulation, consuming
U/K/R as fields. Valley spacing, profile concavity and relief are *emergent*, not
painted on. It also means a generative model that predicts geomorphic driver fields
can be dropped in as a producer of `uplift`/`erodibility`/`runoff` without touching
anything downstream.

Noise is evaluated in 3D on the unit sphere, so there is no antimeridian seam and no
polar pinching, and the spec stays projection-independent.

## Physics guardrails

Calibrated against the Solar System — the test suite asserts all of this:

| body | shoreline ratio | verdict | archetype |
|---|---|---|---|
| Venus | 0.17 | retains | `venusian_greenhouse` |
| Earth | 0.07 | retains | `temperate_terrestrial` |
| Mars | 0.71 | retains | `cratered_relict` |
| Titan | 0.24 | retains | `ice_world` |
| Moon | 32.8 | airless | `airless_rock` |
| Mercury | 21.6 | airless | `airless_rock` |
| LHS 3844 b | 1.63 | airless | `airless_rock` (matches Spitzer) |

Derived quantities: surface gravity, escape velocity, bulk density, equilibrium
temperature, cosmic-shoreline atmosphere retention (Zahnle & Catling), tidal-locking
probability, tidal heating (calibrated to Io), and a strength-limited relief ceiling
`h ~ Y/(ρg)` that caps `elevation_range_m` — Earth lands at 8850 m, a 0.1 M⊕ body at
~25 km, which is the Olympus Mons regime.

Capabilities (`fluid_cycle`, `cryosphere`, `melt_surface`, `tectonics`, `aeolian`,
`tidally_locked`, …) gate operators. Parameter ranges narrow with physics: crater
density gets a *floor* on airless bodies and a *cap* where an atmosphere ablates
small impactors; the angle of repose scales as √(1/g); stream-power erodibility
scales as √g.

## Extending it

```python
from aether_harness.registry import ParamSpec, operator

@operator(
    id="cryo.sublimation_pits",
    category="cryosphere",
    summary="Swiss-cheese terrain from CO2 ice sublimating at the poles.",
    params=(ParamSpec("pit_density", "float", 0.3, 0.0, 1.0,
                      doc="areal fraction occupied by pits"),),
    consumes=("elevation", "ice"),
    produces=("elevation",),
    requires=("cryosphere",),
    cost=6,
)
def sublimation_pits(fs, p, ctx):
    ...
```

That single declaration updates the prompt catalog, the JSON schema, the validator
and the executor. It also changes `registry.version`, which changes every subsequent
spec hash — deliberately: the ledger can then tell you exactly which planets were
authored under the old contract instead of silently regenerating them.

To add a data source, write an adapter in `sources.py` that maps columns onto
`CANONICAL_OBS` with correct units and a provenance stamp. Do not gap-fill there;
that is `physics.derive()`'s job, and it must show up as `derived`/`assumed`.

## Integrating with a renderer

The frozen spec is the product; the numpy executor is a reference implementation
that proves a spec is executable and scores it. To drive your own engine, read
`pipeline[]` and dispatch on `op` — the parameters are already validated, clamped
and unit-annotated, and `stage_seed(i)` is pure SplitMix64, so a C++ or GLSL
implementation reproduces the same terrain bit-for-bit.

Resolution independence is a spec-level contract: `crater_field` states the minimum
diameter it *wants*, and the executor raises the floor to whatever the current grid
can resolve, logging the adjustment. The spec never encodes a resolution.

## Known limits

* `_accumulate` is an explicit Python loop over cells in descending elevation. Exact,
  portable, and the bottleneck above ~256 rows — swap in numba or C++ for production.
* Archetype rules are hand-authored score tables. They sort the Solar System
  correctly, but they are a prior, not a classifier trained on anything.
* Tidal heating omits the interior Q and the k₂ Love number, which vary by decades.
  It is an ordering heuristic, not a thermal model.
* Per-parameter bounds cannot rule out jointly unstable tuples, so the executor
  additionally reverts any stage that produces non-finite or runaway fields.
