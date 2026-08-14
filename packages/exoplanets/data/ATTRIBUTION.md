# Exoplanet catalogue — source and attribution

`systems.bin`, `planets.bin` and `names.json` are built from the **NASA Exoplanet Archive**.

> This research has made use of the NASA Exoplanet Archive, which is operated by the
> California Institute of Technology, under contract with the National Aeronautics and Space
> Administration under the Exoplanet Exploration Program.
> <https://exoplanetarchive.ipac.caltech.edu/>

NASA Exoplanet Archive data are in the **public domain** — no licence restriction, no
share-alike obligation. The acknowledgement above is requested, not required, and is
included because it costs nothing and is the right thing to do.

## Which table

Built from `pscomppars`, the composite table, which the Archive warns "may not be internally
or physically self-consistent" because fields come from different publications.

That caveat does not apply to what this uses it for. **Position and distance come from a
single source** (Gaia astrometry) regardless of which paper supplied a planet's mass, so for
_mapping_ the composite table is both correct and considerably more complete than `ps`.

The caveat bites when combining fields — a density from a mass in one paper and a radius in
another. Any such derivation must use `ps` instead, and every value carries its method so
that stays enforceable rather than a matter of memory.

## A trap in the Archive's TAP service

`SELECT TOP n ... ORDER BY x` applies `TOP` **before** `ORDER BY`, silently returning
arbitrary rows. Asking for the six nearest systems returns HD 80653 at 109 pc instead of
Proxima Centauri at 1.30 pc. Filter with `WHERE` and sort locally.

## Regenerating

```bash
pnpm --filter @aether/exoplanets run build:catalog
```
