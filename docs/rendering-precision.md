# Rendering precision

Aether spans about twenty-one orders of magnitude, from a two-metre observer height to the
deep sky at 1e24 m. This document describes how that is made to work, and — equally
important — which parts are verified and which are not.

---

## The invariant

`packages/coordinates` holds authoritative positions in **f64**. Three.js is only ever handed
**camera-relative** offsets, narrowed to f32 at the last moment.

Per frame:

1. Advance simulation time and the f64 orbital positions.
2. Advance the f64 camera position, then rebase across frames with hysteresis.
3. For each body, resolve its position relative to the camera **in f64**.
4. Narrow _that offset only_ to f32 and hand it to Three.js.
5. Three's camera stays at the origin and only ever rotates.

Step 5 is the one that is easiest to break and hardest to notice. An absolute astronomical
position assigned to `THREE.Camera.position` works fine near the Sun and disintegrates at
interstellar range.

### Why the hierarchy is necessary

f64 carries about 15–17 significant digits. At 40 light-years (3.8e17 m) the representable
step is around 60 m — so subtracting two absolute positions to get a one-metre offset returns
noise. The frame hierarchy avoids the subtraction entirely by resolving through the lowest
common ancestor, which keeps every intermediate quantity small.

`packages/coordinates/src/precision.test.ts` asserts this directly: a 1 m offset survives at
40 ly, and the naive absolute subtraction is shown failing beside it.

### The f32 limit

f32 carries ~24 mantissa bits, so the representable step at magnitude _x_ is about x / 2²³.
At 1e12 m that step is roughly 0.12 m. Beyond that, metre-scale geometry visibly shimmers.

The precision overlay (**G**) reports the largest camera-relative offset each frame and turns
amber past 1e12 m, saying so in words. It also reports the current frame, frame depth, local
coordinate magnitude, altitude and whether a rebase happened this frame — the numbers you need
to tell "the shader is wrong" from "something stopped rebasing".

---

## Depth

A single depth buffer cannot span 0.1 m to 1e27 m. Three techniques exist, and Aether ships
two of them.

### 1. Logarithmic depth — the default

Three's `logarithmicDepthBuffer`. One pass, fast, and it is the path that has actually been
looked at on a screen.

Its known weakness: Three applies it **per-vertex**, which interpolates incorrectly across
very large triangles. This is a real compromise, not a solved problem, and it is the same
limitation the C++ reference implementation lists as its top outstanding item.

### 2. Cascaded frusta — opt-in via `?depth=partitioned`

Renders the scene once per depth partition, far to near, clearing depth between passes so
nearer partitions overwrite. Each pass gets its own near/far planes and therefore its own full
depth range, instead of twenty orders of magnitude sharing one buffer. This is what actually
makes the full range work; the other techniques buy a few orders each.

Four partitions from 0.1 m to 1e27 m, logarithmically spaced with 5% overlap so a primitive
straddling a boundary is drawn in both rather than falling through the crack.

**It is not the default, deliberately.** Four full scene traversals is a real performance
change, and it has not been measured on real hardware in this environment. Making it the
default would trade a verified path for an unverified one. The code is present, tested, and
one query parameter away.

### 3. Reversed-Z — built, not wired

`reversedZPerspective()` and `infiniteReversedZPerspective()` exist in
`packages/coordinates/src/depth.ts`. Reversed-Z maps near to 1.0 and far to 0.0; because f32
has far more precision near zero and 1/z already concentrates precision near the camera, the
two effects cancel and precision distributes almost uniformly.

Three.js does not expose the depth clear value and comparison function needed to drive this
cleanly through its standard render path, so wiring it means either a custom render pass or
the WebGPU renderer. It is the right long-term answer and it is not done.

---

## Far plane

1e27 m. An early value of 1e15 m sits inside the Oort cloud, which clipped every star (3e16 m
and out), every exoplanet host and the entire deep sky before they could be drawn. The scene
rendered perfectly and showed nothing — worth recording, because a black screen looks like a
shader failure and was in fact a frustum.

The logarithmic depth buffer is what makes a range this absurd usable at all, and the point
layers disable depth testing entirely, so the only geometry actually needing depth precision is
the handful of nearby bodies.

---

## No science package depends on Three.js

Enforced by an ESLint `no-restricted-imports` rule covering every package under `packages/`.
Three.js in `packages/physics` would compile, pass every test, and quietly destroy the
separation that lets the science layers be tested without a GPU — which is exactly the kind of
invariant that needs a machine to check it.
