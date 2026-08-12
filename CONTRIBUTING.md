# Contributing to Aether

Thanks for wanting to help. This document is short on ceremony and long on the two or three
things that are genuinely easy to get wrong here.

---

## Getting set up

```bash
pnpm install
pnpm check       # typecheck + test. If this is green, CI will be too.
pnpm dev         # http://localhost:5173
```

Node 22+, pnpm 9+. Copy `.env.example` to `.env` if you are working on ingestion or the
composer — `.env` is gitignored and must never be committed.

---

## The one idea to internalise

**Nothing renders that cannot name its evidence.**

Every number in this system carries its unit, its uncertainty, how it was obtained, and
where it came from. There is no such thing as a bare scalar. If you find yourself writing
`const gravity = 9.81`, stop — that value needs a `ScientificQuantity` or a `DerivedValue`
around it, or it will eventually be shown to a user as though somebody measured it.

The six evidence classes are the product:

| Class | Meaning |
|---|---|
| `measured` | A direct catalog or spectral measurement |
| `derived` | A deterministic equation applied to measured inputs |
| `retrieved` | A posterior inferred from a spectrum |
| `constrained_prior` | A statistical range consistent with the evidence |
| `procedural_realization` | One deterministic terrain instantiation from that prior |
| `decorative` | Visual detail that cannot affect interpretation |

---

## Adding a feature means adding one file

Three registries. In each case you create a file and add one export line — there is no
switch statement to extend and no dispatch table to keep in sync.

### A physics formula

`packages/physics/src/formulas/tidal-locking.ts`

```ts
import { defineFormula } from "../registry.js";
import { derived } from "../derived-value.js";

export const tidalLockingTimescale = defineFormula<Inputs>({
  id: "tidal_locking_timescale",   // appears in provenance records — stable forever
  name: "Tidal locking timescale",
  latex: String.raw`\tau = \frac{4}{9}\frac{Q}{k_2}\ldots`,
  description: "Time to despin to synchronous rotation.",
  references: ["1977Icar...30..297P"],
  unit: "s",
  domain: (i) => (i.eccentricity < 1 ? null : "orbit must be bound"),
  compute: (i) => derived({ /* … */ }),
});
```

Then `export * from "./tidal-locking.js";` in `formulas/index.ts`.

**Rules for formulas.** Return a `DerivedValue`, never a number. Name every input you
consumed so the inspector can walk the chain. Declare a `domain` and let it throw — a
formula applied outside its fitted range should fail loudly, not return a quietly wrong
answer. Surface assumptions explicitly: an equilibrium temperature computed with an assumed
Bond albedo is a different claim from one computed with a measured albedo, and the UI has to
be able to say which.

Confidence is the **minimum** over inputs, never the average. Averaging lets a well-measured
radius launder a badly-constrained mass.

### A terrain operator

`packages/terrain/src/operators/periglacial.ts`

```ts
export const periglacial = defineOperator({
  id: "periglacial",
  name: "Periglacial patterning",
  description: "Polygonal ground and thermokarst from repeated freeze-thaw.",
  references: [],
  layerOrder: 70,                  // after fluvial (60), before microdetail (100)
  parameters: {
    coverage: { min: 0, max: 1, default: 0.2, description: "Patterned-ground fraction." },
  },
  gate: (ctx) => ({
    admissible: ctx.hasStableIce && ctx.surfaceTemperatureK > 150,
    gatedBy: "equilibrium_temperature",  // must resolve in the physics registry
    reason: "…",                         // shown verbatim to the user
    intensityRange: [0.05, 0.6],
    confidence: 0.3,
  }),
});
```

**Rules for operators.** The gate must be real physics, not taste. "Titan has rivers"
follows from methane being liquid at 94 K, not from Titan being interesting. Every gate
cites the formula that decided, and the `reason` string is displayed verbatim in the
inspector — write it for a curious user, not for yourself.

Set `scalesWithIntensity: false` only for structural constants like noise octave count.
Everything representing *how strongly a process operated* must scale, or worlds sharing an
operator set compile to the same planet. That bug was real: Earth and TRAPPIST-1e once had a
fingerprint distance of 0.007.

Generic fBm is not the geology model. Noise is the final detail layer; large-scale structure
comes from named processes gated by evidence.

### A mission

`packages/missions/src/missions/<name>.ts` with `defineMission({...})`, then export it from
`missions/index.ts`.

The load-bearing field is `constrains`: which parameters this mission's data can actually
pin down, and how well. Be conservative. A generous number here silently inflates confidence
in every world a user builds with that mission selected.

Quality combines as the **best** across missions, never the sum.

---

## Two invariants CI will not let you break

### 1. The LLM cannot write to the scientific record

`packages/schema/src/llm-boundary.test.ts`

The composer may propose palette intent, texture art direction and narrative. It may not
propose a mass, a radius, a distance, an orbital period or a chemical abundance — there is
no schema field for them, and a deep scan catches any attempt at any nesting depth in any
naming convention.

If you are tempted to add a physical field to `VisualProposalSchema`, that is a PRD
amendment, not a code change.

A useful war story: the scan originally used `/\bradius\b/`, which does **not** match
`planet_radius`, because JavaScript treats `_` as a word character. The test suite passed
anyway, because the strict schema caught the unknown key — so the defence-in-depth layer was
silently doing nothing. Keys are now normalised into tokens before matching. Assume your
regex is wrong until a test proves otherwise.

### 2. No two worlds may be near-duplicates

`packages/terrain/src/terrain.test.ts`

Every pair of catalog worlds must exceed a calibrated distance in operator-composition
space. If your change makes two planets more alike, this fails, and the fix is almost always
that a gate is not reading enough of the physical context.

---

## Style

Match the surrounding code. Beyond that:

- **Comments explain *why*, not *what*.** `// clamp to [0,1]` is noise. `// Averaging would
  let a well-measured radius launder a poor mass` is worth its line.
- **Name the failure mode you are preventing.** Most of the non-obvious code here exists
  because something went wrong; say what.
- Strict TypeScript, no `any`, no non-null assertions outside tests.
- Tests assert against published values where they exist — TRAPPIST-1e's equilibrium
  temperature, Earth's escape velocity. Self-consistency is not correctness.

---

## Pull requests

1. Branch from `main`.
2. `pnpm check` green.
3. Explain *why* in the description. What did you learn, what surprised you, what did you
   decide not to do?
4. If you found a bug, add the test that would have caught it.

Small PRs get read. Enormous PRs get read eventually.

---

## Scientific accuracy is a review criterion

Aether's only real asset is being trustworthy. A change that makes the visuals prettier at
the cost of a defensible claim will be rejected, however good it looks.

If you are unsure whether something is defensible, say so in the PR. "I think this gate is
right but I am not confident about the threshold" is a genuinely useful thing to write, and
far better than quiet confidence.

If you are a planetary scientist, astronomer or geologist and something here is wrong, an
issue explaining why would be more valuable than any code we could write.

---

## Where to start

Good first issues, roughly in order of usefulness:

- **A tidal-locking terrain operator.** The top backlog item. Currently nothing models a
  permanent terminator, one-directional volatile transport or the absence of seasons, which
  is why Earth and TRAPPIST-1e are the closest pair in the catalog.
- **Cascaded frusta with reversed-Z.** The client uses Three's per-vertex logarithmic depth,
  which interpolates wrongly across large triangles. `packages/coordinates/src/depth.ts`
  already has the partitioning and matrices built and tested — they are not yet wired into
  the renderer.
- **A Playwright smoke test.** DOM layering and pointer-lock bugs are invisible to vitest.
  One escaped to a user already.
- **More missions.** CHEOPS, JUICE, ground-based ELTs.
- **More physics formulas.** Tidal heating, Roche limit, Hill sphere, transit geometry.

Read [`docs/PRD.md`](docs/PRD.md) before anything architectural. It is long, but it is where
every decision that looks arbitrary is explained.
