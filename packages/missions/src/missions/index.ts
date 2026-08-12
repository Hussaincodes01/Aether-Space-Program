/**
 * Mission barrel.
 *
 * Importing this module registers every mission. Adding one means creating a file beside
 * these and adding one export line here — the selector UI, the filters and the evidence
 * model all pick it up with no further changes.
 */

export * from "./transit-surveys.js";
export * from "./spectroscopy.js";
export * from "./astrometry-and-rv.js";
export * from "./future.js";
