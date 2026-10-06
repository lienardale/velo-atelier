/**
 * `instrumentation.ts`'s `register()` — what it runs, and the one line it prints.
 *
 * Two things here are invisible from outside a server, which is why they are
 * pinned on the source and not left to the boot tier alone:
 *
 *   - **That the hook calls `getEnv()` at all.** `tests/boot/env-contract.test.ts`
 *     proves it on a started server, but only in the CI `build` job and only
 *     against whatever build is on disk: with the call removed from the source
 *     and `.next` left as it was, that tier stays green (measured in review,
 *     2026-10-06). This one fails on the edit itself.
 *   - **That a deployment which passed says so.** A server that passed the
 *     contract and a server whose bundle never contained the hook both answer
 *     200 — Next treats a missing instrumentation file as "none" and logs
 *     nothing. `[env] contract enforced (VERCEL_ENV=…)` in the runtime log is
 *     the only positive evidence that the check ran on a deployment, so both
 *     directions are held: printed when `VERCEL_ENV` is set, and never for a
 *     local or CI server, where it would be noise in every Playwright run.
 *
 * What `parseEnv` DECIDES is `tests/unit/db/env.test.ts`'s subject, not this
 * file's: the environments below are either plainly valid or plainly refused.
 */

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { register } from "@/instrumentation";
import { EnvValidationError, resetEnvCache } from "@/lib/env";

const DATABASE = "postgresql://velo:velo@localhost:5432/velo_atelier";

/** A complete Production scope; each case changes what it is about. */
const COMPLETE: Readonly<Record<string, string | undefined>> = {
  NEXT_RUNTIME: "nodejs",
  NODE_ENV: "production",
  VERCEL_ENV: undefined,
  POSTGRES_URL: DATABASE,
  POSTGRES_URL_NON_POOLING: DATABASE,
  AUTH_SECRET: "x".repeat(32),
  AUTH_URL: "https://velo-atelier.example",
  AUTH_GOOGLE_ID: "google-id",
  AUTH_GOOGLE_SECRET: "google-secret",
  NEXT_PUBLIC_SITE_URL: "https://velo-atelier.example",
  // Cleared, not inherited: a shell that just ran the e2e build exports them.
  ENABLE_TEST_PAGES: undefined,
  NEXT_PUBLIC_TEST_HOOKS: undefined,
  NEXT_PUBLIC_DEMO_LOGIN: undefined,
};

function stubEnvironment(overrides: Readonly<Record<string, string | undefined>> = {}): void {
  for (const [key, value] of Object.entries({ ...COMPLETE, ...overrides })) {
    vi.stubEnv(key, value);
  }
}

const ENFORCED = /^\[env\] contract enforced/;

describe("instrumentation: register()", () => {
  let info: MockInstance<typeof console.info>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
    // `getEnv()` memoises process-wide; the next case must parse its own.
    resetEnvCache();
  });

  /** Every `[env] contract enforced …` line printed so far. */
  const enforcedLines = (): string[] =>
    info.mock.calls.map((call) => String(call[0])).filter((line) => ENFORCED.test(line));

  it.each(["production", "preview", "development"])(
    "says the contract was enforced on a %s deployment that passes",
    async (scope) => {
      stubEnvironment({ VERCEL_ENV: scope });

      await register();

      expect(enforcedLines()).toEqual([`[env] contract enforced (VERCEL_ENV=${scope})`]);
    },
  );

  it("prints nothing for a local production server", async () => {
    // No VERCEL_ENV: CI's boot check, Playwright's web server, Lighthouse and
    // perf, every one of them a NODE_ENV=production `next start` with the test
    // flags on. The contract passes there and must stay quiet about it.
    stubEnvironment({
      ENABLE_TEST_PAGES: "1",
      NEXT_PUBLIC_TEST_HOOKS: "1",
      NEXT_PUBLIC_DEMO_LOGIN: "1",
    });

    await register();

    expect(enforcedLines()).toEqual([]);
  });

  it("rejects with the EnvValidationError on a deployment that breaks the contract", async () => {
    // The whole point of the hook: `getEnv()` is CALLED, and what it throws is
    // not caught here — Next logs it and answers 500 from then on.
    stubEnvironment({ VERCEL_ENV: "production", ENABLE_TEST_PAGES: "1" });

    await expect(register()).rejects.toBeInstanceOf(EnvValidationError);
    // A refused deployment must never carry the line that says it passed.
    expect(enforcedLines()).toEqual([]);
  });

  it.each(["edge", undefined])("does nothing when NEXT_RUNTIME is %s", async (runtime) => {
    // The edge compilation of this same file must not pull zod in, and
    // `process.env` means nothing there. Even a poisoned environment is not
    // looked at: the Node server is where the contract is enforced.
    stubEnvironment({ NEXT_RUNTIME: runtime, VERCEL_ENV: "production", ENABLE_TEST_PAGES: "1" });

    await expect(register()).resolves.toBeUndefined();
    expect(enforcedLines()).toEqual([]);
  });
});
