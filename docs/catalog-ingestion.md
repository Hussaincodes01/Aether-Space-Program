# Catalog ingestion

`packages/catalog` turns published values into a `PlanetModel`: SI quantities with
provenance, derived physics, inference for what is missing, and a terrain hypothesis.

---

## Seed data is written in catalog units

Earth radii, solar masses, days. That is how the literature reports it, and retyping
published numbers into SI by hand is how transcription errors get in. Conversion happens
once, in `convert.ts`, under test.

Conversion factors come from IAU 2015 Resolution B3 nominal values via `@aether/units`.
Using the _nominal_ constants matters: the IAU nominal solar radius is a defined value chosen
so published stellar radii are comparable, and substituting a "better" measured solar radius
would silently shift every stellar radius in the catalog.

## Three structural rules

1. **Every value names its unit.** There are no bare numbers in seed data.
2. **Every value names its source.** `sourceId` must resolve in the source registry.
   Ingestion throws `InvalidCatalogDataError` naming the field otherwise, which is what makes
   the provenance promise structural rather than intended.
3. **Unknown is spelled out.** `value: null`, never omitted and never filled with a
   population median. Omission and "we know this is unknown" are different facts.

Validation runs at module load and a failure throws. A catalog entry with an unresolvable
source is a defect in the repository, not a runtime condition to degrade around, and it
should stop the build rather than surface as a strange planet three screens later.

---

## What is in the seed catalog

| System               | Why it is here                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **TRAPPIST-1**       | All seven planets, Agol et al. (2021). Best-characterised terrestrial system we have — and still no resolved surface. That gap is the product |
| **Proxima Centauri** | Found by radial velocity, so it has a mass and **no radius at all**. The asymmetry is real and the catalog records it                         |
| **Solar System**     | Sun, Earth, Mars. The only entry with known right answers                                                                                     |

### Why Earth is in an exoplanet catalog

Because it is the only entry where every derived value can be checked. Earth goes through
exactly the path TRAPPIST-1 e goes through — no short-circuit for living here — and the tests
assert the published results:

| Quantity                | Expected   |
| ----------------------- | ---------- |
| Bulk density            | 5514 kg/m³ |
| Surface gravity         | 9.80 m/s²  |
| Escape velocity         | 11.19 km/s |
| Insolation              | 1361 W/m²  |
| Equilibrium temperature | **254 K**  |

That last one is deliberately not 288 K. 288 is the _surface_ temperature and includes 33 K
of greenhouse warming; equilibrium temperature excludes it by definition. Conflating the two
is the most common error in exoplanet popular writing, and a pipeline producing 288 here
would be wrong in exactly the fashionable direction.

---

## The pipeline

```
seed  ->  SI + provenance  ->  evidence gate  ->  derivations  ->  inference  ->  terrain
```

`buildPlanetModel(systemId, planetId, evidenceProfile)` returns:

- `science` — measurements the selected missions can see
- `derived` — Aether's own derivations, each naming its formula
- `inference` — distributions standing in for what is unconstrained
- `unknown` — fields nobody has measured, with the reason
- `withheld` — fields the mission selection is hiding
- `terrain` — a compiled program, or `null` **with a reason**
- `speculation` — how much of this world is inference
- `seed` — deterministic, a function of identity + evidence

## Inference

One prior so far, and it is the one that matters: Chen & Kipping (2017) mass-radius, which is
what lets a radial-velocity planet like Proxima b be drawn at all. It returns a distribution
with its intrinsic scatter intact — two planets of the same mass genuinely differ in radius by
tens of percent — and flags out-of-distribution above the Jovian break at ~131 Earth masses,
where radius stops tracking mass.

## Determinism

The seed is a hash of `systemId | planetId | sorted coverage`. Same planet + same evidence =
same world, always. Different evidence = potentially different world, which is the mechanic.

Coverage entries are sorted so key insertion order cannot change the seed, and constraint
quality is formatted numerically — an early version interpolated the quality object straight
into a template string, rendering every quality as `[object Object]` and collapsing them all
onto one seed, which would have silently disabled the entire mechanic.

## Adding a system

1. Add a `SystemSeed` under `src/seed/`.
2. Add any new `sourceId` to `src/sources.ts` with a citation and a retrieval date.
3. Export it from the `SEEDS` array in `src/catalog.ts`.

Nothing else changes. Ingestion validates the new entry at load, and a bad `sourceId` fails
the test suite rather than reaching a user.
