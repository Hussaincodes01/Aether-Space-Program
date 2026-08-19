"""Command line interface.

    aether build   --planet "Kepler-442 b" --provider anthropic
    aether build   --cards examples/planets.json --offline
    aether render  --spec specs/Kepler-442_b.json --res 384 --preview
    aether inspect --spec specs/Kepler-442_b.json
    aether catalog --archetype temperate_terrestrial
    aether audit
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import __version__
from .harness import Harness, HarnessConfig
from .llm.providers import PROVIDERS
from .models import PlanetDataCard, TerrainSpec
from .physics import derive, envelope
from .registry import load_builtin_operators
from .runner import execute, export, preview_png
from .sources import from_archive, load_cards, search_archive, synthetic


def _common(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--universe-seed", type=int, default=20260819)
    ap.add_argument("--ledger", default="universe.ledger.json")
    ap.add_argument("--spec-dir", default="specs")
    ap.add_argument("--quiet", action="store_true")


def _cfg(a) -> HarnessConfig:
    return HarnessConfig(
        universe_seed=a.universe_seed,
        provider="mock" if getattr(a, "offline", False) else getattr(a, "provider", "mock"),
        model=getattr(a, "model", None), base_url=getattr(a, "base_url", None),
        api_key_env=getattr(a, "api_key_env", None),
        temperature=getattr(a, "temperature", 0.0),
        max_attempts=getattr(a, "max_attempts", 3),
        resolution=getattr(a, "res", 192),
        ledger_path=a.ledger, spec_dir=a.spec_dir, verbose=not a.quiet)


def cmd_build(a) -> int:
    h = Harness(_cfg(a))
    cards: list[PlanetDataCard] = []
    if a.cards:
        cards += load_cards(a.cards)
    for name in a.planet or []:
        cards.append(synthetic(name) if a.offline_names else from_archive(name))
    if a.query:
        cards += search_archive(a.query, limit=a.limit)
    if not cards:
        print("nothing to build: pass --planet, --cards or --query", file=sys.stderr)
        return 2

    built = 0
    for card in cards:
        try:
            res = h.build(card, rebuild=a.rebuild, extra_guidance=a.guidance or "")
            built += 1
            if a.render:
                fs, rep = execute(res.spec, h.registry, resolution=a.res)
                files = export(fs, res.spec, rep, a.outdir)
                if a.preview:
                    pv = preview_png(fs, os.path.join(
                        a.outdir, f"{res.spec.planet_id.replace(' ', '_')}_preview.png"))
                    if pv:
                        files.append(pv)
                print("        " + "\n        ".join(files))
        except Exception as exc:
            print(f"[error] {card.planet_id}: {type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"\n{built}/{len(cards)} planets frozen into {a.ledger}")
    return 0 if built else 1


def cmd_render(a) -> int:
    reg = load_builtin_operators()
    with open(a.spec) as fh:
        spec = TerrainSpec.from_dict(json.load(fh))
    if not spec.verify():
        print(f"[warn] {a.spec} does not match its content hash", file=sys.stderr)
    fs, rep = execute(spec, reg, resolution=a.res)
    files = export(fs, spec, rep, a.outdir)
    if a.preview:
        pv = preview_png(fs, os.path.join(a.outdir,
                                          f"{spec.planet_id.replace(' ', '_')}_preview.png"))
        if pv:
            files.append(pv)
    print(json.dumps(rep.to_dict(), indent=2))
    print("\n".join(files))
    return 0


def cmd_inspect(a) -> int:
    reg = load_builtin_operators()
    with open(a.spec) as fh:
        spec = TerrainSpec.from_dict(json.load(fh))
    ok = spec.verify()
    print(f"{spec.planet_id}  [{spec.archetype}]  rev {spec.revision}")
    print(f"  hash        {spec.content_hash} {'VERIFIED' if ok else 'MISMATCH'}")
    print(f"  frozen      {spec.frozen_at}  seed {spec.universe_seed} "
          f"-> planet seed {spec.planet_seed()}")
    print(f"  authored by {spec.llm.provider}/{spec.llm.model} "
          f"attempts={spec.llm.attempts} fallback={spec.llm.fallback_used}")
    print(f"  registry    {spec.llm.registry_version} (current {reg.version})")
    print(f"  relief      {spec.grid.elevation_range_m:.0f} m   "
          f"sea level q={spec.grid.sea_level_quantile}")
    print(f"  pipeline    {len(spec.pipeline)} stages, cost "
          f"{sum(reg.get(s.op).cost for s in spec.pipeline if reg.get(s.op))}")
    for i, st in enumerate(spec.pipeline):
        print(f"    {i}. {st.id:14s} {st.op}")
        if st.rationale:
            print(f"       {st.rationale}")
        if a.params:
            for k, v in st.params.items():
                print(f"         {k} = {v}")
    if spec.llm.repairs:
        print("  repairs applied by the validator:")
        for r in spec.llm.repairs:
            print(f"    - {r}")
    return 0 if ok else 1


def cmd_catalog(a) -> int:
    reg = load_builtin_operators()
    if a.archetype:
        card = synthetic("probe", radius_earth=1.0, mass_earth=1.0, insolation_earth=1.0)
        env = derive(card)
        env.archetype = a.archetype
        fe = envelope(env, reg)
        print(reg.render_catalog(only=fe.allowed_ops, clamps=fe.param_clamps))
    else:
        print(f"registry {reg.version}: {len(reg.ids())} operators")
        print(reg.render_catalog())
    return 0


def cmd_audit(a) -> int:
    h = Harness(_cfg(a))
    rep = h.audit()
    print(json.dumps(rep, indent=2))
    return 0 if not (rep["missing"] or rep["hash_mismatch"]) else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser("aether", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", action="version", version=f"aether-harness {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="author and freeze planet specs")
    _common(b)
    b.add_argument("--planet", action="append", help="planet name (repeatable)")
    b.add_argument("--cards", help="JSON file of data cards or archive rows")
    b.add_argument("--query", help="ADQL where-clause against pscomppars")
    b.add_argument("--limit", type=int, default=25)
    b.add_argument("--provider", default="anthropic", choices=sorted(PROVIDERS))
    b.add_argument("--model")
    b.add_argument("--base-url")
    b.add_argument("--api-key-env")
    b.add_argument("--temperature", type=float, default=0.0)
    b.add_argument("--max-attempts", type=int, default=3)
    b.add_argument("--offline", action="store_true",
                   help="no LLM: use the deterministic archetype templates")
    b.add_argument("--offline-names", action="store_true",
                   help="do not query the archive for --planet names")
    b.add_argument("--rebuild", action="store_true", help="supersede an existing frozen spec")
    b.add_argument("--guidance", help="extra art/science direction appended to the prompt")
    b.add_argument("--render", action="store_true")
    b.add_argument("--preview", action="store_true")
    b.add_argument("--res", type=int, default=192)
    b.add_argument("--outdir", default="out")
    b.set_defaults(func=cmd_build)

    r = sub.add_parser("render", help="execute a frozen spec")
    r.add_argument("--spec", required=True)
    r.add_argument("--res", type=int, default=None)
    r.add_argument("--outdir", default="out")
    r.add_argument("--preview", action="store_true")
    r.set_defaults(func=cmd_render)

    i = sub.add_parser("inspect", help="print a spec's provenance and pipeline")
    i.add_argument("--spec", required=True)
    i.add_argument("--params", action="store_true")
    i.set_defaults(func=cmd_inspect)

    c = sub.add_parser("catalog", help="print the operator catalog as the LLM sees it")
    c.add_argument("--archetype", help="filter to one archetype's admissible operators")
    c.set_defaults(func=cmd_catalog)

    au = sub.add_parser("audit", help="verify every ledger entry against disk")
    _common(au)
    au.set_defaults(func=cmd_audit)

    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
