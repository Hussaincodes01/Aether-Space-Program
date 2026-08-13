# Planetary surface maps — sources and licences

Equirectangular surface maps for the Solar System. **Two different licences apply.**

## Public domain — NASA

| File | Source |
|---|---|
| `earth.jpg` | [NASA Visible Earth](https://visibleearth.nasa.gov/) — Blue Marble, land surface with shallow-water bathymetry and topography |
| `moon.jpg` | [NASA SVS](https://svs.gsfc.nasa.gov/4720) — LROC colour, from Lunar Reconnaissance Orbiter |

NASA works are public domain. No restriction, no attribution required — though it is
included because it costs nothing.

## CC BY 4.0 — Solar System Scope

`mercury.jpg`, `venus.jpg`, `mars.jpg`, `jupiter.jpg`, `saturn.jpg`, `uranus.jpg`,
`neptune.jpg`, `sun.jpg`

> Textures by [Solar System Scope](https://www.solarsystemscope.com/textures/), based on
> NASA elevation and imagery data. Licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
> Retrieved via [Wikimedia Commons](https://commons.wikimedia.org/).

**Attribution is required** for these eight. CC BY has no share-alike clause, so it does not
propagate to the surrounding code — but the credit must travel with the files.

## Why real maps rather than procedural terrain

These bodies get their measured surfaces, not generated ones. That is the whole point of the
Solar System in this project: it is the only place with ground truth, so it is where a
generated surface would be *wrong* rather than merely unverifiable.

Procedural generation is reserved for exoplanets, where no map exists and none can. Putting
invented terrain on Mars would throw away the one comparison that makes the generator
testable.

## A trap worth recording

The first attempt pulled these from `nasa3d.arc.nasa.gov`, where `HEAD` returns **200** and a
plausible content length for every URL — but the body is an HTML landing page, not an image.
Ten files downloaded at ~346 KB each with only four distinct checksums between them. They
would have rendered as black spheres with no error anywhere.

**Verify the magic bytes, not the status code.** A JPEG starts `FF D8`.
