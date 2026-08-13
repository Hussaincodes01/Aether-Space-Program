# Deep-sky catalogue — licence and attribution

`deepsky.bin` and `deepsky-names.json` are derived from **OpenNGC**.

> OpenNGC, by Mattia Verga. <https://github.com/mattiaverga/OpenNGC>
> Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

OpenNGC merges the NGC and IC catalogues with cross-checks against the NASA/IPAC
Extragalactic Database, HyperLEDA, and SIMBAD. It exists specifically because most NGC
compilations carry licences that forbid redistribution — its own description is "a license
friendly NGC/IC objects database".

**These data files are CC BY-SA 4.0, not the project licence.** ShareAlike is a database
right: anyone redistributing them, or a database derived from them, must do so under
CC BY-SA 4.0 with this attribution intact. That obligation attaches to the data, not to the
code that reads it.

## Derived values

Distances are **not** in the source. They are computed here from OpenNGC's redshift and
parallax columns:

- **Parallax** where available — geometric, assuming no cosmology.
- **Redshift** otherwise — relativistic Doppler, then Hubble's law at
  H₀ = 67.4 km/s/Mpc (Planck 2018).
- **Neither** for ~1,500 objects, which keep distance 0 and are placed on the celestial
  sphere rather than given an invented depth.

Every extragalactic distance is proportional to 1/H₀, and H₀ is disputed at roughly the 8%
level between early-universe and late-universe measurements. `distance.ts` carries both
values and can rescale between them.

## Regenerating

```bash
pnpm --filter @aether/deepsky run build:catalog
```
