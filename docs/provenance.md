# The data and provenance model

Aether's product claim is that every number on screen can name where it came from. This
document describes the machinery that makes that structurally true rather than aspirational.

---

## The atom: `ScientificQuantity`

No bare scalar exists anywhere in the science layers. Every number carries:

| Field         | Why it exists                                                            |
| ------------- | ------------------------------------------------------------------------ |
| `valueSI`     | The value in SI base units — **or `null`**, which is a first-class state |
| `unit`        | Enforced, not decorative. See "Units are checked" below                  |
| `uncertainty` | Asymmetric where the source published it asymmetrically                  |
| `method`      | `measured` / `derived` / `retrieved` / `prior`                           |
| `sourceId`    | Must resolve in the source registry, or ingestion fails                  |
| `confidence`  | 0..1, coarse on purpose                                                  |
| `retrievedAt` | When the value was transcribed, not when the paper was published         |

### `null` is a value

A quantity nobody has measured is written `valueSI: null` and stays that way all the way to
the UI, where it renders as **UNKNOWN**. It is never replaced by a population median in the
science layer — that is what the inference layer exists for, and the distinction between
"we do not know" and "a model guessed" is the difference between an honest visualisation and
a confident one.

---

## Three layers, three permission levels

```
ScienceSpec     ingestion + allowlisted physics    affects science: yes
InferenceSpec   versioned models + prior resolver  affects science: yes, with uncertainty
VisualSpec      composer / LLM / texture pipeline  affects science: NO
```

The separation is enforced twice over: by types (`LayerWriter<C>`, and the LLM service is
constructed with a `visual`-only capability), and at the service boundary by
`packages/schema/src/llm-boundary.ts`, which validates against a strict Zod schema and then
deep-scans for forbidden fields.

That second scan normalises field names before matching. This is not a detail:
`/\bradius\b/` does **not** match `planet_radius`, because underscore is a word character in
JavaScript regular expressions. The scan was silently dead for a period, and the only reason
nothing got through was that the strict schema happened to catch it. Defence in depth only
works if each layer actually works.

---

## Units are checked

`packages/schema/src/dimension.ts` performs two independent checks, and neither subsumes the
other:

1. **Dimension.** Is the stored unit the same _kind_ of quantity as the one requested? An
   unrecognised unit is incompatible with everything, including itself — "we have never seen
   this unit" and "this unit is fine" are different statements, and only one is safe to act
   on. Angles are kept distinct from plain ratios despite both being formally dimensionless,
   or an orbital inclination could satisfy a request for a Bond albedo.

2. **Domain.** Is the number physically admissible? Negative radius, temperature below
   absolute zero, albedo above one. Field-level rules normalise names the same way the LLM
   scanner does, so `bondAlbedo` and `bond_albedo` cannot diverge.

The resolver previously accepted a `unit` on every request and never looked at it, which is
worse than not asking: every call site read as though a contract were enforced while nothing
was.

---

## The resolution chain

`resolveMissingValue()` tries strategies in strict precedence order. The first that can
answer, answers — and every answer passes the checks above before it is returned.

1. `published_measurement` — a measured value in `ScienceSpec`
2. `deterministic_derivation` — an allowlisted formula's output
3. `calibrated_retrieval_posterior` — a retrieval posterior, **if not out-of-distribution**
4. `population_prior` — a cited conditional prior, with full uncertainty
5. `render_placeholder` — render-only, `affectsPhysics: false`

If none can answer, the result is `unresolved` and the renderer must show an explicit
unknown marker rather than any number.

### Out-of-distribution posteriors are refused, not downgraded

A retrieval whose inputs fell outside its training domain is not a weaker measurement. It is
a model being asked a question it was never fitted to answer, and the calibration that makes
a posterior meaningful does not survive extrapolation. It may still be usable as a _prior_,
which is what the next strategy down decides.

### Rejections are reported

A candidate the guard refuses is recorded on the `unresolved` result with the reason. "We
had a value and threw it away because it was in the wrong unit" is a bug report upstream,
and silently returning `unresolved` would hide it.

---

## Derivations know what they assume

Every physics function returns a `DerivedValue` carrying `formulaId`, `inputsUsed`,
`assumptions`, and a confidence that is the **minimum** over inputs — never an average.
Averaging would let one well-measured value launder a badly-constrained one.

An assumed input caps confidence at 0.5. This is what makes a world built on assumptions
_look_ uncertain rather than merely being uncertain in a tooltip.

Equilibrium temperature is the worked example. It depends on Bond albedo and heat
redistribution, and almost nobody has measured either. Both are exposed as explicit
assumptions rather than buried constants, because changing them changes the answer by tens of
kelvin and a user is entitled to see that.

---

## Badges: the vocabulary the user sees

| Badge           | Meaning                                                     |
| --------------- | ----------------------------------------------------------- |
| **MEASURED**    | Observed and published. Traceable to a paper or archive row |
| **DERIVED**     | A named formula, with its assumptions listed                |
| **INFERRED**    | A model's distribution. The interval is the honest part     |
| **HYPOTHESIS**  | One admissible possibility among many. Terrain lives here   |
| **PLACEHOLDER** | Drawn so the scene renders; cannot affect any calculation   |
| **UNKNOWN**     | Nobody knows, including us                                  |

`UNKNOWN` is styled loudest of the six, because the standing temptation is to show something
instead of nothing.

Unknown rows are **rendered, not dropped**. A user who deselects Gaia and watches the planet
radius turn into UNKNOWN — with a note saying which mission would restore it — has learned
something true about how exoplanet science works. A user who watches the row silently vanish
has learned nothing and probably did not notice.
