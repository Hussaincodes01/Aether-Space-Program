"""Data source adapters.

The harness treats every source as untrusted and lossy: fields arrive missing,
contradictory, or in the wrong units. Adapters do exactly one thing — map a source's
column names onto the canonical field names with correct units, uncertainties and a
provenance stamp. No gap filling here; that is physics' job, and it must be visible
as ``derived`` or ``assumed`` in the card rather than laundered into ``measured``.

``from_archive`` queries the NASA Exoplanet Archive TAP service. It needs network
access; ``from_fixture`` / ``load_cards`` cover offline and test use.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

from .models import PlanetDataCard, Provenance

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"

# archive column -> (canonical field, unit, error-column stem)
_ARCHIVE_MAP = {
    "pl_rade": ("radius_earth", "R_earth", "pl_radeerr1"),
    "pl_bmasse": ("mass_earth", "M_earth", "pl_bmasseerr1"),
    "pl_orbsmax": ("semi_major_axis_au", "AU", "pl_orbsmaxerr1"),
    "pl_orbeccen": ("eccentricity", "-", "pl_orbeccenerr1"),
    "pl_orbper": ("orbital_period_days", "d", "pl_orbpererr1"),
    "pl_insol": ("insolation_earth", "S_earth", "pl_insolerr1"),
    "pl_eqt": ("equilibrium_temp_k", "K", "pl_eqterr1"),
    "st_teff": ("stellar_teff_k", "K", "st_tefferr1"),
    "st_rad": ("stellar_radius_sun", "R_sun", "st_raderr1"),
    "st_mass": ("stellar_mass_sun", "M_sun", "st_masserr1"),
    "st_age": ("stellar_age_gyr", "Gyr", "st_ageerr1"),
    "st_met": ("stellar_metallicity", "dex", "st_meterr1"),
}

_COLUMNS = ["pl_name", "hostname"] + [c for c in _ARCHIVE_MAP] + \
           [v[2] for v in _ARCHIVE_MAP.values()]


def from_archive(planet_name: str, *, timeout: float = 45.0) -> PlanetDataCard:
    """Fetch one planet from the NASA Exoplanet Archive (pscomppars table)."""
    name = planet_name.replace("'", "''")
    adql = (f"select {','.join(_COLUMNS)} from pscomppars "
            f"where pl_name = '{name}'")
    url = f"{TAP}?{urllib.parse.urlencode({'query': adql, 'format': 'json'})}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    if not rows:
        raise LookupError(f"{planet_name!r} not found in pscomppars")
    return from_archive_row(rows[0])


def from_archive_row(row: dict) -> PlanetDataCard:
    card = PlanetDataCard(planet_id=row.get("pl_name") or "unnamed",
                          host_star=row.get("hostname") or "")
    for col, (field, unit, errcol) in _ARCHIVE_MAP.items():
        v = row.get(col)
        if v is None:
            continue
        sigma = row.get(errcol)
        card.put(field, float(v), unit=unit,
                 sigma=None if sigma is None else abs(float(sigma)),
                 provenance=Provenance.MEASURED, source="NASA Exoplanet Archive/pscomppars")
    card.notes.append(f"{card.coverage() * 100:.0f}% canonical-field coverage from the archive")
    return card


def search_archive(where: str, limit: int = 25, *, timeout: float = 60.0
                   ) -> list[PlanetDataCard]:
    """Bulk query, e.g. ``where='pl_rade < 1.8 and pl_insol between 0.3 and 1.5'``."""
    adql = (f"select top {int(limit)} {','.join(_COLUMNS)} from pscomppars where {where}")
    url = f"{TAP}?{urllib.parse.urlencode({'query': adql, 'format': 'json'})}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    return [from_archive_row(r) for r in rows]


def load_cards(path: str) -> list[PlanetDataCard]:
    """Read one card, a list of cards, or a list of raw archive rows from JSON."""
    with open(path) as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        data = [data]
    out = []
    for item in data:
        if "obs" in item or "planet_id" in item:
            out.append(PlanetDataCard.from_dict(item))
        else:
            out.append(from_archive_row(item))
    return out


def synthetic(planet_id: str, **kw) -> PlanetDataCard:
    """Hand-built card for testing and for fictional bodies.

    >>> synthetic("Test b", radius_earth=1.0, mass_earth=1.0, insolation_earth=1.0)
    """
    card = PlanetDataCard(planet_id=planet_id, host_star=kw.pop("host_star", ""))
    for k, v in kw.items():
        if v is not None:
            card.put(k, float(v), provenance=Provenance.ASSUMED, source="synthetic")
    return card
