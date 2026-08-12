import { describe, expect, it } from "vitest";
import {
  ALL_PARAMETERS,
  MISSION_PRESETS,
  allMissionsSelection,
  buildEvidenceProfile,
  confidenceCeiling,
  createSelection,
  describeEvidence,
  discoveryFacilities,
  envelopeWidth,
  includesPlannedMission,
  isConstrained,
  listMissions,
  missionForFacility,
  missionIds,
  missionsByStatus,
  missionsWithTechnique,
  presetSelection,
} from "./index.js";

describe("registry", () => {
  it("registers each mission under a unique id", () => {
    const ids = missionIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("tess");
    expect(ids).toContain("jwst");
    expect(ids).toContain("gaia");
  });

  it("orders missions newest first", () => {
    const missions = listMissions();
    for (let i = 1; i < missions.length; i++) {
      expect(missions[i]!.startYear).toBeLessThanOrEqual(missions[i - 1]!.startYear);
    }
  });

  it("separates discovery facilities from characterisation observatories", () => {
    const discovery = discoveryFacilities().map((m) => m.id);
    expect(discovery).toContain("tess");
    expect(discovery).toContain("kepler");
    // JWST characterises known planets; it does not survey for new ones.
    expect(discovery).not.toContain("jwst");
    expect(discovery).not.toContain("hst");
  });

  it("finds missions by observation technique", () => {
    const spectro = missionsWithTechnique("transmission_spectroscopy").map((m) => m.id);
    expect(spectro).toContain("jwst");
    expect(spectro).toContain("hst");
    expect(spectro).not.toContain("kepler");
  });

  it("marks unflown missions as planned", () => {
    const planned = missionsByStatus("planned").map((m) => m.id);
    expect(planned).toContain("ariel");
    expect(planned).toContain("hwo");
    expect(planned).not.toContain("tess");
  });
});

describe("archive facility resolution", () => {
  it("resolves the long-form names the NASA archive actually uses", () => {
    expect(missionForFacility("Transiting Exoplanet Survey Satellite (TESS)")?.id).toBe("tess");
    expect(missionForFacility("Kepler")?.id).toBe("kepler");
    expect(missionForFacility("La Silla Observatory")?.id).toBe("ground_rv");
    expect(missionForFacility("SuperWASP")?.id).toBe("ground_transit");
  });

  it("returns undefined for an unrecognised facility rather than guessing", () => {
    // Guessing would silently attribute data to the wrong instrument, which is worse than
    // showing the user an unrecognised source.
    expect(missionForFacility("Mount Wilson 1919")).toBeUndefined();
  });
});

describe("the evidence model — mission choice is a scientific statement", () => {
  it("gives a TESS-only planet a radius ratio and almost nothing else", () => {
    const profile = buildEvidenceProfile(createSelection(["tess"]));

    expect(isConstrained(profile, "planet_radius_ratio")).toBe(true);
    expect(isConstrained(profile, "orbital_period")).toBe(true);

    // The things that make a world renderable are all absent.
    expect(isConstrained(profile, "planet_mass")).toBe(false);
    expect(isConstrained(profile, "stellar_distance")).toBe(false);
    expect(isConstrained(profile, "atmospheric_composition")).toBe(false);
    expect(profile.completeness).toBeLessThan(0.25);
  });

  it("tightens as follow-up missions are added", () => {
    const tessOnly = buildEvidenceProfile(createSelection(["tess"]));
    const plusGaia = buildEvidenceProfile(createSelection(["tess", "gaia"]));
    const plusMass = buildEvidenceProfile(createSelection(["tess", "gaia", "ground_rv"]));
    const plusAtmosphere = buildEvidenceProfile(
      createSelection(["tess", "gaia", "ground_rv", "jwst"]),
    );

    expect(plusGaia.completeness).toBeGreaterThan(tessOnly.completeness);
    expect(plusMass.completeness).toBeGreaterThan(plusGaia.completeness);
    expect(plusAtmosphere.completeness).toBeGreaterThan(plusMass.completeness);

    // Each addition unlocks something specific rather than just nudging a number.
    expect(isConstrained(plusGaia, "stellar_distance")).toBe(true);
    expect(isConstrained(plusMass, "planet_mass")).toBe(true);
    expect(isConstrained(plusAtmosphere, "atmospheric_composition")).toBe(true);
  });

  it("takes the best quality across missions, never the sum", () => {
    // Ticking more boxes must not manufacture confidence. Two mediocre transit surveys do
    // not add up to one good one.
    const kepler = buildEvidenceProfile(createSelection(["kepler"]));
    const both = buildEvidenceProfile(createSelection(["kepler", "corot"]));
    expect(confidenceCeiling(both, "planet_radius_ratio")).toBe(
      confidenceCeiling(kepler, "planet_radius_ratio"),
    );
  });

  it("attributes each constraint to the mission that supplied it", () => {
    const profile = buildEvidenceProfile(createSelection(["tess", "jwst", "gaia"]));
    expect(profile.bestSource.atmospheric_composition).toBe("jwst");
    expect(profile.bestSource.stellar_distance).toBe("gaia");
  });

  it("returns zero confidence for anything unconstrained", () => {
    const profile = buildEvidenceProfile(createSelection(["tess"]));
    // Zero means ScienceSpec keeps null and the resolver must supply a badged value.
    expect(confidenceCeiling(profile, "atmospheric_composition")).toBe(0);
  });

  it("reports nothing knowable when no mission is selected", () => {
    const profile = buildEvidenceProfile(createSelection([]));
    expect(profile.completeness).toBe(0);
    expect(profile.unconstrained).toHaveLength(ALL_PARAMETERS.length);
    expect(describeEvidence(profile)).toMatch(/No missions selected/);
  });
});

describe("envelope width", () => {
  it("widens as evidence thins", () => {
    const thin = envelopeWidth(buildEvidenceProfile(createSelection(["tess"])));
    const rich = envelopeWidth(buildEvidenceProfile(allMissionsSelection()));
    expect(thin).toBeGreaterThan(rich);
  });

  it("never closes entirely, because no exoplanet surface has been observed", () => {
    const everything = envelopeWidth(buildEvidenceProfile(allMissionsSelection()));
    expect(everything).toBeGreaterThanOrEqual(0.15);
  });
});

describe("presets", () => {
  it("names only registered missions", () => {
    const known = new Set(missionIds());
    for (const [id, preset] of Object.entries(MISSION_PRESETS)) {
      for (const missionId of preset.missions) {
        expect(known.has(missionId), `preset "${id}" names unknown mission "${missionId}"`).toBe(
          true,
        );
      }
    }
  });

  it("shows the Kepler era as genuinely poorer than today", () => {
    const then = buildEvidenceProfile(presetSelection("kepler_era"));
    const now = buildEvidenceProfile(presetSelection("today"));
    expect(now.completeness).toBeGreaterThan(then.completeness);
    // Gaia distances are the single biggest thing the Kepler era lacked.
    expect(isConstrained(then, "stellar_distance")).toBe(false);
    expect(isConstrained(now, "stellar_distance")).toBe(true);
  });

  it("makes discovery-only data visibly thin", () => {
    const profile = buildEvidenceProfile(presetSelection("discovery_only"));
    expect(profile.completeness).toBeLessThan(0.3);
    expect(describeEvidence(profile)).toMatch(/mass/);
  });

  it("flags projected worlds so they can be labelled differently", () => {
    expect(includesPlannedMission(presetSelection("future"))).toBe(true);
    expect(includesPlannedMission(presetSelection("today"))).toBe(false);
  });
});

describe("HWO is the only route to a surface constraint", () => {
  it("constrains surface composition, and nothing else does", () => {
    for (const mission of listMissions()) {
      if (mission.id === "hwo") {
        expect(mission.constrains.surface_composition).toBeDefined();
      } else {
        expect(
          mission.constrains.surface_composition,
          `${mission.id} must not claim to constrain a surface`,
        ).toBeUndefined();
      }
    }
  });

  it("keeps that constraint weak, per the published degeneracies", () => {
    // Ocean and sand are near-indistinguishable from 0.4-1.8 um, and surface albedo trades
    // against planetary radius. A confident number here would misrepresent the literature.
    const profile = buildEvidenceProfile(createSelection(["hwo"]));
    expect(confidenceCeiling(profile, "surface_composition")).toBeLessThan(0.5);
  });
});

describe("mission metadata is complete enough to display", () => {
  it("gives every mission a description, an agency and at least one instrument", () => {
    for (const mission of listMissions()) {
      expect(mission.description.length, mission.id).toBeGreaterThan(40);
      expect(mission.agency.length, mission.id).toBeGreaterThan(0);
      expect(mission.instruments.length, mission.id).toBeGreaterThan(0);
      for (const instrument of mission.instruments) {
        expect(instrument.wavelength.maxUm).toBeGreaterThan(instrument.wavelength.minUm);
        expect(instrument.techniques.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives completed missions an end year and operational ones none", () => {
    for (const mission of listMissions()) {
      if (mission.status === "completed") {
        expect(mission.endYear, mission.id).toBeDefined();
        expect(mission.endYear!).toBeGreaterThan(mission.startYear);
      } else {
        expect(mission.endYear, mission.id).toBeUndefined();
      }
    }
  });
});
