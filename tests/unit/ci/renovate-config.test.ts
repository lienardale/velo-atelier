/**
 * The three things that decide whether `renovate-config-validator` is a gate
 * or a decoration. None is visible in the job's log when it is wrong: a
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
 * 2. **The pin.** The validator is the whole of Renovate (~350 MB) for one
 *    path-filtered job — a file that changes a few times a year, and a pin
 *    Renovate is expected to bump about weekly — so it is downloaded by `npx`
 *    rather than installed: the one place in this pipeline that does not obey
 *    `scripts/ci/lint.sh`'s `--no-install` rule. A package fetched outside
 *    `package-lock.json` is a package `audit-ci` never sees and
 *    `minimumReleaseAge` never held, and Renovate publishes several releases a
 *    day, so `@latest` means "whatever the registry served that minute". Hence
 *    an exact version, kept current by `renovate.json`'s own `customManagers`
 *    entry — which this test pins to the literal line it must match, because a
 *    custom manager that matches nothing fails silently too.
 *
 * 3. **The verdict.** The first two are flags on a command; the third is what
 *    becomes of its exit status. This file listed "the two things" and stopped
 *    there, so `… --no-global "$CONFIG" || true`, an `if !` around the line,
 *    and `continue-on-error` on the job each left every test green (measured in
 *    review, 2026-10-06) — a validator with all its flags and no say.
 *
 * Nothing here runs the real validator: that is ~350 MB on a cold npx cache
 * (not timed on a runner) and a network. The script IS executed, and EVERY
 * spawn of it goes through one sandbox: a stand-in `npx` that answers 1 or 0
 * and records what it was asked. The stand-in cannot be bypassed by accident:
 * `_lib.sh` runs `nvm use` when `$HOME/.nvm/nvm.sh` exists, and nvm then
 * PREPENDS its own `bin` (measured with the real `HOME`: `npx` resolved to
 * nvm's, ahead of a stub) — which here would have meant a unit test
 * downloading the whole of Renovate. So `HOME` is an empty directory, `PATH`
 * is the stand-in's directory and the system's two and nothing else, and each
 * case asserts the stand-in's marker: present where the validator must run,
 * ABSENT where the script must stop before it.
 *
 * "Every spawn" was not true of the first version of this header. The
 * missing-file case ran the script with the inherited environment and the real
 * `npx`, on the reasoning that the guard under test returns first — so the day
 * that guard regressed, the unit tier would have gone on to
 * `npx --yes --package renovate@<pin>` for real. It did, once, in review
 * (2026-10-06): a mutant with the guard replaced by `if false` was killed by
 * that case, which means the script reached the real `npx` (the pinned
 * version was already in that machine's npx cache, so nothing was fetched).
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

/**
 * Every spawn below costs well under a second here: none of them sources nvm
 * (`HOME` is empty) and none reaches a real `npx`. The cap is there because
 * Vitest cannot interrupt a `spawnSync`, and is far above that cost because
 * the unit tier runs with every worker busy.
 */
const SPAWN_TIMEOUT_MS = 60_000;

const STUB_RAN = "STAND-IN-NPX-RAN";

let sandbox: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-renovate-config-"));
  mkdirSync(join(sandbox, "bin"));
  mkdirSync(join(sandbox, "home"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Run the script with an `npx` that prints its arguments and exits `exitCode`.
 * The ONLY way this file runs the script.
 */
function validate(exitCode: number, ...args: string[]): { status: number; output: string } {
  const stub = join(sandbox, "bin", "npx");
  writeFileSync(stub, `#!/bin/sh\nprintf '${STUB_RAN} %s\\n' "$*"\nexit ${exitCode}\n`);
  chmodSync(stub, 0o755);
  const result = spawnSync("bash", [join(root, SCRIPT_PATH), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    env: {
      // No node directory at all: the script needs none, and without one a
      // stand-in that failed to take would be `npx: command not found`, not
      // a download.
      PATH: [join(sandbox, "bin"), "/usr/bin", "/bin"].join(":"),
      HOME: join(sandbox, "home"),
      // Spelled out because Next augments `NodeJS.ProcessEnv` to require it
      // (lib/env.ts says why), not because the script reads it.
      NODE_ENV: process.env.NODE_ENV ?? "test",
    },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
/* eslint-enable security/detect-non-literal-fs-filename */

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
    // Through the stand-in, and the stand-in answers 0: if the guard ever
    // stops returning, this run ends GREEN with the marker in its output —
    // two assertions fail — and what the script reached was a three-line
    // shell script. The marker's ABSENCE is the "before": nothing was asked
    // of `npx` at all.
    const { status, output } = validate(0, "no-such-renovate.json");
    expect(output).toContain("no such Renovate config: no-such-renovate.json");
    expect(output).not.toContain(STUB_RAN);
    expect(status).toBe(1);
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

describe("the validator's verdict is the job's verdict", { timeout: 180_000 }, () => {
  const pinned = /^RENOVATE_VERSION="(\d+\.\d+\.\d+)"$/m.exec(script)?.[1] ?? "<no pin>";

  /** What the script must ask `npx` for, to the letter. */
  const asked = (config: string) =>
    `${STUB_RAN} --yes --package renovate@${pinned} -- renovate-config-validator --no-global ${config}`;

  it("fails when the validator fails", () => {
    const { status, output } = validate(1);
    // The stand-in ran, with the pin, the flag and the file: the three string
    // assertions above, made on the command as executed.
    expect(output).toContain(asked("renovate.json"));
    expect(status).toBe(1);
    // …and the script did not go on to say the opposite.
    expect(output).not.toContain("is valid Renovate configuration");
  });

  it("passes when the validator passes, and only then says so", () => {
    const { status, output } = validate(0);
    expect(output).toContain(asked("renovate.json"));
    expect(status).toBe(0);
    expect(output).toContain("renovate.json is valid Renovate configuration");
  });

  it("validates the file it was given, not always renovate.json", () => {
    // Any file that exists will do: the stand-in never opens it.
    const { status, output } = validate(1, "package.json");
    expect(output).toContain(asked("package.json"));
    expect(status).toBe(1);
  });

  it("is not excused by the workflow either", () => {
    // The same script under `continue-on-error`, or behind an `if:`, is a red
    // step in a green job, a skipped step in a green job, or no job at all.
    // migrate-preview.yml had this assertion from the start; this workflow
    // had none.
    //
    // Both are read off the file's TEXT. `if:` used to be one pattern,
    // `/^\s+if:/m`, which did not see it as the FIRST key of a step —
    // `- if: false` on the validator step was green (measured in review,
    // 2026-10-06). The second pattern below is that spelling, and
    // `tests/unit/ci/required-checks.test.ts` holds the same two keys on the
    // PARSED workflow, where no spelling can hide one.
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toMatch(/^\s+if:/m);
    expect(workflow).not.toMatch(/^\s*-\s+if:/m);
  });
});
