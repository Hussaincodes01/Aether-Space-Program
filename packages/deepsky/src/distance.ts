/**
 * Distances to deep-sky objects.
 *
 * Three regimes, and which one applies is itself a provenance question:
 *
 *   - **Parallax** for the handful of objects close enough. Geometric, essentially exact.
 *   - **Redshift** for galaxies. Depends on the Hubble constant, which is *disputed*.
 *   - **Unknown** for most nebulae and clusters, where OpenNGC carries neither.
 *
 * The middle case deserves attention. Every extragalactic distance here is proportional to
 * 1/H0, and H0 is the subject of an unresolved ~8% disagreement between early-universe and
 * late-universe measurements — the Hubble tension. So the depth of this map is not a
 * measurement, it is a measurement times a contested constant, and the code says so rather
 * than quietly picking a number.
 */

/** Speed of light, km/s — the unit redshift work is conventionally done in. */
const C_KM_S = 299_792.458;

export interface HubbleConstant {
  id: string;
  /** km/s/Mpc */
  value: number;
  uncertainty: number;
  source: string;
  note: string;
}

/**
 * The two ends of the Hubble tension, plus a neutral midpoint.
 *
 * These disagree by far more than their stated uncertainties, which is the whole problem.
 * Choosing between them changes every extragalactic distance in this catalogue by ~8%.
 */
export const HUBBLE_CONSTANTS = {
  planck2018: {
    id: "planck2018",
    value: 67.4,
    uncertainty: 0.5,
    source: "Planck Collaboration 2018, A&A 641, A6",
    note: "Early-universe: inferred from the cosmic microwave background.",
  },
  sh0es2022: {
    id: "sh0es2022",
    value: 73.04,
    uncertainty: 1.04,
    source: "Riess et al. 2022, ApJL 934, L7",
    note: "Late-universe: Cepheid-calibrated Type Ia supernovae.",
  },
  midpoint: {
    id: "midpoint",
    value: 70.0,
    uncertainty: 3.0,
    source: "Neutral midpoint",
    note: "Splits the tension. Convenient, and not a measurement of anything.",
  },
} as const satisfies Record<string, HubbleConstant>;

export type HubbleConstantId = keyof typeof HUBBLE_CONSTANTS;

/** Default. Planck is the more precisely stated of the two, which is not the same as right. */
export const DEFAULT_HUBBLE: HubbleConstantId = "planck2018";

export type DistanceMethod = "parallax" | "redshift" | "unknown";

export interface DerivedDistance {
  /** Megaparsecs. Zero means unknown. */
  megaparsecs: number;
  method: DistanceMethod;
  /** Present for redshift distances: which H0 was assumed. */
  hubbleConstant?: HubbleConstant;
  note?: string;
}

/**
 * Distance from redshift.
 *
 * Uses the relativistic Doppler correction before Hubble's law rather than the naive
 * `d = cz/H0`. At the redshifts in this catalogue (mostly z < 0.1) the difference is a few
 * percent, but the naive form is wrong in a direction that grows, and there is no reason to
 * bake in an error we know how to avoid.
 */
export function distanceFromRedshift(
  z: number,
  hubble: HubbleConstant = HUBBLE_CONSTANTS[DEFAULT_HUBBLE],
): DerivedDistance {
  if (!Number.isFinite(z) || z <= 0) {
    return { megaparsecs: 0, method: "unknown" };
  }

  // Relativistic recession velocity from redshift.
  const ratio = (1 + z) ** 2;
  const velocityKmS = C_KM_S * ((ratio - 1) / (ratio + 1));

  return {
    megaparsecs: velocityKmS / hubble.value,
    method: "redshift",
    hubbleConstant: hubble,
    note:
      `Derived from redshift z=${z.toPrecision(3)} assuming H0=${hubble.value} km/s/Mpc. ` +
      `Scales as 1/H0, which is disputed at the ~8% level.`,
  };
}

/** Distance from parallax. Geometric, and the only kind here that assumes nothing. */
export function distanceFromParallax(milliarcseconds: number): DerivedDistance {
  if (!Number.isFinite(milliarcseconds) || milliarcseconds <= 0) {
    return { megaparsecs: 0, method: "unknown" };
  }
  // d[pc] = 1000 / parallax[mas], then to megaparsecs.
  const parsecs = 1000 / milliarcseconds;
  return {
    megaparsecs: parsecs / 1e6,
    method: "parallax",
    note: "Geometric distance from parallax; assumes no cosmology.",
  };
}

/**
 * Largest parallax any NGC/IC object could plausibly have, in milliarcseconds.
 *
 * 50 mas is 20 parsecs. The nearest objects in these catalogues are the Hyades at ~47 pc
 * (21 mas) and the Coalsack at ~180 pc; nothing is closer. A larger value is not a
 * measurement of the object, it is contamination from a foreground star that landed in the
 * same cross-match.
 */
export const MAX_PLAUSIBLE_PARALLAX_MAS = 50;

/**
 * Best available distance, preferring the method that assumes least — with one hard rule.
 *
 * **Galaxies never get a parallax.** The nearest galaxy is ~50 kpc away, which is a parallax
 * of 0.00002 mas: four orders of magnitude below anything ever measured. So a parallax on a
 * galaxy is always spurious, and trusting one is not a small error.
 *
 * This is not hypothetical. OpenNGC lists M31 with a 6 mas parallax, inherited from a
 * foreground star in the SIMBAD cross-match. Taken at face value it places Andromeda at
 * 167 parsecs — inside the Milky Way, nearer than most of the stars in our own stellar
 * catalogue, rather than at its true 780 kiloparsecs. Preferring "the method that assumes
 * least" is right in general and catastrophically wrong here.
 *
 * With the parallax correctly rejected M31 falls through to redshift, which is *negative* —
 * Andromeda is blueshifted, falling toward us at ~300 km/s. Hubble's law does not apply to
 * it at all, so the honest answer is that this catalogue does not know how far away M31 is.
 */
export function bestDistance(
  parallaxMas: number | null,
  redshift: number | null,
  hubble: HubbleConstant = HUBBLE_CONSTANTS[DEFAULT_HUBBLE],
  options: { isExtragalactic?: boolean } = {},
): DerivedDistance {
  const parallaxUsable =
    !options.isExtragalactic &&
    parallaxMas !== null &&
    parallaxMas > 0 &&
    parallaxMas <= MAX_PLAUSIBLE_PARALLAX_MAS;

  if (parallaxUsable) return distanceFromParallax(parallaxMas);
  if (redshift !== null && redshift > 0) return distanceFromRedshift(redshift, hubble);

  return {
    megaparsecs: 0,
    method: "unknown",
    note:
      options.isExtragalactic && parallaxMas !== null && parallaxMas > 0
        ? "Source lists a parallax, but no galaxy has a measurable one; rejected as contamination."
        : undefined,
  };
}

/**
 * Rescale a redshift-derived distance for a different Hubble constant.
 *
 * Because distance is exactly proportional to 1/H0, switching between Planck and SH0ES is a
 * single multiplication — which makes it cheap to let a user see the tension move the
 * universe, rather than reading about it.
 */
export function rescaleForHubble(
  megaparsecs: number,
  from: HubbleConstant,
  to: HubbleConstant,
): number {
  return megaparsecs * (from.value / to.value);
}

export const MEGAPARSEC_M = 3.0856775814913673e22;

export function megaparsecsToMetres(mpc: number): number {
  return mpc * MEGAPARSEC_M;
}
