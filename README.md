# Aether

Distance-accurate exoplanet visualization with AI-constrained surface generation.

See [`../PRD.md`](../PRD.md) for the full specification.

## Structure

Each package is a building block with one responsibility and no circular dependencies.
Dependencies point strictly downward.

```
apps/
  web/            Three.js client — the only package that knows about rendering

packages/
  terrain/        Terrain operator registry + admissibility gates
  physics/        Formula registry + deterministic derivations
  schema/         The contract: Science / Inference / Visual layers + validators
  coordinates/    f64 nested reference frames, camera-relative resolve
  units/          SI discipline — branded quantities, explicit conversion
```

```
web ──► terrain ──► physics ──► schema ──► units
 └────► coordinates ──────────────────────► units
```

## Extension points

The three registries are the places new features plug in. Adding a feature should mean
**adding one file**, not editing a switch statement.

| To add… | Create | Register in |
|---|---|---|
| A physics formula | `packages/physics/src/formulas/<name>.ts` | `formulas/index.ts` |
| A terrain operator | `packages/terrain/src/operators/<name>.ts` | `operators/index.ts` |
| A data source | `packages/schema/src/sources/<name>.ts` | source registry |

## Commands

```bash
pnpm install
pnpm check      # typecheck + test
pnpm dev        # run the web client
pnpm build      # build all packages
```

## Status

**Week 1–2: multi-scale precision spike.** Per the PRD, nothing else is worth building
until continuous flight from 1 AU to a 2 m observer height is jitter-free.
