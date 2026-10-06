/**
 * `load_env_contract_defaults` — the shell helper two CI steps boot a server with.
 *
 * Since W5 `instrumentation.ts` runs `getEnv()` on every `next start`, and the
 * `next` CLI defaults NODE_ENV to production, so a server started without
 * `AUTH_SECRET` answers 500 for every page and route handler. Two steps start
 * one from an environment that was never complete — `build.sh`'s boot check
 * and the `npm run start` behind `lighthouse.sh` — and this function fills the
 * gaps from the committed `.env.test`.
 *
 * It had no test. That is worse than it sounds for one specific reason:
 * **`.env.test` sets all three forbidden flags to `1`**. `ENABLE_TEST_PAGES`
 * opens `/dev/*`, `NEXT_PUBLIC_TEST_HOOKS` ships `window.__va` and
 * `NEXT_PUBLIC_DEMO_LOGIN` prints demo credentials. The only thing standing
 * between them and every server these two steps start is the `case … continue`
 * in the middle of the loop — four tokens, deletable by accident, and until
 * now nothing anywhere failed if they went. `npm run ci:local` does not even
 * run `lighthouse`, so a regression there surfaced as a red required check on
 * a PR and nowhere earlier.
 *
 * The function is executed for real, in a child bash with an environment built
 * from scratch (not inherited), so "was unset, is now set" and "was set, is
 * untouched" are both observations rather than readings of the source.
 * `HOME` points into the sandbox so the nvm line at the top of `_lib.sh`
 * no-ops instead of costing a second per case.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseDotenv } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();

/** What `.env.test` actually holds — asserted against, never hard-coded here. */
const envTest: Record<string, string> = parseDotenv(readFileSync(join(root, ".env.test")));

/** The three the file carries and the function must never hand on. §W5 */
const FORBIDDEN = ["ENABLE_TEST_PAGES", "NEXT_PUBLIC_TEST_HOOKS", "NEXT_PUBLIC_DEMO_LOGIN"];

/** Every key the probe reports on: whatever is in the file, plus a miss. */
const REPORTED = [...Object.keys(envTest), "DEFINITELY_NOT_IN_THE_FILE"];

const UNSET = "<UNSET>";

let sandbox: string;
let probe: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-env-defaults-"));
  probe = join(sandbox, "probe.sh");
  writeFileSync(
    probe,
    [
      "#!/usr/bin/env bash",
      // Sourcing _lib.sh is what every scripts/ci/* step does first; it brings
      // `set -euo pipefail` and PROJECT_ROOT with it.
      `. "${join(root, "scripts/ci/_lib.sh")}"`,
      "load_env_contract_defaults >/dev/null",
      `for key in ${REPORTED.join(" ")}; do`,
      `  printf '%s=%s\\n' "$key" "\${!key-${UNSET}}"`,
      "done",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});
/* eslint-enable security/detect-non-literal-fs-filename */

/** Run the probe with EXACTLY this environment (plus PATH and a throwaway HOME). */
function load(preset: Readonly<Record<string, string>> = {}): Record<string, string> {
  const stdout = execFileSync("bash", [probe], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    // `as unknown as` and not a plain cast: Next augments `NodeJS.ProcessEnv`
    // so `NODE_ENV` is REQUIRED, and the whole point here is an environment
    // built from nothing. (`lib/env.ts`'s `EnvSource` exists for the same
    // reason.)
    env: {
      PATH: process.env.PATH,
      // Not the real one: `_lib.sh` sources ~/.nvm/nvm.sh when it exists, and
      // this test has no interest in nvm.
      HOME: sandbox,
      ...preset,
    } as unknown as NodeJS.ProcessEnv,
  });

  return Object.fromEntries(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

describe("load_env_contract_defaults", () => {
  it("fills every contract variable the environment is missing", () => {
    const env = load();

    // Everything `.env.test` carries EXCEPT the three flags.
    for (const [key, value] of Object.entries(envTest)) {
      if (FORBIDDEN.includes(key)) continue;
      expect(env[key], `${key} should have come from .env.test`).toBe(value);
    }
    // A key in no file stays absent: the function fills, it does not invent.
    expect(env.DEFINITELY_NOT_IN_THE_FILE).toBe(UNSET);
  });

  it("never takes the three test flags from the file, however the file is written", () => {
    // The whole point. `.env.test` sets all three to 1 because the integration
    // and e2e tiers want them; a server started by `lighthouse.sh` must not
    // inherit `/dev/*`, `window.__va` and a demo-credentials banner because it
    // happened to need AUTH_SECRET from the same file.
    for (const key of FORBIDDEN) {
      expect(
        envTest[key],
        `${key} is in .env.test — that is what makes this test necessary`,
      ).toBeDefined();
      expect(load()[key], `${key} must never be set by load_env_contract_defaults`).toBe(UNSET);
    }
  });

  it("leaves a real environment variable alone", () => {
    // The CI lighthouse job: Postgres is on host `postgres`, and the site URL
    // is the port lhci was given. Both must survive; AUTH_SECRET (unset there)
    // must still arrive.
    const preset = {
      POSTGRES_URL: "postgresql://velo:velo@postgres:5432/velo_atelier_test",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3105",
    };
    const env = load(preset);

    expect(env.POSTGRES_URL).toBe(preset.POSTGRES_URL);
    expect(env.NEXT_PUBLIC_SITE_URL).toBe(preset.NEXT_PUBLIC_SITE_URL);
    expect(env.AUTH_SECRET).toBe(envTest.AUTH_SECRET);
  });

  it("leaves a flag the caller set deliberately alone", () => {
    // `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh`
    // is how the e2e artifact is built. Skipping the key must mean "do not
    // read it from the file", never "unset what the caller chose".
    const env = load({ ENABLE_TEST_PAGES: "1", NEXT_PUBLIC_TEST_HOOKS: "1" });

    expect(env.ENABLE_TEST_PAGES).toBe("1");
    expect(env.NEXT_PUBLIC_TEST_HOOKS).toBe("1");
    expect(env.NEXT_PUBLIC_DEMO_LOGIN).toBe(UNSET);
  });

  it("is a no-op when the file is absent", () => {
    // A caller may point it at a file that does not exist; that is a skip, not
    // a failure of the step.
    const stdout = execFileSync(
      "bash",
      [
        "-c",
        `. "${join(root, "scripts/ci/_lib.sh")}"; load_env_contract_defaults /nope/none; echo OK`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
        env: { PATH: process.env.PATH, HOME: sandbox } as unknown as NodeJS.ProcessEnv,
      },
    );
    expect(stdout.trim()).toBe("OK");
  });
});

/**
 * The helper only helps the commands that go through it.
 *
 * `npm run lhci` used to be a bare `lhci autorun`: lhci then started
 * `npm run start` from whatever the shell held, and from the README's
 * `.env.local` (Google pair empty) that server is refused by the contract.
 * Nothing failed fast — Next prints "Ready", which is the pattern lhci waits
 * for, before answering 500 (the server's side measured in review,
 * 2026-10-06). CI never saw it: its job calls the script. Read off disk, like
 * `migrate-on-deploy.test.ts`: this is wiring, and a tidy-up is what undoes it.
 */
describe("the commands that start a production server go through it", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every call site passes a literal repo path
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  // Each pattern is anchored on a line that RUNS the command: a comment or a
  // `log_step` banner naming it never matches.
  const LOAD = /^load_env_contract_defaults\b/m;
  const LHCI = /^[ \t]*(?:npx --no-install |npx )?lhci autorun\b/m;
  const BUILD = /^npm run build$/m;
  const START = /^[ \t]*(?:npx --no-install |npx )?next start\b/m;

  it("`npm run lhci` is scripts/ci/lighthouse.sh, not a bare `lhci autorun`", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.lhci).toBe("bash scripts/ci/lighthouse.sh");
  });

  it("lighthouse.sh completes the environment before lhci starts the server", () => {
    const script = read("scripts/ci/lighthouse.sh");
    expect(script.search(LOAD)).toBeGreaterThan(-1);
    expect(script.search(LOAD)).toBeLessThan(script.search(LHCI));
  });

  it("build.sh completes it AFTER the build and before its boot check", () => {
    // After the build on purpose: NEXT_PUBLIC_* is inlined by the bundler, so
    // a value taken from `.env.test` must never be able to reach the bundle.
    const script = read("scripts/ci/build.sh");
    expect(script.search(BUILD)).toBeGreaterThan(-1);
    expect(script.search(BUILD)).toBeLessThan(script.search(LOAD));
    expect(script.search(LOAD)).toBeLessThan(script.search(START));
  });
});
