/**
 * Stored builds, across schema versions (§2.5).
 *
 * A build is stored as JSON — `Bike.parts`/`Bike.spec` in Postgres,
 * `va:bike:local` in a guest's browser — and read back by a newer release.
 * `parseStoredBuild` is the one reader: it switches on the spec's `version`,
 * upgrades older shapes step by step (none yet: version 1 is the identity), and
 * ends in `validateBuild`, so a stored build is held to exactly the rules of a
 * freshly submitted one.
 *
 * Throws rather than returning a result: a stored build that does not parse is
 * a corrupted row or a tampered storage key, and the callers (`lib/bike/*`)
 * catch it to fall back to `partsForSpec(buildBikeSpec(answers))` — answers stay
 * the source of truth (§4.2).
 */
import type { BikeBuild } from "../schema/part";

import { isPlainObject, validateBuild, type BuildIssue } from "./validate-build";

/** The spec version this release writes. */
export const CURRENT_BUILD_VERSION = 1;

export class UnsupportedBuildVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported stored build version: ${JSON.stringify(version) ?? String(version)}`);
    this.name = "UnsupportedBuildVersionError";
  }
}

export class InvalidStoredBuildError extends Error {
  constructor(readonly issues: BuildIssue[]) {
    super(
      `Invalid stored build: ${issues.map((issue) => `${issue.path} (${issue.code})`).join(", ")}`,
    );
    this.name = "InvalidStoredBuildError";
  }
}

/** `json.spec.version`, or `undefined` when the envelope is not even an object. */
export function storedBuildVersion(json: unknown): unknown {
  if (!isPlainObject(json) || !isPlainObject(json.spec)) return undefined;
  return json.spec.version;
}

/** Read a stored build of any known version as a current, validated `BikeBuild`. */
export function parseStoredBuild(json: unknown): BikeBuild {
  const version = storedBuildVersion(json);
  switch (version) {
    case 1: {
      const result = validateBuild(json);
      if (!result.ok) throw new InvalidStoredBuildError(result.issues);
      return result.build;
    }
    default:
      throw new UnsupportedBuildVersionError(version);
  }
}
