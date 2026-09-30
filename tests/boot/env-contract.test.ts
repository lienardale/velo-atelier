/**
 * The environment contract, as a real server obeys it (W5).
 *
 * `tests/unit/db/env.test.ts` pins what `parseEnv` decides. This tier pins the
 * consequence: that `instrumentation.ts` is wired, that Next awaits it, and
 * that a refusal is an exit code — not a warning nobody reads.
 *
 * Three cases, one build, no build of its own:
 *
 *   1. a DEPLOYMENT carrying a test flag           → exit 1, EnvValidationError
 *   2. a local production server, all flags on     → boots, serves /api/health
 *   3. a clean deployment                          → boots, serves /api/health
 *
 * Case 2 is why the flags are scoped to `VERCEL_ENV` at all: the `next` CLI
 * defaults NODE_ENV to production for `next start`, so CI's boot check,
 * Playwright's web server, Lighthouse and perf are all "production" servers
 * started on purpose with `ENABLE_TEST_PAGES=1`. Case 3 is the other guard
 * rail: the contract must not make a legitimate deployment fail to boot.
 *
 * **Never assert on a refused connection.** Next binds the socket before it
 * runs `register()`, so a request that lands in that window gets a 500 and a
 * poisoned server looks briefly alive. Case 1 waits for the process to exit
 * and reads its output; cases 2 and 3 retry past a 500.
 *
 * Where this lives and why: the CI `integration` job has no `.next`, so a spec
 * placed in `tests/integration/` would skip vacuously in the one job that runs
 * that tier. `scripts/ci/build.sh` invokes this project right after the build
 * instead, and `vitest.config.ts` only defines it when `.next/BUILD_ID` is on
 * disk — so `npm test` in a fresh clone never sees it.
 *
 * Precondition, shared with `build.sh`'s own boot check one step earlier: a
 * reachable database, so `/api/health` can answer `{ok:true,db:true}`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** The CLI itself, run under this process's node: no npx resolution in the way. */
const NEXT_BIN = `${root}node_modules/next/dist/bin/next`;
const BUILD_ID = `${root}.next/BUILD_ID`;

const HEALTH_TIMEOUT_MS = 90_000;
const EXIT_TIMEOUT_MS = 60_000;

/* eslint-disable security/detect-non-literal-fs-filename -- both paths are fixed, relative to this file */
const dotenvTest = (): Record<string, string> => {
  const file = `${root}.env.test`;
  return existsSync(file) ? parseDotenv(readFileSync(file)) : {};
};
const hasBuild = (): boolean => existsSync(BUILD_ID);
/* eslint-enable security/detect-non-literal-fs-filename */

/**
 * The environment a child server gets.
 *
 * `.env.test` underneath, the real environment on top (a CI `env:` block and a
 * worktree's own exports must win, exactly as everywhere else), then the
 * case's overrides — `undefined` removes a variable rather than blanking it.
 *
 * `NODE_ENV` and `VERCEL_ENV` are always dropped first. Vitest sets
 * `NODE_ENV=test` in THIS process, and the `next` CLI only applies its
 * production default when the variable is absent — "every `next start` is
 * production" is the thing under test, so it must not be pre-empted here.
 */
function childEnv(overrides: Readonly<Record<string, string | undefined>> = {}): NodeJS.ProcessEnv {
  const merged: Record<string, string | undefined> = {
    ...dotenvTest(),
    ...process.env,
    NODE_ENV: undefined,
    VERCEL_ENV: undefined,
    ...overrides,
  };
  // Next augments `NodeJS.ProcessEnv` so `NODE_ENV` is a required readonly
  // member; a bag that deliberately has no `NODE_ENV` cannot be typed as one.
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as NodeJS.ProcessEnv;
}

/** A port nothing is listening on right now — four agents share this machine. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("no ephemeral port"))));
    });
  });
}

interface Server {
  readonly port: number;
  readonly child: ChildProcess;
  /** stdout and stderr, interleaved as they arrived. */
  readonly output: () => string;
  readonly exited: Promise<number | null>;
  readonly hasExited: () => boolean;
}

const running = new Set<ChildProcess>();

function startServer(port: number, env: NodeJS.ProcessEnv): Server {
  const child = spawn(
    process.execPath,
    [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  running.add(child);

  let text = "";
  const collect = (chunk: unknown) => (text += String(chunk));
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let done = false;
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      done = true;
      running.delete(child);
      resolve(code);
    });
  });

  return { port, child, output: () => text, exited, hasExited: () => done };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then<T>(() => {
      throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    }),
  ]);
}

/**
 * The first answer from `/api/health` that is not the boot race.
 *
 * A connection error means the socket is not up yet; a 500 means it is up and
 * `register()` has not finished (or has thrown — hence the exit check, which
 * turns "poisoned server" into a readable failure instead of a 90-second
 * timeout).
 */
async function healthResponse(server: Server): Promise<Response> {
  const url = `http://127.0.0.1:${server.port}/api/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    if (server.hasExited()) {
      throw new Error(`the server exited before answering ${url}:\n${server.output()}`);
    }
    const response = await fetch(url).catch(() => undefined);
    if (response && response.status !== 500) return response;
    if (Date.now() > deadline) {
      throw new Error(
        `no usable answer from ${url} in ${HEALTH_TIMEOUT_MS} ms` +
          `${response ? ` (last status ${response.status})` : ""}:\n${server.output()}`,
      );
    }
    await delay(250);
  }
}

afterEach(async () => {
  for (const child of [...running]) {
    child.kill("SIGKILL");
  }
  // Give the OS a moment to release the ports before the next case asks for one.
  if (running.size > 0) await delay(100);
  running.clear();
});

describe("boot: the environment contract on a started server", () => {
  beforeAll(() => {
    expect(
      hasBuild(),
      "the boot tier needs a production build: run `bash scripts/ci/build.sh` (or `npm run build`) first",
    ).toBe(true);
  });

  it("refuses a deployment that carries a test flag, with exit 1", async () => {
    const server = startServer(
      await freePort(),
      childEnv({ VERCEL_ENV: "production", ENABLE_TEST_PAGES: "1" }),
    );

    const code = await withTimeout(server.exited, EXIT_TIMEOUT_MS, "the server to refuse and exit");

    expect(code, `server did not exit 1:\n${server.output()}`).toBe(1);
    expect(server.output()).toContain("EnvValidationError");
    expect(server.output()).toContain("ENABLE_TEST_PAGES");
  });

  it("boots a local production server with every test flag on", async () => {
    // No VERCEL_ENV: this is CI's boot check, Playwright's web server,
    // Lighthouse and perf. NODE_ENV is production all the same (the CLI's
    // default), which is exactly why the flags cannot key off `isProduction`.
    const server = startServer(
      await freePort(),
      childEnv({
        ENABLE_TEST_PAGES: "1",
        NEXT_PUBLIC_TEST_HOOKS: "1",
        NEXT_PUBLIC_DEMO_LOGIN: "1",
      }),
    );

    const response = await healthResponse(server);

    expect(response.status, `unexpected /api/health status:\n${server.output()}`).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: true });
    expect(server.hasExited()).toBe(false);
  });

  it("boots a deployment that satisfies the contract", async () => {
    // The production scope as `docs/deploy.md` describes it: AUTH_URL and the
    // Google pair present (`.env.test` supplies both), not one test flag set.
    // If this ever goes red, the contract has made a legitimate deploy
    // un-bootable — that is a product bug, never a reason to relax the rule.
    const server = startServer(
      await freePort(),
      childEnv({
        VERCEL_ENV: "production",
        ENABLE_TEST_PAGES: undefined,
        NEXT_PUBLIC_TEST_HOOKS: undefined,
        NEXT_PUBLIC_DEMO_LOGIN: undefined,
      }),
    );

    const response = await healthResponse(server);

    expect(response.status, `unexpected /api/health status:\n${server.output()}`).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: true });
  });
});
