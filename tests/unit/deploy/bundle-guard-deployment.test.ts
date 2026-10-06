/**
 * `scripts/bundle-guard.ts` on a DEPLOYMENT — the "second lock".
 *
 * `scripts/vercel-build.sh` refuses `NEXT_PUBLIC_TEST_HOOKS` before the
 * compile. `bundle-guard.ts` refuses the same combination again after it, "so
 * the rule holds even if the build is invoked some other way" — a sentence
 * three files repeat and, until this test, nothing executed:
 * `vercel-build-guard.test.ts` stubs `npx`, so the guard never ran there, and
 * `scripts/ci/build.sh` runs it without `VERCEL_ENV`. With the refusal deleted,
 * a hooks-on build on a deployment was reported as a PASS and every tier stayed
 * green (measured in review, 2026-10-06).
 *
 * The REAL script is executed, through the repository's own `tsx`, with `cwd`
 * in a throwaway directory — `STATIC_DIR` is derived from `process.cwd()`, so
 * each case decides what "the build output" contains. Two traps shape the
 * assertions:
 *
 *   - **An exit code alone proves nothing here.** In a directory with no
 *     `.next/static` the script exits 1 for a different reason ("run `next
 *     build` first"). Every case therefore asserts on the MESSAGE, and the
 *     cases about the refusal give it a real chunk to pass or fail on.
 *   - **`npx tsx` does not work from a temporary directory**: it finds no
 *     local `tsx` there and asks to install one (seen in review, 2026-10-06:
 *     "npx canceled due to missing packages"). The binary is called by its
 *     absolute path.
 *
 * `VERCEL_ENV` and `NEXT_PUBLIC_TEST_HOOKS` are cleared from the inherited
 * environment unless a case sets them, as `vercel-build-guard.test.ts` does:
 * a shell that has just built the e2e artifact exports the second one.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const TSX = join(root, "node_modules/.bin/tsx");
const SCRIPT = join(root, "scripts/bundle-guard.ts");

/** What the deployment refusal prints, and nothing else in the script does. */
const REFUSAL = "on a deployment";

/** A chunk as a hooks-on build emits one, and one from an ordinary build. */
const CHUNK_WITH_HOOKS = "window.__va={focus(){}};";
const CLEAN_CHUNK = "console.log(1);";

let sandbox: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-bundle-guard-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Give the sandbox a build output holding exactly one chunk. */
function builtWith(chunk: string): void {
  const dir = join(sandbox, ".next", "static", "chunks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "app.js"), chunk);
}
/* eslint-enable security/detect-non-literal-fs-filename */

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function guard(env: Readonly<Record<string, string | undefined>>): Run {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    VERCEL_ENV: undefined,
    NEXT_PUBLIC_TEST_HOOKS: undefined,
    ...env,
  };
  const result = spawnSync(TSX, [SCRIPT], {
    cwd: sandbox,
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined),
    ) as unknown as NodeJS.ProcessEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Every case starts a real `tsx`; Vitest's default 5 s is too close to a cold
// start on a busy CI runner to be a fair verdict.
describe("bundle-guard: the test hooks are refused on a deployment", { timeout: 30_000 }, () => {
  it.each(["preview", "production"])(
    "refuses a %s build made with NEXT_PUBLIC_TEST_HOOKS=1, hooks and all",
    (scope) => {
      // The case the refusal exists for: the marker IS in the bundle, and rule
      // 2 follows the flag — so without the refusal this very build prints
      // "✓ test hooks present" and exits 0. `window.__va` shipped, reported as
      // a pass.
      builtWith(CHUNK_WITH_HOOKS);

      const result = guard({ VERCEL_ENV: scope, NEXT_PUBLIC_TEST_HOOKS: "1" });

      expect(result.stderr).toContain(`NEXT_PUBLIC_TEST_HOOKS=1 ${REFUSAL} (VERCEL_ENV=${scope})`);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("test hooks present");
    },
  );

  it("refuses before it reads a single file", () => {
    // No `.next` at all: the refusal still speaks, and it is the refusal that
    // speaks — not "run `next build` first".
    const result = guard({ VERCEL_ENV: "preview", NEXT_PUBLIC_TEST_HOOKS: "1" });

    expect(result.stderr).toContain(REFUSAL);
    expect(result.stderr).not.toContain("next build");
    expect(result.status).toBe(1);
  });

  it("does not refuse a deployment built with the flag off", () => {
    builtWith(CLEAN_CHUNK);

    const result = guard({ VERCEL_ENV: "production" });

    expect(result.stderr).not.toContain(REFUSAL);
    expect(result.stdout).toContain("no problem");
    expect(result.status).toBe(0);
  });

  it("still fails a deployment whose bundle carries the hooks with the flag off", () => {
    // Not the refusal: the ABSENCE rule, which is the assertion that actually
    // looks at the bytes.
    builtWith(CHUNK_WITH_HOOKS);

    const result = guard({ VERCEL_ENV: "production" });

    expect(result.stderr).not.toContain(REFUSAL);
    expect(result.stderr).toContain("no test hooks");
    expect(result.status).toBe(1);
  });

  it("leaves the e2e build alone: the flag on, and no VERCEL_ENV", () => {
    // `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh`
    // is how the e2e artifact is built, and there the marker MUST be found.
    builtWith(CHUNK_WITH_HOOKS);

    const result = guard({ NEXT_PUBLIC_TEST_HOOKS: "1" });

    expect(result.stderr).not.toContain(REFUSAL);
    expect(result.stdout).toContain("test hooks present");
    expect(result.status).toBe(0);
  });

  describe("the `true` spelling", () => {
    // `=== "1"` here against `1 | true | yes` in scripts/vercel-build.sh is
    // deliberate (the comment in `main()` says why): `next.config.ts` inlines
    // anything but "1" as "0", so `true` cannot put the hooks in the bundle.
    // The refusal is skipped and the absence rule decides — on the bytes.

    it("is not refused when the bundle is clean", () => {
      builtWith(CLEAN_CHUNK);

      const result = guard({ VERCEL_ENV: "preview", NEXT_PUBLIC_TEST_HOOKS: "true" });

      expect(result.stderr).not.toContain(REFUSAL);
      expect(result.stdout).toContain("no problem");
      expect(result.status).toBe(0);
    });

    it("still fails, through the absence rule, if a hook marker shipped anyway", () => {
      builtWith(CHUNK_WITH_HOOKS);

      const result = guard({ VERCEL_ENV: "preview", NEXT_PUBLIC_TEST_HOOKS: "true" });

      expect(result.stderr).not.toContain(REFUSAL);
      expect(result.stderr).toContain("no test hooks");
      expect(result.status).toBe(1);
    });
  });

  it("says a missing build is a missing build", () => {
    // The trap named in the header, pinned: this exit 1 is NOT the refusal.
    const result = guard({ VERCEL_ENV: "preview" });

    expect(result.stderr).toContain("next build");
    expect(result.stderr).not.toContain(REFUSAL);
    expect(result.status).toBe(1);
  });
});
