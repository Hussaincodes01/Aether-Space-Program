/**
 * Deep-sky object taxonomy.
 *
 * OpenNGC's type codes, mapped to the classes worth rendering differently. The distinction
 * that matters visually is not "galaxy vs nebula" but *what kind of light this is*: an
 * emission nebula glows, a reflection nebula scatters, a dark nebula blocks — and drawing
 * all three the same way would be a lie about the physics.
 */

export enum DeepSkyType {
  Galaxy = 0,
  GalaxyPair = 1,
  GalaxyTriplet = 2,
  GalaxyGroup = 3,
  GlobularCluster = 4,
  OpenCluster = 5,
  PlanetaryNebula = 6,
  EmissionNebula = 7,
  ReflectionNebula = 8,
  DarkNebula = 9,
  HiiRegion = 10,
  SupernovaRemnant = 11,
  ClusterWithNebulosity = 12,
  StarAssociation = 13,
  Nebula = 14,
  Other = 15,
}

/** OpenNGC `Type` column to our taxonomy. Unlisted codes are deliberately dropped. */
export const OPENNGC_TYPE_MAP: Readonly<Record<string, DeepSkyType>> = {
  G: DeepSkyType.Galaxy,
  GPair: DeepSkyType.GalaxyPair,
  GTrpl: DeepSkyType.GalaxyTriplet,
  GGroup: DeepSkyType.GalaxyGroup,
  GCl: DeepSkyType.GlobularCluster,
  OCl: DeepSkyType.OpenCluster,
  PN: DeepSkyType.PlanetaryNebula,
  EmN: DeepSkyType.EmissionNebula,
  RfN: DeepSkyType.ReflectionNebula,
  DrkN: DeepSkyType.DarkNebula,
  HII: DeepSkyType.HiiRegion,
  SNR: DeepSkyType.SupernovaRemnant,
  "Cl+N": DeepSkyType.ClusterWithNebulosity,
  "*Ass": DeepSkyType.StarAssociation,
  Neb: DeepSkyType.Nebula,
};

/**
 * Codes we deliberately skip.
 *
 * `Dup` is a duplicate entry for an object already listed under another designation —
 * rendering them would double-count 651 objects. `*` and `**` are single and double stars,
 * which belong in the stellar catalogue and would otherwise appear twice at slightly
 * different positions. `NonEx` never existed.
 */
export const SKIPPED_OPENNGC_TYPES: readonly string[] = ["Dup", "*", "**", "NonEx", "Other"];

export interface DeepSkyDisplay {
  label: string;
  /** Linear sRGB. Chosen to reflect the dominant emission, not decoration. */
  colour: readonly [number, number, number];
  description: string;
}

/**
 * Display properties per class.
 *
 * Colours follow the physics where there is one: HII regions and emission nebulae are red
 * because hydrogen-alpha at 656 nm dominates; planetary nebulae skew teal from doubly
 * ionised oxygen at 500.7 nm; reflection nebulae are blue because scattering favours short
 * wavelengths, the same reason Earth's sky is blue. Galaxies are warm off-white — the
 * integrated light of billions of mostly-old stars.
 */
export const DEEP_SKY_DISPLAY: Readonly<Record<DeepSkyType, DeepSkyDisplay>> = {
  [DeepSkyType.Galaxy]: {
    label: "Galaxy",
    colour: [1.0, 0.94, 0.86],
    description: "Integrated light of billions of stars, mostly old and yellow-white.",
  },
  [DeepSkyType.GalaxyPair]: {
    label: "Galaxy pair",
    colour: [1.0, 0.92, 0.84],
    description: "Two galaxies in apparent or physical association.",
  },
  [DeepSkyType.GalaxyTriplet]: {
    label: "Galaxy triplet",
    colour: [1.0, 0.92, 0.84],
    description: "Three associated galaxies.",
  },
  [DeepSkyType.GalaxyGroup]: {
    label: "Galaxy group",
    colour: [1.0, 0.9, 0.82],
    description: "A gravitationally bound group of galaxies.",
  },
  [DeepSkyType.GlobularCluster]: {
    label: "Globular cluster",
    colour: [1.0, 0.88, 0.72],
    description: "Hundreds of thousands of ancient stars, bound and centrally concentrated.",
  },
  [DeepSkyType.OpenCluster]: {
    label: "Open cluster",
    colour: [0.82, 0.88, 1.0],
    description: "Young stars still loosely bound after forming together. Blue and hot.",
  },
  [DeepSkyType.PlanetaryNebula]: {
    label: "Planetary nebula",
    colour: [0.45, 0.95, 0.85],
    description: "A dying star's ejected envelope, glowing teal from doubly ionised oxygen.",
  },
  [DeepSkyType.EmissionNebula]: {
    label: "Emission nebula",
    colour: [1.0, 0.35, 0.38],
    description: "Hydrogen ionised by nearby hot stars, re-emitting at 656 nm.",
  },
  [DeepSkyType.ReflectionNebula]: {
    label: "Reflection nebula",
    colour: [0.5, 0.65, 1.0],
    description: "Dust scattering starlight. Blue for the same reason the sky is.",
  },
  [DeepSkyType.DarkNebula]: {
    label: "Dark nebula",
    colour: [0.25, 0.2, 0.22],
    description: "Cold dust dense enough to block the light behind it.",
  },
  [DeepSkyType.HiiRegion]: {
    label: "HII region",
    colour: [1.0, 0.32, 0.35],
    description: "Ionised hydrogen around newly formed stars. A stellar nursery.",
  },
  [DeepSkyType.SupernovaRemnant]: {
    label: "Supernova remnant",
    colour: [0.95, 0.55, 0.95],
    description: "Expanding debris from a stellar explosion.",
  },
  [DeepSkyType.ClusterWithNebulosity]: {
    label: "Cluster with nebulosity",
    colour: [0.75, 0.8, 1.0],
    description: "A young cluster still wrapped in the gas that formed it.",
  },
  [DeepSkyType.StarAssociation]: {
    label: "Stellar association",
    colour: [0.8, 0.85, 1.0],
    description: "Stars sharing an origin but no longer gravitationally bound.",
  },
  [DeepSkyType.Nebula]: {
    label: "Nebula",
    colour: [0.85, 0.6, 0.8],
    description: "Interstellar cloud of gas and dust.",
  },
  [DeepSkyType.Other]: {
    label: "Other",
    colour: [0.7, 0.7, 0.7],
    description: "Unclassified.",
  },
};

export function isGalaxyLike(type: DeepSkyType): boolean {
  return type <= DeepSkyType.GalaxyGroup;
}
