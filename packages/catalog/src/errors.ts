/**
 * Typed errors for the catalog and model pipeline.
 *
 * Every one of these represents a condition where continuing would produce a number nobody
 * can defend. They are thrown, not logged, because the alternative — carrying on with a
 * plausible-looking substitute — is exactly how a visualisation ends up asserting something
 * false with a confident label attached.
 *
 * Each carries structured fields as well as a message, so the web app can render a specific
 * panel rather than a stack trace.
 */

/** Base class, so a caller can catch everything this pipeline throws with one clause. */
export class AetherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A seed entry failed schema validation during ingestion. */
export class InvalidCatalogDataError extends AetherError {
  readonly entryId: string;
  readonly issues: readonly string[];

  constructor(entryId: string, issues: readonly string[]) {
    super(
      `Catalog entry "${entryId}" is invalid and was not ingested:\n  ${issues.join("\n  ")}`,
    );
    this.entryId = entryId;
    this.issues = issues;
  }
}

/** A value was supplied in a unit that cannot express the requested quantity. */
export class UnitMismatchError extends AetherError {
  readonly field: string;
  readonly have: string;
  readonly want: string;

  constructor(field: string, have: string, want: string) {
    super(
      `Field "${field}" is in "${have}", which cannot answer a request for "${want}". ` +
        `This is a conversion bug, not a missing measurement.`,
    );
    this.field = field;
    this.have = have;
    this.want = want;
  }
}

/**
 * A field the pipeline genuinely requires could not be resolved by any strategy.
 *
 * Distinct from a field that is merely unknown: an unknown Bond albedo is normal and is
 * handled by assumption, but a planet with no radius from any source cannot be drawn at all.
 */
export class UnresolvedRequiredFieldError extends AetherError {
  readonly field: string;
  readonly detail: string;

  constructor(field: string, detail: string) {
    super(`Required field "${field}" could not be resolved. ${detail}`);
    this.field = field;
    this.detail = detail;
  }
}

/** A system or planet id that is not in the catalog. */
export class UnknownCatalogEntryError extends AetherError {
  readonly requested: string;
  readonly available: readonly string[];

  constructor(kind: "system" | "planet", requested: string, available: readonly string[]) {
    super(`No ${kind} with id "${requested}". Available: ${available.join(", ") || "(none)"}.`);
    this.requested = requested;
    this.available = available;
  }
}
