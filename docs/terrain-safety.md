# Terrain operator safety

Terrain is the part of Aether most likely to be mistaken for a claim about the real world.
This document describes what stops it from becoming one.

---

## What terrain is, and is not

Every rendered surface is a **hypothesis**: one physically admissible realisation among many,
consistent with the measured parameters. It is not a prediction, and it is not an image of
the planet. The provenance inspector says so in full, under a `HYPOTHESIS` badge, every time.

Nobody has resolved the surface of any exoplanet. That fact does not become less true because
a renderer is capable of drawing something.

---

## Physics gates

Each operator declares a `gate(context)` that answers two questions: is this process
admissible on this world at all, and if so, how strongly did it operate?

Gates read only physical quantities — surface pressure, gravity, bulk density, stable liquid,
tidal and radiogenic heating, temperature. They do not read a planet's name, its catalog id,
or anything an author could use to hand-tune a favourite world into looking good.

### Rejections are kept

An operator the gate refuses is recorded in `program.rejected` with the reason, and the
inspector renders it. "There are no dunes here, because the surface pressure cannot move
sediment" is exactly as informative as the features that _are_ present, and it is the visible
evidence that the gates do real work rather than decorating a noise function.

### The gates are falsifiable, and they are falsified against the Solar System

The Solar System is the only place with ground truth, so it is where the rules can be proven
wrong:

| World       | The gates must produce                     | Because                                            |
| ----------- | ------------------------------------------ | -------------------------------------------------- |
| **Moon**    | Craters. No wind, water or ice erosion     | Airless, 0 Pa                                      |
| **Mars**    | Dunes and craters, but **no rivers today** | 6 mbar moves sediment; liquid water is not stable  |
| **Earth**   | Rivers, dunes and ice                      | 1 bar, stable water, 71% ocean                     |
| **Jupiter** | **No solid surface at all**                | 1326 kg/m³ — nothing to stand on                   |
| **Titan**   | **Rivers, at 94 K**                        | Methane is liquid at 1.45 bar. Cassini mapped them |

Titan is the sharpest of these. It separates two things that are easy to conflate: "has an
atmosphere and rivers" from "is Earth-like". Water there is bedrock. If the erosion gate asks
"is there liquid water" it gets Titan wrong; if it asks "is any liquid stable at this pressure
and temperature" it gets Titan right. That distinction is the whole thesis of the gate design,
and it is asserted by a test that also confirms airless Callisto — a similar size and
composition — is denied the same operator.

---

## One entry point, and it always validates

`compileTerrainProgram()` is the only public way to produce a program, and it cannot be used
unsafely.

Validation used to live in a separate exported `validateProposal()`. That made the guarantee
opt-in: every caller had to remember to call it, and one that forgot compiled a program from a
proposal naming operators that do not exist, with no indication anything had been ignored. A
safety check you can skip is a safety check that will be skipped.

### What gets recorded

`CompileWarning` is a discriminated union, because these mean genuinely different things:

| Kind                                 | Meaning                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| `clamped`                            | A proposal overreached; pulled back to the admissible range |
| `unknown_operator`                   | A model invented a geological process that does not exist   |
| `unknown_parameter`                  | A known operator was given a parameter it does not define   |
| `proposal_for_inadmissible_operator` | A real operator this world's physics rules out              |

The last is not an error. A composer proposing dunes for a planet that turns out to be airless
is behaving reasonably, and the gate is what makes the proposal harmless. It is recorded
because a composer doing it constantly is being given bad context.

### Strict mode

`strict: true` throws a typed `TerrainProposalError` carrying its warnings, instead of
recording them.

Off by default, because at runtime a slightly wrong proposal should degrade to physics
defaults rather than blank the screen. On in ingestion and in tests, where the same proposal
is a defect that should stop the build.

**Clamping is never fatal in either mode.** A clamp is the gate working as designed, not a
malformed proposal.

---

## Determinism

Identical seed, context and proposal produce a byte-identical program. Warning order is sorted
rather than following object key insertion order — otherwise a snapshot test would pass
locally and fail elsewhere for a reason nobody could see.

What is _not_ promised is byte-identical GPU output. Shader floating point differs across
drivers. What is promised is identical canonical inputs, identical terrain commands, identical
topology and feature placement.

---

## Terrain cannot affect physics

The dependency runs one way. `PlanetContext` is built from measurements and derivations; the
compiled program is consumed by the renderer. Nothing reads a terrain program back into a
science or inference layer, and no science package imports the renderer — an ESLint
`no-restricted-imports` rule enforces the second half, because it is the invariant nobody can
check by eye once the repository is this size.
