"""Canonical serialisation, content addressing and deterministic seed derivation.

Everything about a frozen universe hinges on this module. Two rules:

1. A spec's identity is the BLAKE2b digest of its *canonical* JSON form. Canonical
   means: sorted keys, no insignificant whitespace, floats quantised to a fixed
   number of significant digits so that ``0.1 + 0.2`` and ``0.30000000000000004``
   cannot fork a universe.
2. Every random draw in the pipeline is derived from the universe seed by pure
   integer mixing (SplitMix64). No global RNG state, no time, no PID, no
   dict-ordering dependence. Same spec + same seed => same terrain, forever, on
   any machine and in any language that implements SplitMix64.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

# Number of significant digits retained when canonicalising floats. 9 keeps well
# inside float64's 15-17 digits of precision while killing repr noise.
FLOAT_SIGDIGITS = 9

MASK64 = (1 << 64) - 1


# --------------------------------------------------------------------------- #
# canonical JSON
# --------------------------------------------------------------------------- #
def quantise(x: float) -> float:
    """Round to FLOAT_SIGDIGITS significant digits, deterministically."""
    if x is None:
        return x
    if not math.isfinite(x):
        raise ValueError(f"non-finite value in spec: {x!r}")
    if x == 0.0:
        return 0.0
    mag = math.floor(math.log10(abs(x)))
    return round(x, FLOAT_SIGDIGITS - 1 - mag)


def canonicalise(obj: Any) -> Any:
    """Recursively normalise a JSON-able structure for hashing."""
    if isinstance(obj, bool) or obj is None or isinstance(obj, (str, int)):
        return obj
    if isinstance(obj, float):
        q = quantise(obj)
        # Collapse -0.0 and integral floats to a single representation.
        if q == int(q) and abs(q) < 1e15:
            return int(q) if q != 0 else 0
        return q
    if isinstance(obj, dict):
        return {str(k): canonicalise(v) for k, v in sorted(obj.items(), key=lambda kv: str(kv[0]))}
    if isinstance(obj, (list, tuple)):
        return [canonicalise(v) for v in obj]
    if hasattr(obj, "to_dict"):
        return canonicalise(obj.to_dict())
    raise TypeError(f"not canonicalisable: {type(obj)}")


def canonical_json(obj: Any) -> str:
    return json.dumps(canonicalise(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def content_hash(obj: Any, *, prefix: str = "", length: int = 32) -> str:
    """Stable content address. ``prefix`` binds the hash to engine/registry versions."""
    h = hashlib.blake2b(digest_size=32)
    if prefix:
        h.update(prefix.encode("utf-8"))
        h.update(b"\x00")
    h.update(canonical_json(obj).encode("utf-8"))
    return h.hexdigest()[:length]


# --------------------------------------------------------------------------- #
# deterministic seeds
# --------------------------------------------------------------------------- #
def fnv1a64(text: str) -> int:
    """FNV-1a over UTF-8 bytes. Used to fold string identifiers into seeds."""
    h = 0xCBF29CE484222325
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x100000001B3) & MASK64
    return h


def splitmix64(state: int) -> int:
    """One SplitMix64 step. Trivially portable to C++/GLSL/JS."""
    state = (state + 0x9E3779B97F4A7C15) & MASK64
    z = state
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
    return z ^ (z >> 31)


def derive_seed(*parts: Any) -> int:
    """Fold an arbitrary tuple of identifiers into a 64-bit seed.

    ``derive_seed(universe_seed, planet_id)`` gives the planet seed;
    ``derive_seed(planet_seed, stage_index, stage_id, salt)`` gives the stage seed.
    Order matters and is part of the contract.
    """
    acc = 0x243F6A8885A308D3  # pi digits, arbitrary non-zero IV
    for p in parts:
        v = p if isinstance(p, int) else fnv1a64(str(p))
        acc = splitmix64(acc ^ (v & MASK64))
    return acc & MASK64


def seed32(seed64: int) -> int:
    """numpy's legacy seeding wants < 2**32."""
    return int(seed64 & 0xFFFFFFFF)
