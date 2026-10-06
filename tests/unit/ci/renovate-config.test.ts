/**
 * The two things that decide whether `renovate-config-validator` is a gate or
 * a decoration. Neither is visible in the job's log when it is wrong: a
 * weakened check and a passing check print the same green tick.
 *
 * 1. **`--no-global`.** Handed a FILENAME the validator treats it as a
 *    self-hosted GLOBAL config — it announces `Validating renovate.json as
 *    global config` — and the global schema is WIDER than the repository
 *    schema the Renovate service actually applies to `renovate.json`. Measured
 *    on 44.108.1, one file both ways: a copy carrying `baseDir` and `redisUrl`
 *    validates successfully as a global config (exit 0) and fails as a repo
 *    config (exit 1) with `The "baseDir" option is a global option reserved
 *    only for Renovate's global configuration…`. Drop the flag and the job
 *    still passes everything it passed before, while quietly accepting a class
 *    of config the service rejects — which is the whole failure this workflow
 *    exists to prevent (`.debug/016` §4).
 *
 * 2. **The pin.** The validator is the whole of Renovate (~350 MB) for a file
 *    that changes a few times a year, so it is downloaded by `npx` rather than
 *    installed — the one place in this pipeline that does not obey
 *    `scripts/ci/lint.sh`'s `--no-install` rule. A package fetched outside
 *    `package-lock.json` is a package `audit-ci` never sees and
 *    `minimumReleaseAge` never held, and Renovate publishes several releases a
 *    day, so `@latest` means "whatever the registry served that minute". Hence
 *    an exact version, kept current by `renovate.json`'s own `customManagers`
 *    entry — which this test pins to the literal line it must match, because a
 *    custom manager that matches nothing fails silently too.
 *
 * Nothing here runs the validator: that costs minutes and a network. The one
 * execution is the missing-file path, which returns before `npx`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every call site passes a literal repo path
  return readFileSync(join(root, relativePath), "utf8");
}

const SCRIPT_PATH = "scripts/ci/renovate-config.sh";
const script = read(SCRIPT_PATH);
const workflow = read(".github/workflows/renovate-config.yml");

interface CustomManager {
  customType?: string;
  fileMatch?: string[];
  matchStrings?: string[];
  datasourceTemplate?: string;
  depNameTemplate?: string;
}

const renovateConfig = JSON.parse(read("renovate.json")) as {
  customManagers?: CustomManager[];
};

/** The script's one `npx` line, comments excluded. */
const npxLine =
  script
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .find((line) => line.includes("renovate-config-validator") && line.includes("npx")) ?? "";

describe("renovate-config.sh validates a REPOSITORY config", () => {
  it("runs the validator, once", () => {
    // A guard on the guards below: they all read `npxLine`, and a rename that
    // left it empty would make every one of them vacuously true.
    expect(npxLine).not.toBe("");
    expect(npxLine).toContain("renovate-config-validator");
  });

  it("passes --no-global, or the global schema's wider option set gets through", () => {
    expect(npxLine).toContain("--no-global");
  });

  it("validates renovate.json by default, and an explicit path when given one", () => {
    expect(script).toContain('CONFIG="${1:-renovate.json}"');
    expect(npxLine).toContain('"$CONFIG"');
  });

  it("refuses a config file that does not exist, before downloading anything", () => {
    const result = spawnSync("bash", [join(root, SCRIPT_PATH), "no-such-renovate.json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("no such Renovate config");
  });
});

describe("the validator is pinned, and the pin is kept fresh", () => {
  const pin = /^RENOVATE_VERSION="(\d+\.\d+\.\d+)"$/m.exec(script);

  it("pins an exact version on a line of its own", () => {
    expect(pin, `${SCRIPT_PATH} must hold RENOVATE_VERSION="<x.y.z>"`).not.toBeNull();
  });

  it("never resolves a tag or a range at run time", () => {
    expect(npxLine).toContain('"renovate@$RENOVATE_VERSION"');
    expect(npxLine).not.toContain("renovate@latest");
    // `--package renovate` with no version is the unpinned form this replaces.
    expect(npxLine).not.toMatch(/--package\s+renovate\b(?!@)/);
    expect(workflow).not.toContain("renovate@latest");
  });

  it("is the version renovate.json's customManager will bump", () => {
    // A custom manager whose regex matches nothing raises no error anywhere:
    // Renovate simply never proposes the update, and the pin ages in silence
    // — the same shape as the unread config this whole workflow is about.
    const manager = (renovateConfig.customManagers ?? []).find((entry) =>
      (entry.fileMatch ?? []).some((pattern) =>
        // eslint-disable-next-line security/detect-non-literal-regexp -- the pattern comes from the committed renovate.json, and the point of this test is to run Renovate's own regex rather than a copy of it.
        new RegExp(pattern).test(SCRIPT_PATH),
      ),
    );
    expect(manager, `no customManagers entry matches ${SCRIPT_PATH}`).toBeDefined();
    expect(manager?.depNameTemplate).toBe("renovate");
    expect(manager?.datasourceTemplate).toBe("npm");

    const hits = (manager?.matchStrings ?? []).flatMap((pattern) => {
      // eslint-disable-next-line security/detect-non-literal-regexp -- same: the pattern is renovate.json's, read from the repository, and running it is the assertion.
      const found = new RegExp(pattern, "m").exec(script);
      return found?.groups?.currentValue ? [found.groups.currentValue] : [];
    });
    expect(hits, "the customManager's matchStrings find no version in the script").toEqual([
      pin?.[1],
    ]);
  });
});
