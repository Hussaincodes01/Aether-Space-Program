"""Incremental catalogue build against a rate-limited free tier.

A 32-body build does not fit OpenCode Zen's free quota in one pass: the reasoning model
spends around 8,000 completion tokens per planet before it writes a character of answer, and
the endpoint starts returning `429 FreeUsageLimitError` well before the catalogue is done.

Re-running the plain CLI does not converge, because of a subtlety worth stating. When a
provider call fails the harness falls back to a deterministic archetype template and
*freezes that*, exactly as designed -- a universe is never lost. But a frozen spec is a
ledger hit, so the next run skips it. Left alone, the first rate-limited pass would
permanently pin every remaining body to a template and the LLM would never see them again.

So this driver treats a fallback entry as unfinished. Each pass:

  * reads the ledger and selects bodies that are either absent or `fallback_used`
  * builds them one at a time, passing --rebuild for the ones already frozen
  * stops the moment the quota is refused rather than burning the rest of the list on
    fallbacks, since every one of those would need superseding later anyway

Run it repeatedly. It resumes, and it is finished when it reports nothing left to do.

    python build_incremental.py --cards ../../packages/solar-system/solar-system-cards.json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Substrings that mean "the quota is gone", not "this planet failed".
QUOTA_MARKERS = ("FreeUsageLimitError", "429", "Rate limit exceeded")


def ledger_state(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("planets", {})
    except (json.JSONDecodeError, OSError):
        return {}


def pending(cards: list[dict], planets: dict[str, dict]) -> list[tuple[dict, bool]]:
    """Cards still needing an LLM spec, paired with whether they need --rebuild."""
    out: list[tuple[dict, bool]] = []
    for card in cards:
        entry = planets.get(card["planet_id"])
        if entry is None:
            out.append((card, False))
        elif entry.get("fallback_used"):
            # Frozen, but from the template rather than the model. Supersede it.
            out.append((card, True))
    return out


def build_one(card: dict, rebuild: bool, args: argparse.Namespace) -> tuple[bool, str]:
    """Returns (llm_authored, output). Never raises on a provider failure."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8", dir=HERE
    ) as fh:
        json.dump([card], fh)
        one = Path(fh.name)

    cmd = [
        sys.executable, "-m", "aether_harness.cli", "build",
        "--cards", str(one),
        "--provider", args.provider,
        "--model", args.model,
        "--ledger", args.ledger,
        "--outdir", args.outdir,
    ]
    if rebuild:
        cmd.append("--rebuild")

    try:
        proc = subprocess.run(
            cmd, cwd=HERE, capture_output=True, text=True, timeout=args.timeout
        )
        output = (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired:
        output = "timed out"
    finally:
        one.unlink(missing_ok=True)

    # "(FALLBACK)" on the frozen line is the harness saying the model did not author this.
    return ("FALLBACK" not in output, output)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cards", required=True)
    ap.add_argument("--ledger", default="solar.ledger.json")
    ap.add_argument("--outdir", default="solar-out")
    ap.add_argument("--provider", default="opencode")
    ap.add_argument("--model", default="deepseek-v4-flash-free")
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--limit", type=int, default=0, help="stop after N successes")
    args = ap.parse_args()

    if not os.environ.get("OPENCODE_API_KEY"):
        staged = HERE / ".opencode.key"
        if staged.exists():
            os.environ["OPENCODE_API_KEY"] = staged.read_text(encoding="utf-8").strip()
        else:
            print("OPENCODE_API_KEY is not set and .opencode.key is absent")
            return 2

    cards = json.loads(Path(args.cards).read_text(encoding="utf-8"))
    planets = ledger_state(HERE / args.ledger)
    todo = pending(cards, planets)

    done = len(cards) - len(todo)
    print(f"{len(cards)} bodies; {done} already LLM-authored, {len(todo)} to do\n")
    if not todo:
        print("nothing left to do -- the catalogue is complete")
        return 0

    authored = 0
    for card, rebuild in todo:
        name = card["planet_id"]
        ok, output = build_one(card, rebuild, args)

        if any(m in output for m in QUOTA_MARKERS):
            print(f"  {name:<12} quota exhausted -- stopping here")
            print(
                f"\n{authored} authored this pass, "
                f"{len(todo) - authored} still to do. Re-run when the quota resets."
            )
            return 3

        if ok:
            authored += 1
            hashes = [ln for ln in output.splitlines() if "[frozen]" in ln]
            print(f"  {name:<12} LLM  {hashes[0].split('->')[-1].strip() if hashes else ''}")
        else:
            reason = next(
                (ln.strip() for ln in output.splitlines() if "provider error" in ln),
                "fell back",
            )
            print(f"  {name:<12} FALLBACK  {reason[:90]}")

        if args.limit and authored >= args.limit:
            print(f"\nstopping at --limit {args.limit}")
            break

    remaining = len(todo) - authored
    print(f"\n{authored} authored this pass, {remaining} still to do")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
