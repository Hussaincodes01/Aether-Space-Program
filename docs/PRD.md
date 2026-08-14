# Product Requirements Document

## **Aether** — Distance-Accurate Exoplanet Visualization with AI-Constrained Surface Generation

|                   |                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Version**       | 2.1 — consolidates PRD v2.0 with the v1.2 technical addendum                                                             |
| **Date**          | 2026-08-03                                                                                                               |
| **Status**        | Approved direction. Implementation status and remaining limitations: see the Status section of [README.md](../README.md) |
| **Team**          | 1 game developer · 2 AI developers · 1 lead (product / data / backend)                                                   |
| **Renderer**      | **Three.js + TypeScript.** WebGPURenderer + TSL preferred; WebGL2 reduced-quality fallback.                              |
| **Primary claim** | Accurate astronomical positions, distances and orbits; **scientifically constrained** — not reconstructed — surfaces.    |
| **First release** | 16 weeks (team of four); ~28 weeks part-time                                                                             |

> **Implementation status, 2026-08-14.** The pipeline this document specifies is connected
> end to end: typed catalog with provenance, mission evidence gating, physics derivations,
> inference for the gaps, a terrain hypothesis, and a provenance inspector. What is _not_
> done is recorded honestly rather than quietly: reversed-Z is built but not wired, depth
> partitioning is opt-in pending a performance measurement on real hardware, the typed
> catalog is three systems, there is one inference prior, no LLM composer is plugged into
> the containment boundary, and no terrain has been scored against a real Solar System map.
> See the README Status section and docs/ for the detail.

> **Document history.** v2.0 consolidated six planning documents and the original PRD.
> v2.1 integrates the v1.2 addendum, which supersedes v2.0 on the renderer, the data model,
> LLM containment, the determinism promise, and MVP scope. Research findings from v2.0 that
> v1.2 does not cover are preserved here and marked where they constrain v1.2's design.
> The original PRD survives as `Aether-Exoplanet-Platform-PRD.pdf`.

---

## 1. Vision and the Defensible Claim

### 1.1 The gap

| Category               | Examples                       | Strength                      | Fatal limitation                      |
| ---------------------- | ------------------------------ | ----------------------------- | ------------------------------------- |
| Scientific catalogs    | NASA Exoplanet Archive, ExoFOP | Authoritative                 | Tables. No sense of place.            |
| Scientific visualizers | OpenSpace, Gaia Sky, NASA Eyes | Accurate positions and orbits | Planets are spheres. You cannot land. |
| Procedural space games | No Man's Sky, Elite, KSP       | Immersion, agency             | Entirely invented. Zero traceability. |

Aether occupies the empty quadrant: immersive, playable **and** auditable. Research confirms
it is genuinely empty — OpenSpace's exoplanet module renders orbits and a habitable-zone
shell and stops; NASA's Exoplanet Travel Bureau surfaces are explicitly artist
illustrations.

### 1.2 What we must never claim

**Aether does not reconstruct an exoplanet's true surface from NASA chemical data.**

For almost every exoplanet there is no spatially resolved surface observation. Transmission
and emission spectra primarily constrain atmospheric and thermal properties, often with
strong degeneracies. Mass, radius and stellar irradiation constrain _classes_ of interiors
and surfaces but do not uniquely determine continents, mountain ranges, craters, oceans or
colours.

**The defensible claim:**

> Aether generates deterministic, physically admissible surface hypotheses conditioned on
> measured system data, atmospheric retrieval posteriors, planetary-interior models, and
> Solar System / laboratory analog data. Every visible feature is labeled by evidence class
> and confidence.

The renderer displays **one reproducible realization of a posterior hypothesis** — not a
photograph, not a prediction of exact geography.

### 1.3 Evidence classes

1. **Measured** — direct catalog or spectral measurement.
2. **Derived** — deterministic equation applied to measured inputs.
3. **Retrieved** — posterior distribution inferred from a spectrum.
4. **Constrained prior** — statistical or geophysical range consistent with the evidence.
5. **Procedural realization** — one deterministic terrain instantiation sampled from the
   constrained prior.
6. **Decorative** — purely visual detail that cannot affect scientific interpretation.

### 1.4 Language policy

The word **accurate** may be used for orbital calculations, unit conversions and measured
parameters with stated tolerances.

Generated geography is described as **scientifically constrained**, **physically
plausible**, or **data-grounded**. Never _accurate_, _predicted_, or _reconstructed_.

### 1.5 The central mechanic (v1.1 and beyond)

> **The planet becomes more certain as you observe it.**

A newly-selected planet has three or four measured parameters, so the admissible hypothesis
ensemble is wide and the rendered world is visibly uncertain. Spending observing time
narrows the posterior; hypotheses are eliminated; the ensemble collapses; the world
re-composes with tighter bounds. A transmission spectrum arrives and the sky colour changes
**for a real physical reason** — Rayleigh coefficients from the retrieved mean molecular
weight, not an art choice.

This unifies the discovery loop, the surface generator, the provenance system and the
uncertainty machinery into one thing. **It is scheduled for v1.1, not the first release**
(§17) — but the data model must support it from day one, which is why `hypothesis_id` and
`observation_state` are part of the cache key from the start.

### 1.6 Design principles (non-negotiable)

1. **Containment is structural, not conventional.** The LLM has no API or database
   permission that can mutate the scientific record. Schemas and permissions enforce this,
   not a system prompt.
2. **Physics first, inference second, art third.** A physics-only build must produce a
   complete world alone.
3. **Determinism within stated tolerances** (§13.2). Not byte-identical GPU output — that
   promise cannot be kept and must not be made.
4. **Non-uniqueness is shown, not averaged away.** Multiple hypotheses, not one world with
   a confidence tint.
5. **Distance accuracy outranks surface fidelity.** When they conflict, positions win.
6. **Graceful degradation, loudly announced.** Missing data produces a visibly
   lower-confidence world, never a silently confident one.

---

## 2. Goals, Non-Goals, Metrics

### 2.1 Goals (first release)

- **G1** — Continuous camera from system scale to a two-metre observer height, no jitter.
- **G2** — Three well-selected exoplanets, fully QA'd, with immutable base truths from the
  NASA Exoplanet Archive.
- **G3** — Three to eight surface hypotheses per planet, user-cyclable.
- **G4** — Deterministic cube-sphere terrain from a versioned `TerrainProgram`.
- **G5** — Atmosphere scattering for one well-tested composition family.
- **G6** — Feature-level provenance inspector; every displayed value carries source, unit,
  method and version.
- **G7** — One constrained AI texture pipeline **plus** a deterministic procedural fallback;
  the product works fully with AI generation disabled.
- **G8** — Scientific-scale and visibility-enhanced display modes, every multiplier exposed.
- **G9** — Watermarked exports.
- **G10** — 60 fps at 1080p on a mid-range 2021 dGPU; ≥30 fps on integrated at reduced
  settings.

### 2.2 Non-Goals (first release)

- Fifteen planets. Three, done properly.
- Trained atmospheric retrieval in the production path — the physics/priors pipeline ships
  first and acts as retrieval's fallback.
- The game layer: observing-time budget, discovery booklet, mission planning, FPV traversal.
  **Scheduled v1.1** (§17.3).
- Part-based vessel construction with joint physics, full aerodynamics, N-body gravitation,
  docking, multiplayer. **This list is what killed KSP2** (§17.3).
- Photorealistic vegetation or fauna; any depiction of life beyond abstract
  biosignature-consistent tinting, and only when spectra justify it.
- Publishing derived data as a science-grade catalog.
- VR and mobile-native builds.

### 2.3 Metrics

| Metric                                              | Target                      |
| --------------------------------------------------- | --------------------------- |
| Planets, fully QA'd                                 | 3                           |
| Hypotheses per planet                               | 3–8                         |
| Provenance-complete displayed values                | 100%                        |
| Frame time p95 (surface, 1080p, mid GPU)            | < 16.6 ms                   |
| Cold load to interactive system view                | < 5 s at 25 Mbps            |
| Cross-GPU terrain height agreement                  | within documented tolerance |
| Uncertainty propagation vs. Monte Carlo reference   | within stated tolerance     |
| Provenance-policy violations reaching `ScienceSpec` | **0**                       |

---

## 3. Users

| Persona                      | Need                                                     | Design implication                                                               |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Curious public / student** | "What would it be like to stand there?"                  | Zero-friction browser entry, cinematic default camera, plain language            |
| **Educator**                 | Demonstrate inference vs. measurement                    | Presenter mode, deep-link to exact camera pose, hypothesis and observation state |
| **Researcher**               | Check the visualisation does not misrepresent their data | Full provenance export (JSON + BibTeX), parameter override, hypothesis cycling   |
| **Player** (v1.1)            | Real stakes and progression                              | Observing-time scarcity, calibration scoring, discovery booklet                  |

---

## 4. Assets in Hand

### 4.1 `1MB space engine/` — C++ reference implementation

7,600 lines of C++20, zero dependencies, 932 KB binary. **Not the shipping renderer.** Three
retained roles:

- **Proof the algorithms work.** f64 hierarchical reference frames validated to 27 ly,
  logarithmic depth, cube-sphere chunked quadtree LOD, Rayleigh/Mie scattering, water,
  clouds, star octree, gas-giant interior physics validated to 10–15% against the Galileo
  probe.
- **Portable algorithms.** `terrain()` translates to TSL; `gasgiant.*` (dry adiabat,
  `T(d)=T₀+Γd`, `P=P₀(T/T₀)^3.5`, crush depth), `blackbody.*` and the Kepler solver port
  verbatim as TypeScript.
- **Reference generator for archival reproducibility** (§13.2). A CPU implementation that
  can regenerate canonical heights independently of any GPU.

**The largest asset is that the game developer has solved these problems once.**

### 4.2 `ExoPlanet Surface Compose ML/` — trained surface-composition models

Pham & Kaltenegger (2022) replication: 53,130 samples × 9 broadband filter fluxes
(0.45–2.35 µm) → 6 surface fractions. SVR, RF, XGBoost, MLP trained; reported MSE ≈ 0.0022.

**Defects requiring week-1 repair:**

1. **`Models.ipynb` cannot run as committed.** It loads labels from
   `data/surface_combinations.pkl`, which is not in the repository — only
   `data/fin_data.pkl` was committed. The reported metrics are unverifiable.
2. `random.shuffle(data)` is unseeded and the split is not committed. Even with labels
   restored, the numbers cannot be reproduced exactly.
3. Cell 4 builds `noisy_data` (1,000 realizations per test spectrum at S/N 100) and never
   uses it. The noise-robustness analysis was set up and abandoned — and noise robustness
   is the entire question for real observations.
4. No validation split, no HPO, no calibration, no uncertainty output.

**Its accuracy ceiling is now measured in the literature — §10.4. This is load-bearing for
the analog library and must be read before the model is used anywhere.**

### 4.3 `OpenSpace/` — inspiration only

MIT-licensed, NASA-funded, C++23. Nothing is built on it. Two patterns worth studying: the
**websocket topic + Lua control plane** (one design serving AI interface, remote UI and test
automation) and the **`TileProvider` abstraction** (async, LRU-cached, priority-queued).

For ambition calibration: OpenSpace colours exoplanets by **radius bucket alone** — no
temperature, density, composition, provenance or uncertainty. Aether's physics layer already
exceeds the reference platform.

---

## 5. The Three-Layer Data Model

The central architectural decision. Observational truth, inference and display choices are
separated so a visually useful fallback can never become a measurement by accident.

```ts
interface PlanetModel {
  science: ScienceSpec; // Ingested measurements and allowlisted derivations
  inference: InferenceSpec; // Cited priors, posterior distributions, uncertainty
  visual: VisualSpec; // Render-only scale, textures, artistic realization
}
```

| Layer           | Who may write                                                        | Affects scientific calculations? |
| --------------- | -------------------------------------------------------------------- | -------------------------------- |
| `ScienceSpec`   | Catalog ingestion and allowlisted physics functions                  | Yes                              |
| `InferenceSpec` | Versioned statistical/ML models and the deterministic prior resolver | Yes, with uncertainty            |
| `VisualSpec`    | Visual composer, LLM proposals, generative texture pipeline          | **No**                           |

**The LLM service has no API or database permission that can mutate `ScienceSpec` or
`InferenceSpec`.** This is enforced by credentials and schema, not by instruction.

### 5.1 ScientificQuantity and BaseTruthSpec

```ts
interface ScientificQuantity {
  valueSI: number | null;
  unit: string;
  uncertainty?: { minus: number; plus: number; distribution?: string };
  method: "measured" | "derived" | "retrieved" | "prior";
  sourceId: string; // must exist in the ingested source registry
  sourceUrl?: string;
  retrievedAt: string;
  confidence?: number;
}

interface BaseTruthSpec {
  objectId: string;
  aliases: string[];
  dataSnapshotId: string;

  host: {
    massKg: ScientificQuantity;
    radiusM: ScientificQuantity;
    luminosityW: ScientificQuantity;
    effectiveTemperatureK: ScientificQuantity;
    ageS: ScientificQuantity;
    metallicityDex: ScientificQuantity;
    elementalAbundances?: Record<string, ScientificQuantity>;
  };

  planet: {
    massKg: ScientificQuantity;
    radiusM: ScientificQuantity;
    orbitalPeriodS: ScientificQuantity;
    semimajorAxisM: ScientificQuantity;
    eccentricity: ScientificQuantity;
    inclinationRad: ScientificQuantity;
    bondAlbedo?: ScientificQuantity;
  };

  observations: {
    spectra: SpectrumReference[];
    lightCurves: DataReference[];
    phaseCurves: DataReference[];
  };
}
```

`BaseTruthSpec` values are **immutable**. A user may change them only in a clearly labeled
sandbox branch.

### 5.2 Precedence

```text
Published measurement
  > self-consistent catalog solution
  > deterministic derivation
  > calibrated retrieval posterior
  > population prior
  > default prior
```

**Never combine incompatible values from different papers without recording the composition
explicitly.** Keep posterior samples or distributions where possible rather than collapsing
to a scalar plus a generic confidence score.

### 5.3 Everything is renderer-independent

`BaseTruthSpec`, `EnvironmentSpec` and the whole science stack are renderer-agnostic. This
has now been validated twice: the renderer changed from C++ to Babylon.js to Three.js, and
**the science layer required zero rework each time**. Hold this line.

---

## 6. LLM Containment and Missing-Value Resolution

```text
LLM response
  -> VisualProposal (strict schema, additionalProperties: false)
  -> source/field validator
  -> deterministic missing-value resolver
  -> EnvironmentSpec composer
  -> signed, content-addressed EnvironmentSpec
  -> Three.js renderer
```

The LLM schema **intentionally omits** canonical physical fields — mass, radius, distance,
orbital period, atmospheric abundance. Unknown keys are rejected.

**If an LLM emits a forbidden field:**

1. Reject or strip it.
2. Record a provenance-policy violation for observability.
3. Leave the `ScienceSpec` value `null`/unknown.
4. If visualization needs a value, call the approved deterministic resolver.
5. Store the result in `InferenceSpec` as a distribution and, if needed, a seeded sample.
6. Copy only the render-safe result into `VisualSpec` with `affects_physics: false`.
7. **Continue rendering with a visible inferred/placeholder badge** rather than failing.

### 6.1 Resolver order

```text
compatible published measurement
  -> deterministic derivation from measurements
  -> calibrated retrieval posterior
  -> cited conditional population prior
  -> render-only placeholder or uncertainty marker
```

```json
{
  "science": { "radius_earth": { "value": null, "method": "unknown" } },
  "inference": {
    "radius_earth": {
      "median": 1.18,
      "p16": 0.82,
      "p84": 1.73,
      "method": "sampled_prior",
      "prior_id": "rocky-planet-population-v1",
      "seed": "sha256:..."
    }
  },
  "visual": {
    "render_radius_earth": {
      "value": 1.18,
      "method": "visual_placeholder",
      "source_field": "inference.radius_earth",
      "affects_physics": false
    }
  }
}
```

### 6.2 Citations must resolve

**A hallucinated citation is also invalid.** A `sourceId` is accepted only if it already
exists in Aether's ingested source registry. Arbitrary URLs or bibliography text produced by
an LLM do not establish provenance and are rejected by the validator.

### 6.3 What the LLM may and may not do

**Allowed:** convert a user request into a validated `GenerationIntent` or `VisualProposal` ·
select an existing hypothesis and named model from an allowlist · explain why a hypothesis
was generated · summarize caveats and provenance in plain language · suggest which
assumptions to explore · produce prompts and art direction for the texture model · generate
cosmetic microtexture **inside scientific constraint masks**.

**Forbidden:** write to `ScienceSpec` or `InferenceSpec` · invent chemical abundances or
upgrade a prior to `measured` · substitute an unregistered number for a missing value ·
emit executable shader or terrain code bypassing reviewed operators · change orbital
positions, macro terrain, ocean/ice masks, atmosphere or bulk albedo outside approved
constraints · feed raw model output to Three.js without validation and asset registration ·
claim exact continents, oceans, life, colours or weather.

**The LLM is a constraint interpreter and explainer. It is not the terrain generator and not
the numerical inference engine.**

---

## 7. Distance-First Accuracy and Scale Modes

Priority order:

1. Host-star sky position, epoch, distance and proper motion.
2. Planet-to-star orbital distance, period and phase.
3. Correct unit conversion and uncertainty.
4. Accurate relative radius where measured.
5. Scientifically constrained — explicitly non-observed — surface appearance.

Given right ascension `α`, declination `δ`, distance `d`:

```text
x = d cos(δ) cos(α)
y = d cos(δ) sin(α)
z = d sin(δ)
```

The record retains **coordinate frame, epoch, parallax/distance uncertainty and
proper-motion source**. Missing distance is represented as a direction or an uncertainty
interval. **The LLM must not choose a convenient depth.**

For local orbits, preserve semimajor axis, period and eccentricity where known. Unknown
inclination, argument of periapsis or longitude of ascending node is **stored as unknown**;
a conventional display orientation may be chosen in `VisualSpec` with confidence zero and a
visible `visual_convention` label.

### 7.1 Scale modes

**Scientific scale** — positions, orbit sizes and known radii physically scaled.
Unknown-radius planets appear as points, uncertainty glyphs or prior ranges. **No hidden
exaggeration.**

**Visibility-enhanced** — distances and orbital positions remain physically correct; radius,
atmosphere thickness, orbit-line width and markers may be enlarged. **Every multiplier is
displayed in the HUD and in exported provenance.**

```json
{
  "visual_scale": {
    "mode": "visibility_enhanced",
    "distance_scale": 1.0,
    "planet_radius_scale": 250.0,
    "atmosphere_thickness_scale": 20.0,
    "orbit_line_mode": "minimum_screen_pixels"
  }
}
```

Scientific coordinates are **never** overwritten by cinematic transforms. Camera transitions
may use logarithmic or interpolated travel timing; their target positions stay anchored to
the scientific coordinate model.

---

## 8. Data Sources

### 8.1 NASA Exoplanet Archive

Use the **`ps` table for all physics derivations** — each row is one self-consistent
published solution with a real bibcode. Use `pscomppars` for catalog completeness, browsing
and demographic context.

**This distinction is not stylistic.** The Archive documents that PSCompPars

> "will necessarily include parameters from a variety of references for a given planet,
> indicating the set of reported parameter values may not be internally or physically
> self-consistent."

If a mass from paper A and a radius from paper B produce a bulk density, that number appears
in no publication, has no meaningful error bar, and may be physically impossible. Provenance
is our entire claim; this is the first thing a reviewing astronomer checks. Where a value
exists only in `pscomppars`, label it as coming from a different reference than the rest of
the row and reduce confidence. **Where papers disagree, show the disagreement** — this is a
differentiator and, in v1.1, a game mechanic.

Use the **Atmospheric Spectroscopy table** for observed transmission, emission and
direct-imaging spectra. **These are evidence inputs, not chemical truth.** Abundance
estimates must come from a documented retrieval model and retain posterior uncertainty and
degeneracy.

### 8.2 NASA Planetary Data System — the analog library

PDS supplies **labeled analog classes**, mineral spectra, weathering examples, oxide
distributions and generator calibration targets:

- **Atmospheres node** — atmospheric profiles and non-imaging atmospheric data
- **Geosciences node** — surface/interior, thermal and spectroscopy products
- **Cartography and Imaging node** — maps and calibrated planetary imaging
- **Small Bodies node** — asteroid, comet and dust analogs
- **NAIF/SPICE** — geometry, frames, orientation, ephemerides

**PDS chemistry from Mars, the Moon or asteroids must never be presented as a measurement of
an exoplanet.** It constrains the prior; it is not evidence about the target.

### 8.3 NASA Planetary Spectrum Generator — the validation loop

```text
Proposed atmosphere/surface hypothesis
  -> synthetic spectrum
  -> instrument convolution / noise
  -> comparison with observed spectrum
  -> likelihood or rejection score
```

This closes the loop: hypotheses that cannot reproduce the observed spectrum are **rejected**
rather than displayed with low confidence. PSG supports atmospheric profiles, gases, aerosols
and line-by-line / correlated-k calculations.

**Cache and rate-limit all calls.** Bulk training uses a local approved deployment or
precomputed grids — the public API is not a batch-compute service.

### 8.4 Gaia DR3

Stellar distance, T_eff, radius, proper motion; and the background star field rendered from
the **planet's** position, not Earth's.

---

## 9. Physics Engine

Deterministic, closed-form, unit-checked. Every function returns
`DerivedValue(value, err, inputs_used, formula_id, assumptions)` — never a bare float. The
`formula_id` maps to a LaTeX string, which is how the provenance inspector is built for free.

| Quantity                          | Method                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Insolation                        | `S = L★ / 4πa²`                                                                                       |
| Equilibrium temperature           | `T_eq = T★ √(R★/2a)(1−A_B)^¼`; `A_B` and redistribution factor are explicit, user-visible assumptions |
| Bulk density                      | `ρ = 3M / 4πR³`                                                                                       |
| Surface gravity, escape velocity  | `g = GM/R²`, `v_esc = √(2GM/R)`                                                                       |
| Composition from M–R              | Zeng et al. 2016/2019                                                                                 |
| Mass ↔ radius when one is missing | Forecaster (Chen & Kipping 2017) — yields a _distribution_                                            |
| Scale height                      | `H = kT/(μg)`                                                                                         |
| Jeans escape parameter            | `λ = GMm/(kT_exo R)`                                                                                  |
| Cosmic shoreline                  | Zahnle & Catling 2017                                                                                 |
| Habitable zone                    | Kopparapu et al. 2013/2014, conservative and optimistic                                               |
| Tidal locking, tidal heating      | Standard, with stated Q and k₂                                                                        |
| Stellar colour                    | Blackbody at T_eff → CIE XYZ → sRGB                                                                   |
| Rayleigh coefficient              | `β ∝ 1/λ⁴` scaled by column density and μ                                                             |

**Testing:** `hypothesis` property tests — `T_eq` monotonically decreasing in `a`,
dimensional consistency, invariance to input unit choice. Uncertainty propagation validated
against Monte Carlo reference calculations.

---

## 10. Inference and Machine Learning

### 10.1 What ML is for

Only where a physical formula genuinely cannot answer.

| Job                                              | Why defensible                                  | Owner |
| ------------------------------------------------ | ----------------------------------------------- | ----- |
| Parameter imputation with calibrated uncertainty | Population statistics are real evidence         | AI-2  |
| Planet-class probability                         | The radius valley is a genuinely fuzzy boundary | AI-2  |
| Interior-composition inference                   | Degenerate but constrainable                    | AI-2  |
| Atmospheric retrieval surrogate                  | Full Bayesian retrieval costs CPU-hours         | AI-1  |
| Out-of-distribution detection                    | The most important safety feature in the stack  | Both  |
| Conformal / calibrated intervals                 | Turns a point estimate into a defensible claim  | AI-2  |

**Forbidden in the render path:** anything physics computes — equilibrium temperature,
insolation, gravity, escape velocity, scale height, orbits, habitable-zone bounds, stellar
colour.

### 10.2 Forward models — model choice is itself an uncertainty

The **MALBEC / CUISINES** intercomparison ran ten radiative-transfer codes (APOLLO, BART,
gCMCRT, petitRADTRANS, PSG, Exo_k/Pytmosph3r, SMART, SOCRATES, TauREx 3, PICASO) over
identical cases:

- Broad NIR agreement; **substantial disagreement in optical and UV** from incomplete
  linelist coverage and differing Rayleigh implementations.
- NIR differences near 1.05 and 1.3 µm from water and methane opacity treatment.
- **Atmospheric sub-layering alone can introduce errors up to 500 ppm** — larger than many
  signals of interest.
- MALBEC **deliberately declines to rank the codes.**

Therefore: **petitRADTRANS 3.x is the primary forward model** (maintained; ships both HITEMP
and ExoMol; makes the choice explicit at the call site as `H2O__ExoMol` vs `H2O__HITEMP`).
**Record the linelist in `model_versions`** — "petitRADTRANS 3.3.3, H2O__ExoMol,
CO__HITEMP" is a provenance claim; "retrieved with ML" is not. **Cross-check two or three
planets against PSG or PICASO** — inter-code disagreement on our own targets is an honest
number for the UI. **Sub-layer properly**; it is the cheapest large accuracy win available.

### 10.3 Retrieval — methodology is settled

- **Normalizing flows won the Ariel Data Challenge 2023** (AstroAI, first of 293).
- **Flow Matching Posterior Estimation with neural importance sampling outperforms nested
  sampling** on accuracy and simulation efficiency.
- The June 2026 review confirms DL matches or exceeds traditional pipelines in speed and
  accuracy, CPU-hours → seconds.

**Correction for the team: the Ariel Data Challenge 2024 was _not_ a retrieval challenge.**
It was signal extraction from spacecraft jitter noise. Read **ADC 2023**.

The same review names four open problems; two are our direct risk surface: **calibration of
uncertainties under noisy data**, and **generalization across instruments and populations**.

**Path:** LightGBM on binned spectra (baseline, days) → 1D CNN with heteroscedastic heads →
normalizing flows only at maturity. **PandExo noise injection is mandatory** — models trained
on noiseless spectra fail catastrophically on real data.

**Sequencing:** retrieval ML ships _after_ the physics/priors pipeline, and the priors
pipeline is its fallback.

### 10.4 The surface-composition model — measured accuracy ceiling

A March 2026 study of surface degeneracies in single-visit HWO reflected-light observations
of modern Earth constrains every component of the existing model:

- **Ocean and sand are spectrally near-indistinguishable** from 0.4–1.8 µm. Retrievals
  **systematically underestimated ocean and overestimated sand** across all models tested.
  Our feature set has both `sand` and `sandwater`.
- **Severe radius–albedo degeneracy.** Flux scales as `R_p² × reflectivity`, so a small
  bright planet and a large dim one are indistinguishable. Radius was systematically
  underestimated.
- **Cloud coverage is degenerate with radius and surface pressure.** Our feature set has
  `cloud`.
- **A single 100-hour HWO visit cannot break the albedo–radius degeneracy** without a priori
  information.
- Vegetation retrieves reliably, via the chlorophyll red edge.

**The reported MSE of 0.0022 was measured on noiseless spectra at fixed radius with no
cloud–radius coupling. It will not survive real data.** Required: report **per-component**
accuracy rather than aggregate MSE; add radius and cloud fraction as nuisance parameters;
run the abandoned noise study (accuracy vs. S/N from 10 to 1000, per component); cite the
degeneracy paper in the model card.

**Framing.** The model is trained on reflected-light photometry of Earth-analogue surfaces.
No planet in the catalog has such an observation. Its honest uses are **forward mode**
(given an assumed surface, predict what a future mission would measure), **consistency
checking** against Earth, Mars and Titan, and as an **HWO/LUVOIR science-case demonstrator** —
arguably the most fundable framing in the project.

**Upgrade path is published:** _Towards the Habitable Worlds Observatory: 1D CNN Retrieval of
Reflection Spectra from Evolving Earth Analogs_ (Aug 2025) — 1D CNN retrieving six molecular
abundances plus radius, gravity, surface pressure and temperature, trained on noise-injected
spectra, with **Monte Carlo Dropout** for uncertainty.

### 10.5 Calibration protocol — enforced in CI

MSE is not an accuracy claim for a provenance product. Calibration is.

- **Simulation-Based Calibration** rank histograms must be uniform.
- **Coverage tests** — held-out truths inside 68%/95% credible intervals must match nominal
  ±0.05. This number goes in the UI.
- **Reliability diagrams and ECE** for classifiers.
- **Conformal prediction** (MAPIE / crepes) for distribution-free guarantees.
- **OOD detection** on every model input, with explicit physics-only fallback and a UI
  message. **Ship the fallback before the model.**
- **Ablation against the physics baseline. If a model does not beat the rules-based prior on
  held-out data, ship the prior.**
- **Model cards** published in-app.

### 10.6 In-browser inference

Export via `skl2onnx`, `onnxmltools`, standard PyTorch export. Serve with `onnxruntime-web`
routing to the WebGPU execution provider with WASM fallback. The surface model is 9 inputs →
6 outputs — microseconds client-side, no server cost, instant re-inference for the sandbox.

**Determinism caveat.** WebGPU and WASM backends can differ in the last floating-point bits,
and different machines may select different backends. **Quantize model outputs to fixed
precision at the generator boundary** and treat the rounded value as canonical. Must be in
place before the first model reaches the render path.

---

## 11. Surface Hypothesis Contract

`EnvironmentSpec` publishes an **ensemble**, not one apparently certain surface. The user can
cycle through credible hypotheses — this communicates non-uniqueness far more honestly than
a single `overall_confidence` tint.

```json
{
  "surface_hypotheses": {
    "selected_id": "H03",
    "selection_seed": "sha256:...",
    "ensemble": [
      {
        "id": "H03",
        "posterior_weight": 0.28,
        "class_probabilities": {
          "airless_rocky": 0.08,
          "volcanic_rocky": 0.29,
          "temperate_rocky": 0.31,
          "ocean_world": 0.17,
          "ice_dominated": 0.15
        },
        "interior": {
          "core_mass_fraction": { "median": 0.31, "p16": 0.2, "p84": 0.43 },
          "water_mass_fraction": { "median": 0.02, "p16": 0.0, "p84": 0.12 }
        },
        "chemistry": {
          "source_role": "stellar-abundance prior plus Solar System analog library",
          "mineral_family_probabilities": {
            "silicate_basaltic": 0.52,
            "felsic": 0.08,
            "ultramafic": 0.21,
            "water_ice": 0.19
          }
        },
        "geophysics": {
          "tectonic_regime": "stagnant_lid",
          "tectonic_regime_probability": 0.44,
          "relief_rms_m": { "median": 1600, "p16": 500, "p84": 4800 },
          "crater_retention": { "median": 0.37, "p16": 0.1, "p84": 0.8 }
        },
        "terrain_program": {
          "version": "terrain-physics-0.1.0",
          "seed": "sha256:...",
          "operators": [
            "reference_ellipsoid",
            "long_wavelength_isostasy",
            "impact_population",
            "volcanic_constructs",
            "fracture_fields",
            "climate_conditioned_erosion",
            "microdetail"
          ]
        },
        "evidence": ["base.mass", "base.radius", "host.abundances", "retrieval.posterior"],
        "caveats": [
          "No spatially resolved exoplanet surface observation exists.",
          "Geography is a procedural realization and is not predicted."
        ]
      }
    ]
  }
}
```

### 11.1 Operator admissibility gates

Each terrain operator is enabled only when physics permits it. Every gate is a real,
unit-checked formula mapping to a `formula_id`, so the inspector text is template-generated:

| Operator                                | Gate                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `impact_population`                     | always possible; **retention** gated on atmospheric shielding, resurfacing rate, surface age |
| `volcanic_constructs`                   | interior heat — radiogenic (mass, age) or tidal (e, a, M★)                                   |
| `fracture_fields`                       | tidal stress and lithosphere, or tectonic regime                                             |
| `climate_conditioned_erosion` — fluvial | a liquid stable at (T_surf, P_surf): water, methane at Titan temperatures, or CO₂            |
| `climate_conditioned_erosion` — glacial | solid phase of the dominant volatile stable at poles or anti-stellar point                   |
| `climate_conditioned_erosion` — aeolian | atmosphere retained (Jeans λ), surface pressure > ~10 mbar, loose sediment                   |
| `long_wavelength_isostasy`              | lithosphere and interior structure from the interior model                                   |
| `lava_ocean`                            | T_surf above silicate solidus                                                                |

**Do not make generic fBm the primary geology model.** Noise is the final detail layer.
Large-scale structure comes from named operators, enabled only when consistent with the
hypothesis.

**Why this matters concretely:** the C++ `terrain()` is a fixed pipeline controlled by four
scalars and a seed — the seed changes _where_ mountains are, never _whether_ there are
mountains. **A generator with four knobs produces the same world three times.** The named
operator library is the prerequisite for meaningful hypothesis diversity, and it is the
largest single piece of rendering work in the plan.

---

## 12. Constrained AI Texture Generation

A dedicated generative model may add visual microdetail **after** the scientific pipeline has
produced constraint maps.

```text
surface hypothesis
  -> deterministic macro terrain
  -> temperature / mineral / ice / ocean / slope / elevation masks
  -> generative texture model
  -> albedo / normal / roughness / emissive candidates
  -> deterministic mask and range enforcement
  -> disk-integrated albedo/material validation
  -> content-addressed texture asset
```

**May create:** cracks, grains, small ejecta patterns, weathering variation, microdetail.

**May not create:** an ocean outside the hydrosphere mask, ice in thermodynamically excluded
regions, lava without an enabled volcanic model, or relief outside the geophysical range.

**Every asset records:** model and version · prompt and negative constraints · seed where
supported · input constraint-map hashes · output asset hash · generation and postprocessing
versions · hypothesis ID · `method: ai_generated_visual` · `affects_science: false`.

**Policy:** AI maps are **never** created in the animation loop. They are generated
server-side or offline, validated, stored in object storage/CDN, and streamed as ordinary
content-addressed tiles. **A scientific constraint/mask pass always remains active in the
shader** so a malformed asset cannot render outside its approved region. Material colour is
calibrated against the hypothesis's spectral/albedo target before publication.

**If the generative service is unavailable, a deterministic shader/procedural material
fallback is used. The planet remains fully renderable and scientifically interpretable
without AI textures.** This is an acceptance criterion, not an aspiration.

---

## 13. Deterministic Generation Pipeline

```text
1.  Ingest immutable measurements and posterior distributions.
2.  Validate units, references, uncertainty and compatibility.
3.  Derive gravity, density, irradiation, equilibrium temperature, tides.
4.  Infer an ensemble of interior/composition/climate hypotheses.
5.  Reject hypotheses violating mass-radius, energy or chemical constraints.
6.  Select a reproducible posterior member from a cryptographic seed.
7.  Compile it into a TerrainProgram with bounded parameters.
8.  Generate deterministic macro-topology and cube-sphere height tiles.
9.  Derive material, temperature, mineral, ice, ocean and geology constraint maps.
10. Optionally generate AI texture microdetail inside those masks.
11. Enforce masks/ranges; validate disk-integrated reflectance against the hypothesis.
12. Derive atmosphere scattering from the same hypothesis.
13. Register texture assets by content hash; attach feature-level provenance IDs.
```

### 13.1 Seed

```text
seed = SHA-256(
  canonical_object_id + data_snapshot_hash + inference_model_hashes
  + terrain_model_version + hypothesis_id + user_override_hash
)
```

For v1.1, `observation_state` joins this tuple so gameplay-triggered re-composition remains
deterministic.

### 13.2 What determinism actually promises

**Do not promise byte-identical GPU textures across every browser and GPU.** Floating-point
shader implementations differ. That promise cannot be kept, and making it would be a defect.

**Promise instead:**

- Byte-identical canonical inputs and terrain commands.
- Deterministic topology and named feature placement.
- Tolerance-bounded height and material outputs.
- Golden-image similarity within an explicit threshold.

For strict archival reproducibility, provide a **CPU/WASM reference generator** (§4.1) or a
pre-baked signed tile package. AI textures are generated once, stored content-addressed, and
retrieved by hash — reproducibility never depends on asking a generative service to recreate
them.

---

## 14. Three.js Rendering Architecture

### 14.1 Engine

**Three.js + TypeScript.** `WebGPURenderer` + TSL preferred; WebGL2 reduced-quality fallback.
React for the application shell, **without React Three Fiber in the simulation hot path**.
Web Workers for terrain scheduling, scientific-state preparation and deterministic
generation. Optional Rust/WebAssembly for CPU-heavy numerical kernels.

**This choice is now well-founded, which was not true when the original PRD rejected it.**
`WebGPURenderer` became production-ready at **r171** (September 2025) with zero-config
import, and Safari 26 shipped WebGPU — so WebGPU can be shipped to all users. **TSL compiles
one shader source to both WGSL and GLSL**, which largely dissolves the dual-path maintenance
cost that would otherwise have made the WebGL2 fallback expensive. r184 (March 2026)
resolved significant per-frame allocation overhead.

### 14.2 Architecture

```text
React application shell
  -> SimulationController
      -> ScientificStateStore (f64 SI units)
      -> CoordinateFrameManager
      -> PlanetLODManager
      -> TerrainComputeBackend
          -> WebGPU/TSL compute path
          -> WebGL2 worker/CPU fallback
      -> TextureAssetManager
          -> constrained AI texture assets
          -> deterministic procedural fallback
      -> AtmosphereRenderer
      -> ProvenancePickingPass
      -> Three.WebGPURenderer | Three.WebGLRenderer
```

**React policy:** React owns routing, catalog, inspector and settings. The animation loop,
terrain queues, camera state and per-frame transforms stay in imperative Three.js services
so React reconciliation never enters a hot path.

### 14.3 Scale

Three.js exposes logarithmic and reversed-depth options, but **these are not a complete
solution.** Required:

- Authoritative positions stay **float64 in metres on the CPU**.
- **Camera-relative transforms** uploaded to the GPU.
- **Nested frames**: system → planet → region → terrain tile.
- **Tile vertices local to their patch**, never planet-centre absolute.
- **Multiple render passes/frusta** for astronomical, orbital and surface scales.
- **Reversed depth where supported**; logarithmic depth is a fallback.

**Prototype this in weeks 1–2 with untextured spheres.** If the zoom jitters, nothing else
matters.

### 14.4 Terrain

Cube-sphere, six root faces · quadtree selected by projected screen-space error · shared grid
geometry per resolution · height/material from a versioned `TerrainProgram` · edge morphing
or shared edge samples to prevent cracks · generation queue with a strict frame-time budget ·
IndexedDB cache keyed by planet, hypothesis, tile, LOD and model version.

**The GPU field must be mirrored on the CPU for collision and for the reference generator.**
With four scalars this was hand-maintainable; with a named operator library it will drift.
**Generate both from one source** — shared TSL/TypeScript or codegen — before writing the
second operator, not the tenth.

### 14.5 Atmosphere and materials

Rayleigh scattering computed by wavelength and composition · aerosol/Mie parameters from an
explicitly assumed or retrieved aerosol model · precomputed atmosphere LUTs (Hillaire 2020
sky-view + aerial perspective) · **material spectra and reflectance computed from analog
mineral families before reduction to display RGB/PBR** · a separate scientific spectral
representation preserved, with sRGB only as a display transform.

Physically-scaled exposure: an M-dwarf world is genuinely dim. Do not cheat this — it is a
teaching moment.

### 14.6 Performance budget (1080p, mid GPU, surface)

| Pass                            | Budget      |
| ------------------------------- | ----------- |
| Terrain generation (amortised)  | 2.5 ms      |
| Terrain raster                  | 4.0 ms      |
| Atmosphere + aerial perspective | 3.0 ms      |
| Post (TAA, tonemap, bloom)      | 1.5 ms      |
| UI / overlays                   | 1.0 ms      |
| **Total**                       | **≤ 12 ms** |

**The browser floor is lower than native.** The 932 KB C++ binary hit 60 fps easily; a
browser will not on the same hardware. Quality tiers and RUM telemetry by GPU class are
mandatory.

### 14.7 Reference implementations, and a licensing note

[Cosmos Journeyer](https://github.com/BarthPaleologue/CosmosJourneyer) — a browser space
game with procedural systems, seamless scale and telluric surfaces explorable by ship, rover
and on foot; 5,070 commits. It is a working existence proof of this class of product on the
web.

**It is AGPL — copyleft with a network clause.** Deriving from it and serving over a network
requires releasing the entire application under AGPL. It is Babylon-based, so direct code
reuse is now less likely, but the constraint still binds if any code is lifted. Paths:
study-only clean-room, deliberate AGPL adoption (philosophically coherent for an
open-science tool), or contacting the author, who is seeking collaborators.

---

## 15. UX and the Provenance Interface

### 15.1 Screens

Catalog · System view · Approach · Entry · Surface view · **Provenance Inspector** ·
Hypothesis browser · Compare · (v1.1) Mission planner and Discovery booklet.

### 15.2 Provenance design language

| Evidence class           | Colour       | Badge | Behaviour                               |
| ------------------------ | ------------ | ----- | --------------------------------------- |
| `measured`               | Cyan         | ◆     | Solid; ± error and bibcode              |
| `derived`                | Green        | ƒ     | Formula (KaTeX) + inputs                |
| `retrieved`              | Amber        | ◈     | Model ID, posterior plot, OOD flag      |
| `constrained_prior`      | Amber        | ◇     | Prior ID, distribution, gating formulas |
| `procedural_realization` | Grey         | ▨     | Operator program, seed, hypothesis ID   |
| `assumed`                | Grey, dashed | ○     | Plain-language assumption + slider      |
| `decorative`             | Faint grey   | ·     | `affects_science: false`                |

- **Colour is never the only signal** — shape badges throughout.
- **Speculation shimmer** — features below a confidence threshold get a subtle amber rim.
- **Hypothesis cycling** — step through the admissible ensemble; watch geography change while
  measured quantities do not. **This is the most honest single interaction in the product.**
- **Assumption sandbox** — override Bond albedo, redistribution factor, surface pressure,
  cloud coverage; re-render live, flagged `user-modified`. **The one place a live LLM call is
  acceptable**, because the counterfactual is user-initiated and never cached as canonical.
- **Provenance picking pass** — click any pixel, get the feature's evidence chain.
- **Export** — JSON + BibTeX + rendered PDF of every claim behind the current view, with all
  hashes and citations.
- **Deep links** — `?planet=…&hypothesis=…&pose=…&mode=…&overrides=…`.

### 15.3 Accessibility and ethics

Full keyboard navigation; captions for cinematics; colour-blind-safe palette with shapes;
motion-reduction setting.

**Never render recognisable life forms, structures, or Earth-like imagery that could be
screenshotted as an observation.**

**Every screenshot and export carries a burned-in watermark at the framebuffer level, where
the UI cannot disable it:**

> Data-grounded artistic reconstruction. Geography is procedurally generated and is not an
> observation.

A viral misleading screenshot would cost the project its credibility permanently.

---

## 16. Engineering

**Monorepo:** pnpm workspaces + `uv`. `/apps/web`, `/apps/api`, `/packages/envspec-schema`,
`/packages/physics`, `/packages/terrain`, `/ml`, `/infra`.

**Backend:** FastAPI + Pydantic v2 · SQLAlchemy 2 + Alembic · PostgreSQL 16 · Redis · ARQ ·
Parquet on MinIO → R2/S3 · Prefect 3 · Pandera.

Schema defined once → Pydantic and TypeScript generated. **Schema drift is a build failure.**

**Ingestion:** `fetch → validate (Pandera) → normalise units (astropy.units) → cross-match →
diff against last snapshot → upsert parameters → invalidate cache → emit report`. Every
quantity is wrapped in `astropy.units.Quantity` at the boundary and stripped to floats only
at DB write — this single decision prevents the entire Earth-radii-versus-Jupiter-radii bug
class.

**The `parameter` table is append-only.** Updates insert a new row and set `superseded_by`,
giving free time-travel and letting the UI show _"this radius changed after JWST Cycle 2."_

**Testing:** `pytest` + `hypothesis` · golden-file tests on canonical JSON · golden-image
similarity within threshold · `vitest` · Playwright for the system→surface smoke path ·
**cross-GPU height agreement within documented tolerance**.

**CI gates:** ruff · eslint · mypy · tsc · tests · **provenance-policy tests (§19.1)** ·
**ML calibration gate — a model failing coverage cannot be promoted** · **mask-conformance
gate for generated textures** · bundle-size budget · Lighthouse.

**Repository hygiene, week 1.** The project root is not a git repository; sub-projects have
three and six commits with messages like "Add files via upload"; binaries and 3.8 MB of
pickles sit alongside source; there is no CI and no lockfile. One monorepo, GitHub Actions on
every push, model artifacts to DVC or object storage.

**Scientific review:** a planetary scientist reviews the claim language and the three launch
worlds. **Start this conversation in week 3, not week 15** — a good advisor needs lead time
and their feedback is worth most before the physics freezes.

---

## 17. Plan

### 17.1 First release — 16 weeks

The v1.2 addendum correctly judges that the original scope (full system, atmospheric entry,
surface FPV, trained retrieval, fifteen QA'd worlds) is not a credible 12–16 week MVP at this
scientific and performance standard. It is scoped here for **a team of four**, which makes
the 16 weeks comfortable rather than tight and leaves headroom on the terrain operators.

| Weeks     | Work                                                                                                                                                                                      | Owner                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **1–2**   | Three.js multi-scale precision spike and benchmark. Camera-relative f64, nested frames, reversed depth, WebGPU/WebGL2 decision. **Repo, CI, monorepo.** ML repo made reproducible (§4.2). | Game dev · Lead · AI-1 |
| **3–4**   | `BaseTruthSpec` / `EnvironmentSpec` / three-layer schemas. Provenance UI skeleton. LLM containment schema + permission tests.                                                             | Lead · AI-2            |
| **5–6**   | NASA Archive ingestion (`ps` spine), unit normalisation, deterministic derivations, source registry. Analog library from PDS begun.                                                       | AI-2 · Lead            |
| **7–10**  | Cube-sphere quadtree, tile cache, WebGPU terrain path + fallback, **named operator library**, shared GPU/CPU terrain source.                                                              | Game dev               |
| **11–12** | Surface-hypothesis engine, interior/class inference, PSG validation loop, hypothesis ensemble.                                                                                            | AI-2 · AI-1            |
| **13–14** | Atmosphere/material mapping, constrained AI microtextures, asset registry, provenance picking.                                                                                            | Game dev · AI-1        |
| **15–16** | Distance/scale validation, performance, accessibility, caveat language, **external scientific review**.                                                                                   | All                    |

**Three planets, not fifteen.** Suggested: **TRAPPIST-1 e** (terrestrial, HZ, JWST target),
**GJ 1214 b** (best-studied sub-Neptune, real spectra), **LHS 3844 b** (airless-rock
candidate — exercises the "no atmosphere" path and the low-data case). Together they force
transmission spectra, a thick-envelope case and an airless case through the pipeline.

**Estimate risk.** Weeks 13–14 carry the full AI texture pipeline — generative model
integration, mask enforcement, disk-integrated albedo validation and asset registration — in
two weeks. That is thin. The deterministic procedural fallback (§12) is what makes it
survivable: **if the texture pipeline slips, ship the fallback and add AI textures in v1.0.1.**
Protect the hypothesis engine and provenance UI at the texture pipeline's expense, never the
reverse.

### 17.2 Team allocation

**The critical path in months 1–2 is data engineering, schema and the precision spike — not
ML.** Two AI developers is more model capacity than the project can absorb before week 11.
AI-2 spends the first six weeks as a data engineer; that is the highest-leverage work
available and fills the one role the team otherwise lacks.

### 17.3 v1.1 — the game layer

The v1.2 addendum is a technical specification and is silent on gameplay. The game layer is
**deferred, not cancelled**, and the data model supports it from day one.

**KSP2 is the cautionary tale; KSP1 is the design model.** KSP2 entered early access in
February 2023; Take-Two shut down Intercept Games in June 2024; the last content update was
December 2023. Multiplayer, interstellar travel and colonies never shipped. **What killed it
was the simulation layer** — part-based construction with joint physics, full aerodynamics,
N-body. **What made KSP1 beloved was the loop.** The loop is cheap; the simulation bankrupts
you.

KSP1's science system fits unreasonably well, because its structure already _is_ the
structure of observational science:

| KSP1                                        | Aether v1.1                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Experiments valued by **biome × situation** | **Instrument × target × conditions**                                                                                                                    |
| **Diminishing returns on repeats**          | Posterior width shrinks with diminishing returns. Noise falls as 1/√N — **the mechanic and the mathematics are the same equation.** Derived, not tuned. |
| Transmit partial / recover full             | Quick-look reduced data now, or full calibrated `x1d` later                                                                                             |
| **Science Archive**                         | **Discovery booklet** — nearly free, a view over provenance already generated                                                                           |
| Science unlocks tech                        | Observations unlock _knowledge_, which visibly sharpens the world                                                                                       |

**Loop:** survey → target and commit observing time → observe → posteriors narrow →
hypotheses eliminated → world re-composes → visit → booklet. **Scarcity is observing time.
Progression is certainty. Score is calibration** — not how many planets you visited, but how
well your stated confidence matched reality.

**Conflicting publications are a mechanic.** The `ps` table gives this free: "two papers
disagree about this planet's mass, and the difference decides whether it can hold an
atmosphere" plays as a narrative reveal and is a real scientific lesson.

**Interstellar distance is not an obstacle — it is the best mechanic available.** TRAPPIST-1
is 40 light-years out; no chemical rocket reaches it in a thousand lifetimes, and pretending
otherwise would be the one place this project invents physics. So **make light-time real**:
you dispatch probes and data returns decades later; missions overlap across a career. It is
scientifically exact, dramatically excellent, and cheap — a scheduling system, not a physics
simulation.

**Tone.** [OUTER WATCH](https://store.steampowered.com/app/4928430/OUTER_WATCH/)'s engine of
tension is an unreliable AI narrator — the precise opposite of our promise. **Invert it:**
keep the AI companion as narrator, but source tension from **honest uncertainty rather than
deception**. It volunteers its confidence and sometimes says _"I don't know."_

> _"No atmospheric detection has been published for this planet. Everything below the cloud
> deck is my best guess."_

Scientifically exact and genuinely unsettling. We need not invent dread — "nobody has ever
seen this and nobody knows" is already eerie, and it is true.

**Tier for v1.1:** patched-conic orbital mechanics, maneuver nodes, delta-v budgets (a Kepler
solver already exists) · transfer windows · the science loop and booklet · entry corridors on
the existing adiabat and drag model · **mission configuration instead of vessel
construction** — choose a profile and instrument package from a fixed set, preserving the
interesting decision at ~5% of the cost of a parts system.

---

## 18. Week-1 Decisions

1. **WebGPU-only vs. WebGL2 dual-path.** TSL reduces the cost substantially, but the terrain
   compute path still forks. Decide the architecture now; feature-detect at runtime.
   **(Game dev)**
2. **Cosmos Journeyer licence path** — study-only clean-room, adopt AGPL, or contact the
   author. Gates how the game developer may work. **(Lead)**
3. **Schema freeze** — three layers, `model_versions` recording linelists, `hypothesis_id`
   and `observation_state` in the cache key from day one. **(Lead)**
4. **`ps` as the physics spine**; `pscomppars` for browsing only. **(AI-2)**
5. **Confirm ONNX export and `onnxruntime-web` execution** for the existing models — an
   afternoon, far better known now than in week 12. **(AI-1)**
6. **Choose the generative texture model and confirm it can be run offline/self-hosted** —
   the v1.2 pipeline assumes controllable seeds and batch generation. **(AI-1)**

---

## 19. Acceptance Criteria

### 19.1 Scientific

- An LLM attempt to write mass, radius, distance, orbital or chemical values is **rejected by
  schema and permission tests**.
- `ScienceSpec` retains `null` for missing measurements even when inference and visual
  fallbacks exist.
- Every prior/retrieval references a model or prior ID present in the approved registry.
- Accurate-distance mode retains coordinate frame, epoch and uncertainty; unknown distance is
  never silently assigned.
- No displayed value lacks source, unit, method and version.
- No procedural surface feature is labeled `measured` or `retrieved`.
- Every planet provides multiple hypotheses, or explains why only one class remains
  admissible.
- Uncertainty propagation tested against Monte Carlo reference calculations.
- Retrieval output is blocked when out of distribution.
- Synthetic spectra from selected hypotheses are compared against observations where spectra
  exist.
- A planetary scientist reviews the claim language and the three launch worlds.

### 19.2 Determinism

- Every AI texture is stored and retrieved by asset hash with model, prompt, mask and
  hypothesis provenance.
- **The complete physics/terrain/material experience works with AI generation disabled.**
- Canonical JSON is byte-identical for the same versions and overrides.
- Tile topology and named feature placement are identical for a fixed seed.
- Cross-GPU surface heights stay within a documented tolerance.
- An exported reconstruction includes all hashes and citations.

### 19.3 Rendering

- Scientific-scale mode has no hidden radius/distance exaggeration.
- Visibility-enhanced mode preserves scientific positions and exposes every multiplier.
- Generated textures obey ocean/ice/volcanism/material masks and a documented disk-integrated
  reflectance tolerance.
- No visible camera or terrain jitter from orbital scale to a two-metre observer height.
- No cracks between cube-sphere tiles at mixed LODs.
- Terrain generation is time-sliced and produces no frames above the chosen budget.
- WebGL2 fallback clearly announces reduced terrain/atmosphere fidelity.

### 19.4 Communication

Every screenshot and export includes:

> Data-grounded artistic reconstruction. Geography is procedurally generated and is not an
> observation.

---

## 20. Risks

| #   | Risk                                                                    | Severity | Mitigation                                                                                                                   |
| --- | ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Scope collapse** — this is 3–4 products in one                        | Critical | Three planets. Game layer deferred to v1.1. Phase gates are real gates.                                                      |
| R2  | **Claim overreach** → scientific backlash                               | Critical | §1.2 language policy, hypothesis ensembles, framebuffer watermark, planetary-scientist review, provenance-policy tests in CI |
| R3  | **LLM contaminates the scientific record**                              | Critical | Structural containment (§5, §6): no credential, no schema field. Tested, not trusted.                                        |
| R4  | **Scale/precision bugs** make zoom unusable                             | Critical | Weeks 1–2 spike before any art                                                                                               |
| R5  | **Terrain operator library underestimated**                             | High     | Largest rendering item; GPU and CPU mirrored from one source from operator two                                               |
| R6  | **AI texture pipeline slips** (2 weeks is thin)                         | High     | Deterministic procedural fallback is an acceptance criterion; ship without AI textures if needed                             |
| R7  | **Browser performance floor**                                           | High     | Quality tiers, RUM telemetry by GPU class, hard per-frame chunk budget                                                       |
| R8  | **AGPL contamination**                                                  | High     | §18.2, decided before anyone reads the source                                                                                |
| R9  | **Training-data realism gap** (noiseless → real spectra)                | High     | PandExo mandatory; validate against published retrievals                                                                     |
| R10 | **PSG rate limits / availability**                                      | Medium   | Cache aggressively; local deployment or precomputed grids for bulk                                                           |
| R11 | **ML backend nondeterminism** (WebGPU vs WASM)                          | Medium   | Quantize outputs at the generator boundary                                                                                   |
| R12 | **Data self-consistency** (`pscomppars` trap)                           | Medium   | §8.1                                                                                                                         |
| R13 | **Team capacity misallocation** — 2 AI devs idle-building in months 1–2 | Medium   | AI-2 owns ingestion for six weeks                                                                                            |

---

## 21. Three Rules

1. **The physics-only build must always work.** Strip every game system, every AI texture,
   every retrieval model, and an honest, well-provenanced exoplanet catalog still stands.
   That is the floor, and it ships first.
2. **Determinism within stated tolerances is not optional.** It is what makes golden-image
   testing, caching and shareable deep-links possible — and every one becomes impossible to
   retrofit.
3. **When in doubt, label it louder.** The failure mode that kills this project is not an
   ugly planet. It is a beautiful one that someone mistakes for a photograph.

---

## Appendix A — Glossary

**Bond albedo** fraction of incident stellar radiation reflected · **Equilibrium
temperature** blackbody temperature from radiative balance · **Insolation** stellar flux in
Earth units · **Jeans escape** thermal atmospheric escape · **NPE / FMPE** Neural /
Flow-Matching Posterior Estimation · **Retrieval** inferring atmospheric properties from a
spectrum · **SBC** Simulation-Based Calibration · **TSL** Three Shading Language ·
**Transmission spectrum** wavelength-dependent transit depth · **VMR** volume mixing ratio ·
**HWO** Habitable Worlds Observatory · **OOD** out-of-distribution · **PSG** Planetary
Spectrum Generator · **PDS** Planetary Data System.

## Appendix B — Naming

"Aether" is a placeholder. Check trademark availability before committing. Alternatives
without collisions in astronomy software: _Terminus_, _Lumen Worlds_, _Provenance_,
_Substellar_.

## Appendix C — Sources

**Rendering**

- Three.js WebGPURenderer — https://threejs.org/docs/pages/WebGPURenderer.html
- Three.js WebGL depth options — https://threejs.org/docs/pages/WebGLRenderer.html
- Three.js 2026 status, r171 production-ready WebGPU, TSL — https://www.utsubo.com/blog/threejs-2026-what-changed
- Cosmos Journeyer (AGPL) — https://github.com/BarthPaleologue/CosmosJourneyer

**Data**

- NASA Exoplanet Archive TAP guide — https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html
- PSCompPars self-consistency caveat — https://exoplanetarchive.ipac.caltech.edu/docs/pscp_about.html
- How PSCompPars values are calculated — https://exoplanetarchive.ipac.caltech.edu/docs/pscp_calc.html
- NASA PDS organization and discipline nodes — https://pds.nasa.gov/home/about/
- NAIF/SPICE kernel documentation — https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/req/kernel.html
- NASA Planetary Spectrum Generator API — https://psg.gsfc.nasa.gov/helpapi.php

**Forward models**

- MALBEC v1.0, CUISINES RT intercomparison (10 codes) — https://arxiv.org/html/2402.04329v1
- petitRADTRANS 3 opacities and linelist tags — https://petitradtrans.readthedocs.io/en/latest/content/available_opacities.html
- ExoMol 2024 release — https://arxiv.org/pdf/2406.06347
- Ariel retrieval challenge — https://arxiv.org/pdf/2203.00482

**ML retrieval**

- ML/DL for exoplanet characterization, review, June 2026 — https://arxiv.org/abs/2606.23766
- SBI winning Ariel Data Challenge 2023 (normalizing flows) — https://arxiv.org/pdf/2309.09337
- Flow matching + neural importance sampling vs. nested sampling — https://arxiv.org/abs/2312.08295
- Ariel Data Challenge 2024 (signal extraction, _not_ retrieval) — https://arxiv.org/abs/2505.08940

**Surface characterization**

- Surface degeneracies in single-visit HWO reflected-light observations, March 2026 — https://arxiv.org/html/2603.25694
- Towards HWO: 1D CNN retrieval of reflection spectra, Aug 2025 — https://arxiv.org/abs/2508.00076
- Mineral false positives in surface biosignature searches, 2026 — https://arxiv.org/pdf/2605.10646

**Game design references**

- Kerbal Space Program 2 status — https://en.wikipedia.org/wiki/Kerbal_Space_Program_2
- KSP science system — https://wiki.kerbalspaceprogram.com/wiki/Science
- OUTER WATCH — https://store.steampowered.com/app/4928430/OUTER_WATCH/
