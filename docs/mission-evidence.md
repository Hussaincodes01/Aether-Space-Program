# The mission evidence model

Selecting missions in Aether is a scientific act, not a filter. This document states exactly
what it is allowed to change.

---

## The rule

**Mission selection withholds measurements. It never creates them.**

That asymmetry is the integrity of the whole mechanic.

Deselecting Gaia is a claim about what we would know _without_ Gaia, and hiding a measurement
we do in fact have is a fair simulation of that counterfactual. Selecting JWST for a planet
JWST has never observed would be the opposite: manufacturing evidence.

So a mission can only ever reveal a value genuinely present in the catalog, and each system's
`observedBy` bounds which missions could plausibly have contributed at all.

The property is tested directly: a poorer evidence profile can only _remove_ science fields,
never add one, and any field both profiles expose must hold an identical value.

## Withheld is not deleted

A withheld measurement drops to the inference layer, where a prior answers instead — with its
full uncertainty and its own label. That is why the envelope widens rather than the planet
disappearing.

In the UI it appears as **UNKNOWN**, with a note saying that a published value exists and
which kind of mission would restore it.

---

## Quality is the best across missions, never the sum

Two mediocre transit surveys do not add up to one good one. Summing would let a user
manufacture confidence by ticking more boxes, which is precisely the failure mode this
product exists to avoid.

## The envelope never fully closes

Even with every mission — flying, funded and proposed — the envelope bottoms out at **0.15**.
No exoplanet surface has ever been resolved, so no exoplanet surface is ever drawn as certain.

The floor is stated twice on purpose: once in `@aether/missions` as the envelope width floor,
and again in `apps/web/src/speculation.ts` as `UNRESOLVED_SURFACE_FLOOR`. A reviewer reading
the rendering code should be able to see the floor rather than having to trace it across two
packages, and a refactor that removes one will be caught by the test asserting the other.

---

## Worked example: TRAPPIST-1 e

| Selection      | What you get                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **TESS alone** | Radius, period, orbit. No stellar radius, so no insolation, so no equilibrium temperature — and therefore **no terrain program at all**        |
| **Everything** | Full measurement set, derived density / gravity / escape velocity, and an equilibrium temperature flagged as resting on an assumed Bond albedo |

The TESS-only case is the interesting one. The model returns `terrain: null` and explains
why. That is the honest output; a surface built on defaults would not be.

---

## Which parameter gates which field

The mapping is written out explicitly in `planet-model.ts` rather than inferred from names,
because it is a scientific claim. A transit gives you a radius _ratio_; turning that into a
radius in metres needs a stellar radius, which needs a distance. Getting the table wrong would
let a planet look better measured than the selected missions could possibly make it.

One field is deliberately ungated: **surface pressure**. No mission in the registry
constrains an exoplanet's surface pressure, because none can — it has never been measured for
any planet outside the Solar System. Gating it would be theatre, always withholding for a
reason unrelated to the selection. In the other direction, Earth's 1013 hPa was measured by
standing there with a barometer, and no orbital mission selection makes that more or less
true.

---

## What a mission may _not_ change

- It cannot alter a measured value. Only reveal or withhold it.
- It cannot fabricate a science field that the full profile lacks.
- It cannot remove the uncertainty floor.
- It cannot make terrain affect physics. Terrain is downstream of everything and feeds back
  into nothing.
