# Aether

Distance-accurate exoplanet visualization with AI-constrained surface generation.

See [`../PRD.md`](../PRD.md) for the full specification.

## Structure

Each package is a building block with one responsibility and no circular dependencies.
Dependencies point strictly downward, so any layer can be replaced without touching the
ones below it.

```
apps/
  web/            Three.js client — the only package that knows about rendering

packages/
  terrain/        Terrain operators + physics admissibility gates + program compilation
  missions/       Mission registry + the evidence model (what each mission can constrain)
  physics/        Formula registry + deterministic derivations with full provenance
  schema/         The contract: Science / Inference / Visual layers, LLM containment
  coordinates/    f64 nested reference frames, floating-origin camera, depth partitioning
  units/          SI discipline — branded quantities, IAU/CODATA constants, conversions
```

```
web ──► terrain ──► physics ──► units
 │         └──────► schema ───► units
 ├──────► missions ───────────► units
 └──────► coordinates ────────► units
```

**The renderer has already changed twice** (C++ → Babylon.js → Three.js) and the science
layers required zero rework each time, because everything above `apps/` is written against
the contract rather than against an engine. Hold that line.

## Extension points

Three registries. Adding a feature means **adding one file** — never editing a switch
statement or a dispatch table.

### Add a physics formula

Create `packages/physics/src/formulas/tidal-locking.ts`:

```ts
import { defineFormula } from "../registry.js";
import { derived } from "../derived-value.js";

export const tidalLockingTimescale = defineFormula<{ /* inputs */ }>({
  id: "tidal_locking_timescale",     // appears in every provenance record — keep stable
  name: "Tidal locking timescale",
  latex: String.raw`\tau = \frac{4}{9}\frac{Q}{k_2}\ldots`,
  description: "Time to despin to synchronous rotation.",
  references: ["1977Icar...30..297P"],
  unit: "s",
  domain: (i) => (i.eccentricity < 1 ? null : "orbit must be bound"),
  compute: (i) => derived({ /* … */ }),
});
```

Then add `export * from "./tidal-locking.js";` to `formulas/index.ts`. It is now in the
registry, renderable in the inspector, and covered by the registry tests.

### Add a terrain operator

Create `packages/terrain/src/operators/periglacial.ts`:

```ts
import { defineOperator } from "../registry.js";

export const periglacial = defineOperator({
  id: "periglacial",
  name: "Periglacial patterning",
  description: "Polygonal ground and thermokarst from repeated freeze-thaw.",
  references: [],
  layerOrder: 70,                    // runs after fluvial (60), before microdetail (100)
  parameters: {
    coverage: { min: 0, max: 1, default: 0.2, description: "Patterned-ground fraction." },
  },
  gate: (ctx) => ({
    admissible: ctx.hasStableIce && ctx.surfaceTemperatureK > 150,
    gatedBy: "equilibrium_temperature",   // must resolve in the physics registry
    reason: "…",                          // shown verbatim in the inspector
    intensityRange: [0.05, 0.6],
    confidence: 0.3,
  }),
});
```

Export it from `operators/index.ts`. The compiler will gate it, clamp its parameters, and
include it in the catalog diversity fingerprint automatically.

### Add a mission

Create `packages/missions/src/missions/<name>.ts` with `defineMission({...})`, declaring
its instruments and — the part that matters — what it `constrains`. Export it from
`missions/index.ts`. The selector UI, the presets validator and the evidence model all pick
it up with no further changes.

Mission selection is **not** a catalog filter. The selected set determines which parameters
are constrained at all; the rest stay `null` in `ScienceSpec` and must come from the
inference resolver, which widens the hypothesis envelope, which makes the rendered world
visibly more speculative. Select TESS alone and you have a radius ratio and a period — the
surface is a guess and the amber rim says so. Add Gaia for a real radius, radial velocity
for a mass and density, JWST for an atmosphere, and the world tightens.

Quality combines as the **best** across missions, never the sum: ticking more boxes must
not manufacture confidence.

### Add a missing-value strategy

Add a `ResolutionStrategy` to `DEFAULT_STRATEGIES` in `packages/schema/src/resolver.ts`.
Order **is** the precedence rule from PRD §5.2, so inserting one is a spec change.

## Two invariants the CI enforces

- **LLM containment** (PRD §19.1) — an LLM payload carrying mass, radius, distance,
  orbital or chemical values is rejected by schema *and* by a deep field scan, in any
  naming convention, at any nesting depth. `packages/schema/src/llm-boundary.test.ts`.
- **Catalog diversity** (PRD §9.5) — no two worlds may compile to near-duplicate terrain
  programs. `packages/terrain/src/terrain.test.ts`.

Both are merge gates, not advisory.

## Commands

```bash
pnpm install
pnpm check      # typecheck + test — what CI runs
pnpm dev        # run the precision spike at localhost:5173
pnpm build      # build all packages
```

## Status — week 1–2, multi-scale precision spike

`pnpm dev` flies from 1 AU to a two-metre observer height above TRAPPIST-1 e. Untextured
on purpose: per the PRD, prove the scale transition before any art exists, because art
hides jitter.

Watch the **local coords** readout. It stays small however far the camera is from the
origin — that is the frame rebasing working. If it climbs past ~1e12 m, the f32 upload
will start to visibly jitter and something has broken.

**Immediate follow-up (P0):** the spike uses Three's per-vertex logarithmic depth buffer,
which interpolates incorrectly across large triangles. The production path is cascaded
frusta with reversed-Z on WebGPU — `packages/coordinates/src/depth.ts` already provides
the partitioning and matrices; they are not yet wired into the renderer.
