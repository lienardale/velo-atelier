/**
 * The boot tier is only a gate while `scripts/ci/build.sh` runs it.
 *
 * `tests/boot/env-contract.test.ts` is the one place a BUILT server is shown to
 * refuse a poisoned deployment and to boot a clean one. The unit tier cannot
 * see that (it has no build), and nothing else runs the `boot` project: the CI
 * `unit` job names its four projects, `coverage` only merges blobs, pre-push
 * skips the build, and `vitest.config.ts` defines the project only when a
 * build is on disk. The whole guarantee therefore hangs on one line at the end
 * of `scripts/ci/build.sh` — and with that line deleted, every tier stayed
 * green and `bash -n` was happy (measured in review, 2026-10-06).
 *
 * `migrate-on-deploy.test.ts` reads `scripts/vercel-build.sh` off disk for the
 * same reason; this does it for the other entry point.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const buildScript = readFileSync(join(process.cwd(), "scripts/ci/build.sh"), "utf8");

/**
 * The two commands, anchored on a line that RUNS them: optional `npx`, then
 * the command, from the start of the line. A comment never matches, and
 * neither does the `log_step "… (vitest --project boot)"` banner above the
 * tier — a banner that survives its command is exactly the failure to catch.
 * `BOOT_TIER` takes the rest of its line with it, so what follows the command
 * can be inspected.
 */
const BOOT_CHECK = /^[ \t]*(?:npx --no-install |npx )?next start\b/m;
const BOOT_TIER =
  /^[ \t]*(?:npx --no-install |npx )?vitest run\b[^#\n]*--project[ =]boot\b[^\n]*$/m;

describe("ci: scripts/ci/build.sh runs the boot tier", () => {
  it("runs `vitest run --project boot`, uncommented", () => {
    expect(buildScript.search(BOOT_TIER)).toBeGreaterThan(-1);
  });

  it("runs it after its own boot check", () => {
    // The boot check is what proves THIS build starts at all (and is the
    // Prisma 7 + Turbopack tripwire); the tier then spawns servers of its own
    // against the same `.next`, which is why the script stops its own server
    // first. The other way round, a build that cannot boot would surface as a
    // handful of failing cases instead of one clear step.
    const bootCheck = buildScript.search(BOOT_CHECK);
    expect(bootCheck).toBeGreaterThan(-1);
    expect(bootCheck).toBeLessThan(buildScript.search(BOOT_TIER));
  });

  it("does not stop, or forgive a failure, on the way there", () => {
    // `set -e` comes with `_lib.sh`, so a failed tier fails the step. What
    // could still hide it is an `exit 0` between the boot check and the tier —
    // the only early exit the script has is the one that skips BOTH when there
    // is no health route, and it sits above the boot check — or an `||` that
    // swallows the tier's own exit code.
    const between = buildScript.slice(
      buildScript.search(BOOT_CHECK),
      buildScript.search(BOOT_TIER),
    );
    expect(between).not.toMatch(/^[^#\n]*\bexit 0\b/m);
    // `exit 0` is not the only way out. `skip_step` is this library's own
    // exit-0 helper (`_lib.sh`; `lighthouse.sh` uses it three times) and the
    // idiom an editor reaches for to skip a tier that needs a database:
    // inserted here, uncommented, it passed the line above with the tier
    // never run (measured in review, 2026-10-06). `return` is refused on the
    // same ground — the quiet way out of a function or a sourced file — and
    // was not seen to slip through: nothing between the two returns today.
    expect(between).not.toMatch(/^[^#\n]*\b(?:skip_step|return)\b/m);

    // And the tier's line ends at `boot`: nothing after the command, not even
    // a comment. That refuses `|| true` and `|| log_warn …`, and a trailing
    // `&` — which backgrounds the tier and lets `log_ok "build passed"`
    // answer for it, and which the `||` check alone let through (same review).
    const tier = buildScript.match(BOOT_TIER)?.[0];
    expect(tier).not.toContain("||");
    expect(tier).toMatch(/--project[ =]boot$/);
  });
});
