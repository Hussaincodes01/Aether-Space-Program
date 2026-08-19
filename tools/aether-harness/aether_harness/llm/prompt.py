"""Prompt construction.

The prompt is generated from the same declarations the validator enforces, so the
two can never drift. If an operator's bound changes, the catalog the model sees and
the check the validator applies change together, and the registry version hash
changes with them.

Structure of the user message, in order of importance to the model:

  1. the identity and the task in one line
  2. OBSERVED — what the sources measured, with uncertainty and provenance
  3. DERIVED — what physics already settled (the model must not recompute these)
  4. ADMISSIBLE — required/forbidden operators and narrowed parameter bounds
  5. CATALOG — only the operators it is allowed to use
  6. EXEMPLAR — a valid worked pipeline for this archetype
  7. the output contract

Putting the constraints before the catalog matters: the model reads the catalog
already knowing what it may not do, which measurably reduces forbidden-operator
proposals.
"""

from __future__ import annotations

from ..fallback import render_exemplar
from ..hashing import content_hash
from ..models import CANONICAL_OBS, DerivedEnvironment, FeasibilityEnvelope, PlanetDataCard
from ..registry import Registry

SYSTEM = """\
You are the terrain-authoring stage of a planetary generation engine. You do not \
write code and you do not render anything. You select algorithms from a fixed \
catalog and choose their parameters, emitting one JSON object that becomes the \
permanent, immutable definition of one planet's surface in a persistent universe.

How to think about the job:

* You are a geomorphologist, not a texture artist. Every stage must be justified by \
a physical process that plausibly operated on THIS body given its gravity, \
temperature, insolation and age. A parameter you cannot justify should be left at \
its default.
* Order is causality. The pipeline runs top to bottom and each stage sees the \
result of the previous ones. Structure before process: establish the base surface \
and the driver fields, then tectonics, then erosion, then late resurfacing, then \
detail. Cratering placed after volcanic resurfacing means the craters survive; \
placed before, they get buried. Choose deliberately and say which you meant.
* Prefer few strong stages to many weak ones. Eight well-motivated stages beat \
fourteen that each nudge the field slightly.
* Physics has already been computed for you. Never contradict a DERIVED value and \
never restate it as if you calculated it. Your rationales should cite them.
* The bounds are hard. A value outside an ENVELOPE-NARROWED range will be clamped \
and the clamp will be recorded against you; a forbidden operator invalidates the \
whole proposal.

Return only the JSON object. No prose outside it.\
"""


def _fmt_obs(card: PlanetDataCard) -> str:
    rows = []
    for key in CANONICAL_OBS:
        q = card.q(key)
        if q.value is None:
            continue
        s = f"  {key:<24} {q.value:>12.4g} {q.unit:<10}"
        if q.sigma:
            s += f" +/- {q.sigma:<10.3g}"
        s += f" [{q.provenance.value}"
        if q.source:
            s += f" via {q.source}"
        s += "]"
        rows.append(s)
    missing = [k for k in CANONICAL_OBS if card.q(k).value is None]
    if missing:
        rows.append(f"  (not constrained by any source: {', '.join(missing)})")
    return "\n".join(rows)


def _fmt_derived(env: DerivedEnvironment) -> str:
    d = env
    rows = [
        f"  surface_gravity          {d.surface_gravity_ms2:>10.3f} m/s^2   "
        f"({d.surface_gravity_ms2 / 9.80665:.2f} g)",
        f"  escape_velocity          {d.escape_velocity_kms:>10.3f} km/s",
        f"  bulk_density             {d.bulk_density_kgm3:>10.0f} kg/m^3",
        f"  equilibrium_temperature  {d.equilibrium_temp_k:>10.1f} K",
        f"  insolation               {d.insolation_earth:>10.4g} S_earth",
        f"  cosmic_shoreline_ratio   {d.shoreline_ratio:>10.4g}   "
        f"({'atmosphere unlikely' if d.shoreline_ratio >= 1 else 'atmosphere retainable'})",
        f"  tidal_lock_probability   {d.tidal_lock_probability:>10.3f}",
        f"  tidal_heating            {d.tidal_heating_wm2:>10.4g} W/m^2",
        f"  max_relief (strength)    {d.max_relief_m:>10.0f} m   "
        f"<- hard ceiling on elevation_range_m",
        f"  archetype                {d.archetype} (confidence {d.archetype_confidence})",
        f"  active_processes         {', '.join(d.capabilities)}",
    ]
    if d.notes:
        rows.append("  assumptions made in deriving the above:")
        rows += [f"    - {n}" for n in d.notes]
    return "\n".join(rows)


def _fmt_envelope(fe: FeasibilityEnvelope) -> str:
    rows = []
    if fe.required_ops:
        rows.append(f"  MUST include: {', '.join(fe.required_ops)}")
    if fe.forbidden_ops:
        rows.append(f"  MUST NOT include: {', '.join(fe.forbidden_ops)}")
    lo, hi = fe.global_bounds["elevation_range_m"]
    rows.append(f"  elevation_range_m must lie in [{lo:.0f}, {hi:.0f}] metres")
    if "hydro.sea_level" in fe.allowed_ops:
        q = fe.global_bounds["sea_level_quantile"]
        rows.append(f"  sea_level_quantile in [{q[0]}, {q[1]}], or null for no hydrosphere")
    else:
        rows.append("  sea_level_quantile must be null (no admissible hydrosphere)")
    rows.append(f"  total pipeline cost budget: {fe.max_cost} "
                f"(sum of the per-operator costs shown in the catalog)")
    rows.append(f"  maximum stages: {fe.max_stages}")
    if fe.param_clamps:
        rows.append("  parameter ranges narrowed by physics (also flagged in the catalog):")
        for k, (a, b) in sorted(fe.param_clamps.items()):
            rows.append(f"    {k}: [{a:g}, {b:g}]")
    rows.append("  why these constraints:")
    rows += [f"    - {r}" for r in fe.reasons]
    return "\n".join(rows)


def build_user_message(card: PlanetDataCard, env: DerivedEnvironment,
                       fe: FeasibilityEnvelope, registry: Registry,
                       extra_guidance: str = "") -> str:
    parts = [
        f"Author the surface of {card.planet_id}"
        + (f" (host star {card.host_star})" if card.host_star else "")
        + f". Source coverage: {card.coverage() * 100:.0f}% of canonical fields.",
        "",
        "=== OBSERVED (from data sources) ===",
        _fmt_obs(card) or "  (nothing measured; everything below is prior-driven)",
        "",
        "=== DERIVED (already computed; do not recompute or contradict) ===",
        _fmt_derived(env),
        "",
        "=== ADMISSIBLE ACTION SPACE (hard constraints) ===",
        _fmt_envelope(fe),
        "",
        "=== OPERATOR CATALOG (the only operators you may use) ===",
        registry.render_catalog(only=fe.allowed_ops, clamps=fe.param_clamps),
        "",
        "=== VALID EXEMPLAR for this archetype (beat it, don't copy it) ===",
        render_exemplar(env.archetype, fe),
        "",
        "=== OUTPUT ===",
        "One JSON object with: elevation_range_m, sea_level_quantile, notes, pipeline[].",
        "Each pipeline entry needs id, op, params, rationale. Omit a parameter to accept",
        "its default. 'rationale' must name the derived quantity that motivates the stage;",
        "'notes' is one paragraph telling this planet's geological history in order.",
    ]
    if extra_guidance:
        parts += ["", "=== ADDITIONAL DIRECTION FROM THE OPERATOR ===", extra_guidance]
    return "\n".join(parts)


def prompt_hash(system: str, user: str, schema: dict) -> str:
    """Identifies the exact question asked, for cache keys and audit."""
    return content_hash({"system": system, "user": user, "schema": schema}, length=16)
