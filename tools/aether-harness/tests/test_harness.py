"""Test suite. Run with: python -m tests.test_harness  (or pytest)"""

from __future__ import annotations

import json
import os
import shutil
import tempfile

import numpy as np

from aether_harness import Harness, HarnessConfig, execute, load_builtin_operators
from aether_harness.fallback import as_proposal
from aether_harness.hashing import canonical_json, derive_seed, splitmix64
from aether_harness.llm.providers import MockProvider
from aether_harness.models import PlanetDataCard, Provenance, TerrainSpec
from aether_harness.physics import derive, envelope
from aether_harness.sources import synthetic
from aether_harness.validate import validate_proposal

REG = load_builtin_operators()
FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {detail}" if detail else ""))
    if not cond:
        FAILURES.append(name)


def _tmp(seed=99, **kw):
    d = tempfile.mkdtemp()
    return Harness(HarnessConfig(universe_seed=seed, provider="mock", resolution=96,
                                 verbose=False, ledger_path=os.path.join(d, "l.json"),
                                 spec_dir=os.path.join(d, "s"), **kw)), d


EARTH = dict(radius_earth=1.0, mass_earth=1.0, insolation_earth=1.0,
             stellar_teff_k=5772, stellar_mass_sun=1.0, semi_major_axis_au=1.0,
             stellar_age_gyr=4.6)


# --------------------------------------------------------------------------- #
def test_hashing() -> None:
    print("\n[hashing / determinism]")
    check("float noise cannot fork a universe",
          canonical_json({"a": 0.1 + 0.2}) == canonical_json({"a": 0.3}))
    check("key order is irrelevant",
          canonical_json({"a": 1, "b": 2}) == canonical_json({"b": 2, "a": 1}))
    check("splitmix64 stays in 64 bits", all(0 <= splitmix64(i) < 2 ** 64 for i in range(64)))
    check("seed derivation is pure",
          derive_seed(7, "Kepler-442 b") == derive_seed(7, "Kepler-442 b"))
    check("seed derivation is order-sensitive",
          derive_seed(7, "a", "b") != derive_seed(7, "b", "a"))
    seeds = {derive_seed(1234, f"planet-{i}") for i in range(5000)}
    check("5000 planet seeds are collision-free", len(seeds) == 5000)


def test_physics_calibration() -> None:
    print("\n[physics: Solar System calibration]")
    cases = {
        "Venus": (dict(radius_earth=0.949, mass_earth=0.815, insolation_earth=1.91), True),
        "Earth": (EARTH, True),
        "Mars": (dict(radius_earth=0.532, mass_earth=0.107, insolation_earth=0.431), True),
        "Titan": (dict(radius_earth=0.404, mass_earth=0.0225, insolation_earth=0.0111), True),
        "Moon": (dict(radius_earth=0.273, mass_earth=0.0123, insolation_earth=1.0), False),
        "Mercury": (dict(radius_earth=0.383, mass_earth=0.055, insolation_earth=6.67), False),
    }
    for name, (kw, retains) in cases.items():
        env = derive(synthetic(name, **kw))
        check(f"{name} {'retains' if retains else 'loses'} its atmosphere",
              (env.shoreline_ratio < 1.0) == retains, f"ratio={env.shoreline_ratio:.3f}")

    env = derive(synthetic("Earth", **EARTH))
    check("Earth surface gravity", abs(env.surface_gravity_ms2 - 9.807) < 0.01,
          f"{env.surface_gravity_ms2:.3f} m/s^2")
    check("Earth escape velocity", abs(env.escape_velocity_kms - 11.19) < 0.05,
          f"{env.escape_velocity_kms:.2f} km/s")
    check("Earth equilibrium temperature", abs(env.equilibrium_temp_k - 278.5) < 1.0,
          f"{env.equilibrium_temp_k:.1f} K")
    check("Earth archetype", env.archetype == "temperate_terrestrial", env.archetype)
    check("relief ceiling near the observed 8.8 km",
          7000 < env.max_relief_m < 11000, f"{env.max_relief_m:.0f} m")

    lo = derive(synthetic("low-g", radius_earth=0.5, mass_earth=0.1, insolation_earth=0.5))
    check("low gravity permits taller relief", lo.max_relief_m > env.max_relief_m,
          f"{lo.max_relief_m:.0f} m vs {env.max_relief_m:.0f} m")


def test_envelope_gating() -> None:
    print("\n[envelope: physics gates the action space]")
    airless = derive(synthetic("rock", radius_earth=0.3, mass_earth=0.02,
                               insolation_earth=2.0))
    fe = envelope(airless, REG)
    check("no rivers without a fluid cycle", "erosion.stream_power" in fe.forbidden_ops)
    check("no ocean without a fluid cycle", "hydro.sea_level" in fe.forbidden_ops)
    check("cratering is mandatory on an airless body",
          "impact.crater_field" in fe.required_ops)
    check("airless bodies get a crater-density floor",
          fe.clamp_for("impact.crater_field", "density")[0] >= 0.3)

    earth = derive(synthetic("earth", **EARTH))
    fe2 = envelope(earth, REG)
    check("rivers admissible on a temperate world", "erosion.stream_power" in fe2.allowed_ops)
    check("atmosphere caps crater density",
          fe2.clamp_for("impact.crater_field", "density")[1] <= 0.5)
    check("elevation ceiling is exported to the envelope",
          fe2.global_bounds["elevation_range_m"][1] == earth.max_relief_m)

    hot = derive(synthetic("hot", radius_earth=1.5, mass_earth=5.0, insolation_earth=3000.0))
    fe3 = envelope(hot, REG)
    check("ice forbidden on a molten world", "cryo.ice_shell" in fe3.forbidden_ops)


def test_validation_repairs() -> None:
    print("\n[validation: repair vs reject]")
    env = derive(synthetic("earth", **EARTH))
    fe = envelope(env, REG)
    common = dict(planet_id="t", universe_seed=1, registry=REG, envelope=fe,
                  derived=env, archetype=env.archetype, body_radius_m=6.371e6)

    good = as_proposal(env.archetype, fe)
    check("the archetype template validates", validate_proposal(good, **common).ok)

    over = json.loads(json.dumps(good))
    over["elevation_range_m"] = 999999.0
    over["pipeline"][0]["params"]["beta"] = 99.0
    r = validate_proposal(over, **common)
    check("out-of-range numbers are repaired, not rejected", r.ok and len(r.repairs) >= 2,
          f"{len(r.repairs)} repairs")
    check("repairs are stamped in the provenance map",
          any(v == Provenance.REPAIRED.value for v in r.spec.provenance_map.values()))

    bad = json.loads(json.dumps(good))
    bad["pipeline"].append({"id": "x", "op": "erosion.does_not_exist", "params": {},
                            "rationale": "hallucinated"})
    check("hallucinated operators are hard-rejected", not validate_proposal(bad, **common).ok)

    airless = derive(synthetic("rock", radius_earth=0.3, mass_earth=0.02, insolation_earth=2.0))
    fe_a = envelope(airless, REG)
    forbidden = {**common, "envelope": fe_a, "derived": airless, "archetype": airless.archetype}
    prop = as_proposal(env.archetype, fe)          # temperate pipeline on an airless rock
    res = validate_proposal(prop, **forbidden)
    check("physically forbidden operators are rejected", not res.ok)
    check("the rejection explains itself to the model",
          "forbidden" in res.error_report() and len(res.error_report()) > 80)

    unknown = json.loads(json.dumps(good))
    unknown["pipeline"][0]["params"]["not_a_param"] = 3
    r2 = validate_proposal(unknown, **common)
    check("unknown parameters are dropped, not fatal",
          r2.ok and any("unknown parameter" in x for x in r2.repairs))

    missing = json.loads(json.dumps(good))
    missing["pipeline"] = [s for s in missing["pipeline"] if s["op"] != "hydro.sea_level"]
    check("missing archetype-required operators are rejected",
          not validate_proposal(missing, **common).ok)


def test_freeze_and_ledger() -> None:
    print("\n[ledger: a universe is immutable]")
    h, d = _tmp()
    try:
        card = synthetic("Test b", **EARTH)
        a = h.build(card)
        check("spec verifies against its own hash", a.spec.verify())

        b = h.build(card)
        check("second build is a ledger hit", b.from_ledger)
        check("same planet, byte-identical parameters",
              a.spec.content_hash == b.spec.content_hash)

        h2, d2 = _tmp(seed=99)
        c = h2.build(card)
        check("same seed reproduces the hash across harness instances",
              c.spec.content_hash == a.spec.content_hash)
        shutil.rmtree(d2, ignore_errors=True)

        h3, d3 = _tmp(seed=100)
        e = h3.build(card)
        check("a different universe seed gives different seeds",
              e.spec.planet_seed() != a.spec.planet_seed())
        shutil.rmtree(d3, ignore_errors=True)

        r = h.build(card, rebuild=True)
        check("rebuild bumps the revision", r.spec.revision == 2)
        check("rebuild records what it superseded", r.spec.supersedes == a.spec.content_hash)

        path = h.spec_path("Test b")
        with open(path) as fh:
            raw = json.load(fh)
        raw["grid"]["elevation_range_m"] = 12345.0
        with open(path, "w") as fh:
            json.dump(raw, fh)
        try:
            h.load_spec("Test b")
            tampered_caught = False
        except RuntimeError:
            tampered_caught = True
        check("hand-edited specs are detected", tampered_caught)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_execution_determinism() -> None:
    print("\n[execution]")
    h, d = _tmp()
    try:
        spec = h.build(synthetic("Exec b", **EARTH)).spec
        f1, r1 = execute(spec, REG, resolution=64)
        f2, r2 = execute(spec, REG, resolution=64)
        check("identical output on re-execution",
              np.array_equal(f1.get("elevation_m"), f2.get("elevation_m")))
        check("no stage warnings", not r1.warnings, str(r1.warnings[:2]))
        check("relief matches the spec",
              abs(r1.diagnostics["relief_m"] - spec.grid.elevation_range_m)
              / spec.grid.elevation_range_m < 0.02)
        check("elevation is finite everywhere", np.all(np.isfinite(f1.get("elevation_m"))))

        z = f1.get("elevation_m")
        check("longitude wraps seamlessly",
              float(np.mean(np.abs(z[:, 0] - z[:, -1])))
              < 3.0 * float(np.mean(np.abs(np.diff(z, axis=1)))))
        check("ocean fraction tracks the requested quantile",
              abs(r1.diagnostics["ocean_fraction"] - spec.grid.sea_level_quantile) < 0.06,
              f"{r1.diagnostics['ocean_fraction']:.3f} vs {spec.grid.sea_level_quantile}")
        check("a real drainage network formed",
              r1.diagnostics.get("drainage_density", 0) > 0.02)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_every_operator_runs() -> None:
    print("\n[operators: all registered algorithms execute]")
    from aether_harness.fields import FieldSet
    from aether_harness.registry import Ctx
    ok = 0
    for op in REG.all():
        fs = FieldSet(nlat=48)
        fs.set("elevation", np.random.default_rng(0).normal(size=fs.shape) * 0.3)
        for ch in ("uplift", "erodibility", "runoff", "ice", "sediment"):
            fs.set(ch, np.abs(np.random.default_rng(1).normal(size=fs.shape)) * 0.5)
        ctx = Ctx(seed=42, rng=np.random.default_rng(42), stage_id=op.id)
        try:
            op.apply(fs, op.defaults(), ctx)
            z = fs.get("elevation")
            assert np.all(np.isfinite(z)), "non-finite"
            assert np.ptp(z) < 1e6, f"runaway span {np.ptp(z):.3g}"
            ok += 1
        except Exception as exc:
            check(f"{op.id} runs at defaults", False, f"{type(exc).__name__}: {exc}")
    check(f"all {len(REG.all())} operators run at their defaults", ok == len(REG.all()),
          f"{ok}/{len(REG.all())}")


def test_registry_contract() -> None:
    print("\n[registry contract]")
    check("registry version is stable", REG.version == load_builtin_operators().version)
    schema = REG.json_schema(allowed=["noise.spectral_fbm"])
    check("schema restricts the op enum",
          schema["properties"]["pipeline"]["items"]["properties"]["op"]["enum"]
          == ["noise.spectral_fbm"])
    check("every operator declares a summary and params",
          all(o.summary and (o.params or o.category == "field_utility") for o in REG.all()))
    check("every parameter documents itself",
          all(p.doc or p.name in ("amplitude", "octaves") for o in REG.all() for p in o.params))
    bad = [f"{o.id}.{p.name}" for o in REG.all() for p in o.params
           if p.kind in ("float", "int") and p.lo is not None
           and not (p.lo <= float(p.default) <= p.hi)]
    check("every default lies inside its declared range", not bad, str(bad[:3]))


def test_fallback_path() -> None:
    print("\n[fallback: a universe is never lost]")
    from aether_harness.llm.providers import ProviderError
    from aether_harness.llm.structured import author_spec

    class Broken(MockProvider):
        name = "broken"

        def complete_json(self, *a, **kw):
            raise ProviderError("simulated outage")

    env = derive(synthetic("x", **EARTH))
    fe = envelope(env, REG)
    out = author_spec(card=synthetic("x", **EARTH), env=env, envelope=fe, registry=REG,
                      provider=Broken(), planet_id="x", universe_seed=1,
                      body_radius_m=6.371e6, max_attempts=2, verbose=False)
    check("a provider outage still yields a spec", out.spec is not None)
    check("the fallback is flagged on the trace", out.trace.fallback_used)

    class Garbage(MockProvider):
        name = "garbage"

        def complete_json(self, *a, **kw):
            from aether_harness.llm.providers import Completion
            return Completion({"pipeline": [{"id": "z", "op": "nope", "params": {},
                                             "rationale": ""}]})

    out2 = author_spec(card=synthetic("y", **EARTH), env=env, envelope=fe, registry=REG,
                       provider=Garbage(), planet_id="y", universe_seed=1,
                       body_radius_m=6.371e6, max_attempts=2, verbose=False)
    check("invalid proposals retry then fall back",
          out2.trace.fallback_used and out2.trace.attempts == 2)

def test_archetype_round_trip() -> None:
    """Every archetype must be reachable from a plausible body AND its template must
    validate against that body's own envelope. This is the contract that guarantees
    the fallback can never produce an inadmissible universe."""
    print("\n[archetypes: classification and template round-trip]")
    probes = {
        "temperate_terrestrial": EARTH,
        "ocean_world": dict(radius_earth=1.4, mass_earth=2.0, insolation_earth=0.9),
        "ice_world": dict(radius_earth=0.404, mass_earth=0.0225, insolation_earth=0.011),
        "airless_rock": dict(radius_earth=0.273, mass_earth=0.0123, insolation_earth=1.0),
        "cratered_relict": dict(radius_earth=0.532, mass_earth=0.107, insolation_earth=0.431),
        "lava_world": dict(radius_earth=1.88, mass_earth=8.0, insolation_earth=2500.0),
        "venusian_greenhouse": dict(radius_earth=0.949, mass_earth=0.815,
                                    insolation_earth=1.91),
        "high_gravity_terrestrial": dict(radius_earth=1.5, mass_earth=6.0,
                                         insolation_earth=1.0),
        "volatile_envelope": dict(radius_earth=2.5, mass_earth=6.0, insolation_earth=1.0),
    }
    for expected, kw in probes.items():
        env = derive(synthetic(expected, **kw))
        check(f"{expected} is reachable", env.archetype == expected,
              f"classified as {env.archetype}")
        fe = envelope(env, REG)
        res = validate_proposal(as_proposal(env.archetype, fe), planet_id="p",
                                universe_seed=1, registry=REG, envelope=fe, derived=env,
                                archetype=env.archetype, body_radius_m=6.371e6)
        check(f"{env.archetype} template validates against its own envelope", res.ok,
              str(res.hard_errors[:2]))


def main() -> int:
    print("=" * 70)
    print("aether-harness test suite")
    print("=" * 70)
    for fn in (test_hashing, test_physics_calibration, test_envelope_gating,
               test_validation_repairs, test_freeze_and_ledger,
               test_execution_determinism, test_every_operator_runs,
               test_registry_contract, test_fallback_path, test_archetype_round_trip):
        fn()
    print("\n" + "=" * 70)
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {FAILURES}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
