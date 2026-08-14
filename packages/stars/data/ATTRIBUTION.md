# Star catalogue data — licence and attribution

`stars-bright.bin` and `stars-full.bin` are derived from the **HYG stellar database**.

> HYG Database, by David Nash / Astronomy Nexus.
> <https://codeberg.org/astronexus/hyg> · <https://astronexus.com/hyg>
> Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

HYG is compiled from three catalogues:

| Source                               | Contributes                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| **Hipparcos** (ESA, 1997)            | High-accuracy parallaxes — the distances that make this a 3D map rather than a dome |
| **Yale Bright Star Catalogue**       | Naked-eye stars, Bayer letters, Flamsteed numbers, proper names                     |
| **Gliese Catalogue of Nearby Stars** | Comprehensive coverage within ~75 light years                                       |

## What this means for the repository

**These two `.bin` files are CC BY-SA 4.0, not the project licence.** ShareAlike is a
database right: anyone redistributing them, or a database derived from them, must do so
under CC BY-SA 4.0 with this attribution intact. That obligation attaches to the data
files, not to the source code that reads them.

If you fork Aether and ship these files, keep this notice.

## Why HYG and not the Digital Universe catalogue

OpenSpace renders its stars from the AMNH Digital Universe atlas, built from the same
underlying catalogues. The [Digital Universe licence](https://www.amnh.org/research/hayden-planetarium/digital-universe/download/digital-universe-license)
requires prior written permission from AMNH to distribute the atlas "as part of a software
and/or production system that will subsequently be redistributed, or for public
consumption" — which is precisely what this project is.

HYG carries the same science from the same sources with a licence that permits
redistribution. Going to the shared upstream rather than through an intermediary is both
the more permissive route and the better-provenanced one.

## Regenerating

```bash
pnpm --filter @aether/stars run build:catalog
```

Downloads the current HYG release and rebuilds both tiers. Pass a local path as the first
argument to use an already-downloaded copy.
