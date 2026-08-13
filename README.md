<div align="center">

# Aether

**A distance-accurate exoplanet explorer where every pixel can name its evidence.**

Fly from one astronomical unit to a two-metre observer height on a real exoplanet — with
correct positions, real stellar colours, and an honest label on everything that is inferred
rather than measured.

<img src="docs/assets/trappist-1-lineup.jpg" alt="Artist concepts of the seven TRAPPIST-1 planets in a row" width="88%">

<sub><i>The TRAPPIST-1 planets. Artist concepts — nobody has ever resolved an exoplanet surface,
and that fact is the whole design problem. NASA/JPL-Caltech, public domain.</i></sub>

</div>

---

## What this is

Three kinds of exoplanet software exist, and none of them do what Aether does.

| | Strength | Limitation |
|---|---|---|
| **Catalogs** — NASA Exoplanet Archive, ExoFOP | Authoritative | Tables. No sense of place. |
| **Visualizers** — OpenSpace, Gaia Sky, NASA Eyes | Correct orbits | Planets are spheres. You cannot land. |
| **Space games** — No Man's Sky, Elite, KSP | Immersion, agency | Entirely invented. Zero traceability. |

Aether occupies the empty quadrant: **immersive and auditable at the same time.**

### The claim we make, and the one we refuse

For almost every exoplanet there is no spatially resolved surface observation. Transmission
spectra constrain atmospheres, not geography. Mass and radius constrain a *class* of
interior, not a coastline.

So Aether does **not** claim to reconstruct a planet's true surface. It claims this instead:

> Aether generates deterministic, physically admissible surface hypotheses conditioned on
> measured system data, retrieval posteriors, interior models, and Solar System analog data.
> Every visible feature is labelled by evidence class and confidence.

The word *accurate* is reserved for orbits, distances and unit conversions. Generated
geography is **scientifically constrained**, never *accurate* and never *predicted*.

---

## The central idea: the planet becomes more certain as you observe it

<img src="docs/assets/trappist-1f-surface.jpg" alt="Artist concept of the surface of TRAPPIST-1f" width="100%">

<sub><i>What standing on TRAPPIST-1f might look like. "Might" is doing all the work in that
sentence, and Aether is built to keep saying so. NASA/JPL-Caltech, public domain.</i></sub>

Pick a planet with three measured parameters and the hypothesis envelope is wide: the
surface is a guess, and it is drawn with a strong amber speculation rim to say so. Then add
evidence:

| Add | And you gain |
|---|---|
| **Gaia** | A stellar distance, so the transit depth becomes a real radius |
| **Radial velocity** | A mass, therefore density and surface gravity |
| **JWST** | An atmosphere, so the sky colour is derived rather than assumed |

The envelope narrows, hypotheses are eliminated, the world re-composes, and the amber rim
recedes. The discovery loop, the terrain generator, the provenance system and the
uncertainty machinery are not four features — they are one mechanic.

---

## Missions as evidence, not filters

<img src="docs/assets/mission-timeline.svg" alt="Timeline of exoplanet missions from 1990 to 2045" width="100%">

Aether models **fourteen missions**. Each declares its instruments, wavelength coverage, and
— the part that matters — exactly which physical parameters its data can constrain.

Selecting missions is a scientific act. Choose TESS alone and you have a radius ratio and a
period; parameter coverage sits under 25% and the surface is mostly invention. Choose
"everything flying today" and it climbs past 70%.

Two rules keep this honest:

- **Quality is the best across missions, never the sum.** Ticking more boxes cannot
  manufacture confidence.
- **The envelope never fully closes.** Even with every mission selected it bottoms out at
  15%, because no exoplanet surface has ever been resolved. That floor is not pessimism.

The Habitable Worlds Observatory is the only mission that constrains a surface at all — and
even then only weakly, because published work finds ocean and sand nearly indistinguishable
from 0.4–1.8 µm, with a severe degeneracy between planetary radius and surface albedo.

---

## The sky is a map, not a backdrop

The star field is **109,389 real stars at their measured parallax distances**, from the
[HYG database](https://codeberg.org/astronexus/hyg) — Hipparcos for the distances, the Yale
Bright Star Catalogue for the naked-eye sky, Gliese for nearby stars. These are the same
underlying catalogues OpenSpace's Digital Universe star layer is built from.

Two things make it a map rather than a dome:

- **Positions are three-dimensional and real.** The constellations are an accident of our
  viewpoint, and would distort if you travelled far enough. Nothing is painted on a sphere.
- **Brightness is computed, not stored.** Apparent magnitude comes from the distance
  modulus, `m = M + 5·log₁₀(d) − 5`, so approaching a star brightens it by exactly the
  right amount.

Colour runs B−V colour index → effective temperature ([Ballesteros 2012](https://doi.org/10.1209/0295-5075/97/34008))
→ blackbody → sRGB, through the *same* `stellarColor()` that lights the planets. One
physical model, applied consistently.

The tests check it against the real sky: the brightest star comes out at magnitude −1.46
(Sirius), there are ~8,700 stars brighter than the naked-eye limit against the ~9,000
usually quoted, and the count roughly triples per magnitude step as it should.

Loading is progressive — the naked-eye tier is 170 KB and appears immediately; the full
2.1 MB catalogue streams in behind it.

> **On licensing:** OpenSpace renders from the AMNH Digital Universe atlas, whose
> [licence](https://www.amnh.org/research/hayden-planetarium/digital-universe/download/digital-universe-license)
> requires written permission to redistribute inside software. HYG carries the same science
> from the same sources under CC BY-SA 4.0. Going to the shared upstream is both the more
> permissive route and the better-provenanced one. See
> [`packages/stars/data/ATTRIBUTION.md`](packages/stars/data/ATTRIBUTION.md).

---

## Host stars, at their real colours

<img src="docs/assets/hr-diagram.svg" alt="Hertzsprung-Russell diagram of the catalog host stars" width="100%">

Every marker is filled with its star's true blackbody colour, computed by the same
`stellarColor()` function that lights the 3D scene. TRAPPIST-1 at 2566 K really is that
orange, and a world lit by it looks nothing like a world lit by the Sun. We do not correct
for it — an M-dwarf world is genuinely dim, and that is a teaching moment, not a bug.

---

## Architecture

Every package is a building block with one responsibility and no circular dependencies.
Dependencies point strictly downward, so any layer can be replaced without touching the ones
beneath it.

```
apps/
  web/            Three.js client — the only package that knows about rendering

packages/
  deepsky/        Galaxies, clusters and nebulae (OpenNGC) + derived distances
  stars/          Real star catalogue (HYG) + physical photometry
  solar-system/   Real J2000 elements, Keplerian mechanics, the terrain validation path
  terrain/        Terrain operators + physics admissibility gates + program compilation
  missions/       Mission registry + the evidence model
  physics/        Formula registry + deterministic derivations with full provenance
  schema/         The contract: Science / Inference / Visual layers, LLM containment
  coordinates/    f64 nested reference frames, floating-origin camera, depth partitioning
  units/          SI discipline — branded quantities, IAU/CODATA constants, conversions
```

```
web ──► solar-system ──► terrain ──► physics ──► units
 │                          └──────► schema ───► units
 ├──────► missions ─────────────────────────────► units
 └──────► coordinates ──────────────────────────► units
```

**The renderer has already changed twice** — C++/OpenGL → Babylon.js → Three.js — and the
science layers needed zero rework each time, because everything above `apps/` is written
against the contract rather than against an engine. That line is worth holding.

### Three layers, three permission levels

```ts
interface PlanetModel {
  science: ScienceSpec;       // ingestion + allowlisted physics      affects science: yes
  inference: InferenceSpec;   // versioned models + prior resolver    affects science: yes, with uncertainty
  visual: VisualSpec;         // composer, LLM, texture pipeline      affects science: NO
}
```

The LLM service holds no credential and no schema field that can reach `ScienceSpec`.
Containment is structural, not a system prompt — and there is a test suite that proves it.

### The precision problem

Standing on a planet 40 light-years away spans ~27 orders of magnitude. `float32` gives ~7
significant digits and `float64` gives ~16, so no single linear coordinate system survives
it: subtracting two huge, nearly-equal doubles annihilates the low bits.

Aether never forms the huge numbers. Every frame stores its position *relative to its
parent*, and two frames are related by walking to their lowest common ancestor. A one-metre
offset survives at 40 light-years to better than a nanometre — while the naive
absolute-subtraction approach loses the metre entirely. Both are asserted in
`packages/coordinates/src/precision.test.ts`.

---

## Quick start

```bash
git clone https://github.com/Hussaincodes01/Aether-Space-Program.git
cd Aether-Space-Program
pnpm install
pnpm dev            # http://localhost:5173
```

Requires **Node 22+** and **pnpm 9+**.

| Command | What it does |
|---|---|
| `pnpm dev` | Run the client |
| `pnpm check` | Typecheck + test — exactly what CI runs |
| `pnpm test` | Tests only |
| `pnpm build` | Build every package and the client |

**Controls:** `W A S D` move · `R` / `F` up and down · `Shift` boost · mouse wheel throttle ·
`Esc` release the mouse.

Watch the **local coords** readout in the HUD. It stays small no matter how far the camera
is from the origin — that is frame rebasing doing its job. If it ever climbs past ~1e12 m,
the f32 upload will start to jitter and something has broken.

---

## Start at home

`pnpm dev` puts you in **low Earth orbit**, on today's date. Every planet sits on its real
Keplerian orbit, advanced from the JPL approximate elements — orbital periods reproduce the
published values to better than 0.1%, and to 0.01% for the terrestrial planets.

That starting point is not sentiment. **The Solar System is the only place the generator can
be checked against ground truth.** Nobody has resolved an exoplanet surface, but we have
maps of Mars. So the test suite asserts that feeding real parameters into the operator gates
reproduces worlds we have actually visited:

| World | What the gates must produce | Why |
|---|---|---|
| **Moon** | Craters. No wind, water or ice erosion. | Airless, 0 Pa |
| **Mars** | Dunes and craters, but **no rivers today** | 6 mbar sustains the largest dune fields known; liquid water is not stable |
| **Earth** | Rivers, dunes and ice | 1 bar, stable water, 71% ocean |
| **Jupiter** | **No solid surface at all** | 1326 kg/m³ — nothing to stand on, and nothing to hold a crater |

If Mars came out as an ocean world, the rules would be wrong — and no amount of exoplanet
work would ever have revealed it. Every exoplanet this project renders inherits its
credibility from whether Mars looks like Mars.

<img src="docs/assets/trappist-1-vs-solar.jpg" alt="The TRAPPIST-1 system compared to the inner Solar System" width="100%">

<sub><i>All seven TRAPPIST-1 planets orbit closer than Mercury. NASA/JPL-Caltech, public domain.</i></sub>

## Status

**Week 1–2 of the plan in [`docs/PRD.md`](docs/PRD.md): the multi-scale precision spike.**


<sub><i>All seven TRAPPIST-1 planets orbit closer than Mercury. NASA/JPL-Caltech, public domain.</i></sub>

Working today:

- ✅ f64 hierarchical frames, floating-origin camera, rebasing with hysteresis
- ✅ Physics registry — equilibrium temperature, insolation, density, gravity, escape
  velocity, scale height, Jeans parameter, Kopparapu habitable zone, blackbody colour
- ✅ Three-layer contract with structurally enforced LLM containment
- ✅ Terrain operators with physics gates **and height evaluation** — craters with rims and
  ejecta, shield volcanoes on flood-basalt provinces, fracture networks, transverse dune
  fields, dendritic valley incision, ice caps that follow the actual cold trap
- ✅ Displaced planet geometry with computed normals and physics-driven surface colour
- ✅ Rayleigh/Mie atmospheric scattering, coefficients derived from mean molecular weight
- ✅ Star field with a realistic luminosity function and true blackbody colours
- ✅ Real Solar System: J2000 orbital elements, explicit rotation matrices, Newton-solved
  Kepler equation, validated against published periods and distances
- ✅ **Real sky**: 109,389 stars at measured parallax distances from HYG (Hipparcos, Yale,
  Gliese) — the same catalogues OpenSpace draws on, under a redistributable licence
- ✅ **Deep sky**: 12,160 galaxies, clusters and nebulae from OpenNGC, 10,568 at distances
  derived from redshift or parallax, coloured by emission physics
- ✅ Live terrain generation on approach, released on departure, so memory stays bounded
- ✅ Mission registry and evidence model, wired to the rendered speculation rim
- ✅ Off-thread terrain generation with progressive refinement — a coarse world appears in
  ~20 ms, then sharpens to ~41k vertices without the tab ever freezing
- ✅ Frame-rate-independent camera damping and look smoothing
- ✅ **217 tests**, including the two merge gates the PRD requires and cost guards on
  terrain evaluation

Not built yet: real archive ingestion, chunked LOD for close approach, retrieval ML, the
hypothesis ensemble UI, and the game layer. See the PRD for sequencing.

### About that terrain

Earth's entire relief — Everest to the Mariana Trench — is about 20 km on a 6371 km radius.
**That is 0.3%.** At true scale a terrestrial planet is smoother than a billiard ball, and
every "realistic" planet you have seen rendered is vertically exaggerated, usually by one to
two orders of magnitude, silently.

Aether exaggerates too, because a perfect sphere teaches nothing. The difference is that the
multiplier is a `VisualSpec` value, it is displayed in the HUD next to the true relief, and
setting it to `1` shows you the honest answer.

**Known limitation, recorded rather than hidden:** the terrain operator set does not yet
model the consequences of tidal locking, so Earth and TRAPPIST-1e compile to the most
similar worlds in the catalog. There is a test pinning that distance so it cannot quietly
drift downward. Adding a tidal-locking operator is the top item in the backlog.

---

## Contributing

New contributors: start with **[CONTRIBUTING.md](CONTRIBUTING.md)**. It explains the three
registries, how to add a feature by writing exactly one file, and the two invariants that
must never break.

The short version: adding a physics formula, a terrain operator or a mission means creating
one file and adding one export line. No switch statements, no dispatch tables.

---

## Credits and licence

Imagery is NASA/JPL-Caltech, public domain. The Hertzsprung–Russell diagram and the mission
timeline are generated for this project.

Scientific method draws on the NASA Exoplanet Archive, the MALBEC radiative-transfer
intercomparison, the Kopparapu habitable-zone parameterisation, Zeng et al. mass–radius
relations, and published work on surface degeneracies in reflected-light observations. Full
citations are in [`docs/PRD.md`](docs/PRD.md).

This project uses NASA data and imagery. It is **not** endorsed by or affiliated with NASA,
ESA, or any space agency.

> **Every export and screenshot carries this, burned into the framebuffer:**
> *Data-grounded artistic reconstruction. Geography is procedurally generated and is not an
> observation.*
