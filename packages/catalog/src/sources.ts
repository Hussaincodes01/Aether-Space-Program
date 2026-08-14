/**
 * The source registry.
 *
 * Every value in the seed catalog names one of these ids. Ingestion rejects an entry whose
 * `sourceId` does not resolve here, which is what makes "click any number and see where it
 * came from" a structural guarantee rather than an aspiration.
 *
 * `retrievedAt` is the date the value was transcribed, not the paper's publication date.
 * They differ, and the first is the one that tells you how stale the catalog is.
 */

import { InvalidCatalogDataError } from "./errors.js";
import { SourceSchema, type Source } from "./schema.js";

const RETRIEVED = "2026-08-14T00:00:00.000Z";

const RAW_SOURCES: readonly Source[] = [
  {
    id: "agol2021",
    citation:
      "Agol et al. (2021), Refining the transit-timing and photometric analysis of TRAPPIST-1",
    url: "https://doi.org/10.3847/PSJ/abd022",
    bibcode: "2021PSJ.....2....1A",
    retrievedAt: RETRIEVED,
  },
  {
    id: "gillon2017",
    citation: "Gillon et al. (2017), Seven temperate terrestrial planets around TRAPPIST-1",
    url: "https://doi.org/10.1038/nature21360",
    bibcode: "2017Natur.542..456G",
    retrievedAt: RETRIEVED,
  },
  {
    id: "ducrot2020",
    citation: "Ducrot et al. (2020), TRAPPIST-1: global results of the Spitzer campaign",
    url: "https://doi.org/10.1051/0004-6361/201937392",
    bibcode: "2020A&A...640A.112D",
    retrievedAt: RETRIEVED,
  },
  {
    id: "anglada-escude2016",
    citation:
      "Anglada-Escudé et al. (2016), A terrestrial planet candidate in a temperate orbit around Proxima Centauri",
    url: "https://doi.org/10.1038/nature19106",
    bibcode: "2016Natur.536..437A",
    retrievedAt: RETRIEVED,
  },
  {
    id: "faria2022",
    citation:
      "Faria et al. (2022), A candidate short-period sub-Earth orbiting Proxima Centauri",
    url: "https://doi.org/10.1051/0004-6361/202142337",
    bibcode: "2022A&A...658A.115F",
    retrievedAt: RETRIEVED,
  },
  {
    id: "gaia-dr3",
    citation: "Gaia Collaboration (2023), Gaia Data Release 3",
    url: "https://doi.org/10.1051/0004-6361/202243940",
    retrievedAt: RETRIEVED,
  },
  {
    id: "iau2015-b3",
    citation: "IAU 2015 Resolution B3, nominal solar and planetary conversion constants",
    url: "https://www.iau.org/static/resolutions/IAU2015_English.pdf",
    retrievedAt: RETRIEVED,
  },
  {
    id: "codata2018",
    citation: "CODATA 2018 recommended values of the fundamental physical constants",
    url: "https://physics.nist.gov/cuu/Constants/",
    retrievedAt: RETRIEVED,
  },
  {
    id: "jpl-fact-sheet",
    citation: "NASA/GSFC planetary fact sheets",
    url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/",
    retrievedAt: RETRIEVED,
  },
  {
    id: "unmeasured",
    citation:
      "No published measurement. Recorded as unknown so the pipeline can say so explicitly.",
    retrievedAt: RETRIEVED,
  },
];

const registry = new Map<string, Source>();

for (const source of RAW_SOURCES) {
  const parsed = SourceSchema.safeParse(source);
  if (!parsed.success) {
    throw new InvalidCatalogDataError(
      source.id,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  if (registry.has(source.id)) {
    throw new InvalidCatalogDataError(source.id, ["duplicate source id"]);
  }
  registry.set(source.id, parsed.data);
}

export function getSource(id: string): Source | undefined {
  return registry.get(id);
}

export function listSources(): readonly Source[] {
  return [...registry.values()];
}

export function sourceExists(id: string): boolean {
  return registry.has(id);
}
