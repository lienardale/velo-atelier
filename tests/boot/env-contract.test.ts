/**
 * The environment contract, as a real server obeys it (W5).
 *
 * `tests/unit/db/env.test.ts` pins what `parseEnv` decides. This tier pins the
 * consequence: that `instrumentation.ts` is wired into the BUILT server, and
 * that a wrong environment stops that server answering — not a warning nobody
 * reads.
 *
 * Four cases, one build, no build of its own:
 *
 *   1. a DEPLOYMENT carrying a test flag         → answers no page; the reason is logged
 *   2. the same refused server, asked for a file → still serves it, a compiled chunk included
 *                                                  (why the BUILD refuses the hooks)
 *   3. a local production server, all flags on   → boots, serves /api/health, says nothing
 *   4. a clean deployment                        → boots, serves /api/health, logs that it checked
 *
 * Case 3 is why the flags are scoped to `VERCEL_ENV` at all: the `next` CLI
 * defaults NODE_ENV to production for `next start`, so CI's boot check,
 * Playwright's web server, Lighthouse and perf are all "production" servers
 * started on purpose with `ENABLE_TEST_PAGES=1`. Case 4 is the other guard
 * rail: the contract must not make a legitimate deployment fail to boot.
 *
 * **HOW A REFUSAL LOOKS, measured on Next 16.3.6 and not assumed.** It is NOT
 * a non-zero exit. `NextNodeServer`'s constructor fires
 * `this.prepare().catch(err => console.error('Failed to prepare server', err))`
 * (`next-server.js`), so the rejection `register()` raises is logged and
 * swallowed there; `initialize()` in `server/lib/start-server.js` resolves
 * normally and its `process.exit(1)` path is never reached. The socket stays
 * bound and the per-request `await` of that same rejected promise turns every
 * page, route handler and metadata route into a 500, for as long as the
 * process lives. So: sample the status several times and require that the
 * route is never answered, rather than waiting for an exit that does not
 * come. Case 1 accepts a non-zero exit too, so the test still passes if a
 * future Next makes the failure fatal — what it will never accept is a 200.
 *
 * **"Every request" would be one word too many** (case 2). Files under
 * `/_next/static` and `public/` are answered by Next's router server before a
 * request reaches the server whose `prepare()` rejected, so a refused server
 * still hands them out. That is the real reason `NEXT_PUBLIC_TEST_HOOKS` has
 * to be refused when the bundle is BUILT (`scripts/vercel-build.sh`): a boot
 * refusal keeps every page from loading a poisoned chunk, and leaves the chunk
 * itself one URL away.
 *
 * **A 500 is a verdict, never a race** — so cases 3 and 4 take the FIRST
 * answer `/api/health` gives. A request that arrives while `register()` is
 * still running is HELD and answered once it settles (`start-server.js`
 * awaits its handlers, `handleRequest` awaits `prepare()`); before the port is
 * bound the connection is refused, and that alone is retried. A healthy
 * server was never seen to answer 500 on its way up — some 45 000 answers
 * across 12 boots polled from spawn, and the same with `register()` held open
 * for four seconds (review of 2026-10-06). `/api/health` itself only returns
 * 200 or 503, so a 500 there means the server was refused, and waiting longer
 * would change nothing but the time it takes to say so.
 *
 * **This tier tests the build on disk, not the working tree.** With `getEnv()`
 * removed from `instrumentation.ts` and `.next` left as it was, it stays
 * green. `scripts/ci/build.sh` always builds first, so CI is unaffected;
 * `tests/unit/deploy/instrumentation.test.ts` is what fails on the edit
 * itself.
 *
 * Where this lives and why: the CI `integration` job has no `.next`, so a spec
 * placed in `tests/integration/` would skip vacuously in the one job that runs
 * that tier. `scripts/ci/build.sh` invokes this project right after the build
 * instead, and `vitest.config.ts` only defines it when `.next/BUILD_ID` is on
 * disk — so `npm test` in a fresh clone never sees it.
 *
 * Precondition, shared with `build.sh`'s own boot check one step earlier: a
 * reachable database, so `/api/health` can answer `{ok:true,db:true}`. Without
 * one, cases 3 and 4 fail at once on a 503 — the contract accepted the server,
 * the route could not reach its database.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** The CLI itself, run under this process's node: no npx resolution in the way. */
const NEXT_BIN = `${root}node_modules/next/dist/bin/next`;
const BUILD_ID = `${root}.next/BUILD_ID`;

/** How long a server is given to bind its port. Not how long a 500 is tolerated: that is zero. */
const HEALTH_TIMEOUT_MS = 90_000;
/** How long a refused server is given to answer at all, and how often it is then sampled. */
const REFUSAL_TIMEOUT_MS = 60_000;
const REFUSAL_SAMPLES = 3;
const REFUSAL_SAMPLE_GAP_MS = 750;
/**
 * How long the child's log is given to reach this process once a request has
 * been answered. The answer travels over a socket and the log over a pipe, so
 * a line the server printed BEFORE answering can still arrive after it.
 */
const LOG_SETTLE_MS = 5_000;
/**
 * The same wait when the assertion is that a line is ABSENT — where it is
 * always spent in full, so it is kept short: a second, for a pipe between two
 * processes on one machine.
 */
const ABSENCE_SETTLE_MS = 1_000;

/** `instrumentation.ts`'s one line of positive evidence, on a deployment. */
const ENFORCED = "[env] contract enforced";
/** A file under `public/`, committed (`npm run drawings`), so every build has it. */
const PUBLIC_FILE = "/tree-drawings.json";
/** Where the build writes the JavaScript it serves under `/_next/static/chunks/`. */
const CHUNKS_DIR = `${root}.next/static/chunks`;

/* eslint-disable security/detect-non-literal-fs-filename -- every path is fixed, relative to this file */
const dotenvTest = (): Record<string, string> => {
  const file = `${root}.env.test`;
  return existsSync(file) ? parseDotenv(readFileSync(file)) : {};
};
const hasBuild = (): boolean => existsSync(BUILD_ID);
/**
 * One compiled chunk of THIS build, as a URL path — the first `*.js` by name,
 * read off disk because the build chooses the names. A folder with none is an
 * error of its own: there would be nothing to sample, and a case that fetched
 * nothing must not pass.
 */
const firstChunk = (): string => {
  const name = readdirSync(CHUNKS_DIR)
    .filter((entry) => entry.endsWith(".js"))
    .sort()
    .at(0);
  if (name === undefined) throw new Error(`no *.js under ${CHUNKS_DIR}: nothing to sample`);
  return `/_next/static/chunks/${name}`;
};
/* eslint-enable security/detect-non-literal-fs-filename */

/**
 * The environment a child server gets.
 *
 * `.env.test` underneath, the real environment on top (a CI `env:` block and a
 * worktree's own exports must win, exactly as everywhere else), then the
 * case's overrides.
 *
 * An `undefined` override removes the variable from the SPAWN environment —
 * which is not the same as the server not having it. `next start` loads
 * `.env.production.local`, `.env.local`, `.env.production` and `.env` from the
 * repository root and fills in every key the environment lacks; it never
 * overrides one that is defined. So a case that needs a variable OFF pins it
 * to a value (`"0"`); only `NODE_ENV` and `VERCEL_ENV`, which no `.env*` file
 * of this project sets, are safe to remove.
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

/** What a server that must not serve actually did. */
interface Refusal {
  /** Non-null only if the process died — Next 16.3.6 keeps it alive. */
  readonly exitCode: number | null;
  /** One status per sample, `[]` when the process exited before answering. */
  readonly statuses: number[];
}

/**
 * Watch a server that is expected to refuse, and report HOW it refused.
 *
 * Waits for the socket to answer at all (or the process to die), then samples
 * a few times: "never answers the route" is a claim about more than one
 * request, and the rejected `prepare()` promise is supposed to be kept for the
 * life of the process, not for the first request.
 */
async function refusal(server: Server): Promise<Refusal> {
  const url = `http://127.0.0.1:${server.port}/api/health`;
  const deadline = Date.now() + REFUSAL_TIMEOUT_MS;
  const statuses: number[] = [];

  while (statuses.length < REFUSAL_SAMPLES) {
    if (server.hasExited()) return { exitCode: await server.exited, statuses };
    const response = await fetch(url).catch(() => undefined);
    if (response) {
      statuses.push(response.status);
      await response.arrayBuffer(); // release the socket
      await delay(REFUSAL_SAMPLE_GAP_MS);
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${url} neither answered nor died in ${REFUSAL_TIMEOUT_MS} ms:\n${server.output()}`,
      );
    }
    await delay(250);
  }
  return { exitCode: null, statuses };
}

/**
 * The FIRST HTTP answer from `path`, whatever its status — for the cases that
 * expect a working server.
 *
 * Only a connection error is retried: it means the port is not bound yet.
 * Every HTTP status is final. A request sent while `register()` is still
 * running is held until it settles, so the first answer is already the
 * server's verdict — the route's own if the contract passed, a 500 if it
 * refused (see the header). A refused server therefore fails its case on the
 * first answer, with the EnvValidationError in the message, instead of being
 * polled to a deadline it was never going to meet.
 */
async function firstResponse(server: Server, path = "/api/health"): Promise<Response> {
  const url = `http://127.0.0.1:${server.port}${path}`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    if (server.hasExited()) {
      throw new Error(`the server exited before answering ${url}:\n${server.output()}`);
    }
    const response = await fetch(url).catch(() => undefined);
    if (response) return response;
    if (Date.now() > deadline) {
      throw new Error(
        `${url} refused every connection for ${HEALTH_TIMEOUT_MS} ms:\n${server.output()}`,
      );
    }
    await delay(250);
  }
}

/** Wait until the child's log holds `text`, or `withinMs` has passed. */
async function logged(server: Server, text: string, withinMs = LOG_SETTLE_MS): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!server.output().includes(text)) {
    if (Date.now() > deadline || server.hasExited()) return server.output().includes(text);
    await delay(50);
  }
  return true;
}

/**
 * Assert that `/api/health` answered 200 `{ok:true,db:true}` on the first try.
 *
 * On any other status the log is given a moment to arrive before the message
 * is built: the reason — an EnvValidationError for a 500, the database error
 * for a 503 — is in it, and it is the only useful part of the failure.
 */
async function expectHealthy(server: Server): Promise<void> {
  const response = await firstResponse(server);
  const body = await response.text();
  if (response.status !== 200) {
    await logged(server, response.status === 500 ? "Failed to prepare server" : "[health]");
  }
  expect(
    response.status,
    `the first answer from /api/health was ${response.status} ${body}\n${server.output()}`,
  ).toBe(200);
  expect(JSON.parse(body)).toEqual({ ok: true, db: true });
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

  it("never serves a deployment that carries a test flag", async () => {
    const server = startServer(
      await freePort(),
      childEnv({ VERCEL_ENV: "production", ENABLE_TEST_PAGES: "1" }),
    );

    const { exitCode, statuses } = await refusal(server);
    const context = `exit=${exitCode} statuses=[${statuses.join(", ")}]\n${server.output()}`;

    // The property that matters, whichever way Next chooses to fail: the route
    // was not answered once. On 16.3.6 that is three 500s and a process still
    // running; a future Next that exits non-zero satisfies it too.
    expect(
      statuses.filter((status) => status < 500),
      context,
    ).toEqual([]);
    expect(
      exitCode === null ? statuses.length === REFUSAL_SAMPLES : exitCode !== 0,
      `the poisoned server neither refused every sample nor died: ${context}`,
    ).toBe(true);

    // And it said why, with the variable's name — the whole point of wiring
    // `getEnv()` to the boot rather than leaving it a declaration.
    expect(server.output()).toContain("EnvValidationError");
    expect(server.output()).toContain("ENABLE_TEST_PAGES");
    // A refused deployment must never carry the line that says it passed.
    expect(server.output()).not.toContain(ENFORCED);
  });

  it("still serves a file from a refused server, which is why the build refuses the hooks", async () => {
    // Not a requirement — an observation the design leans on, held here so it
    // cannot quietly stop being true. Next's router server answers `public/`
    // and `/_next/static` itself, before the request reaches the server whose
    // `prepare()` rejected. A boot refusal therefore keeps every PAGE from
    // loading a bundle, and leaves the bundle's files fetchable: only refusing
    // NEXT_PUBLIC_TEST_HOOKS at BUILD time keeps `window.__va` out of reach.
    //
    // If a future Next answers 500 here too, nothing is broken: correct the
    // sentences that say otherwise (`instrumentation.ts`, `lib/env.ts`,
    // `scripts/vercel-build.sh`, `docs/deploy.md`) and flip this expectation.
    //
    // Both kinds of file are sampled. `public/` alone would hold half of it:
    // the sentence `scripts/vercel-build.sh` cites this test for is about
    // `/_next/static`, where a chunk carrying `window.__va` would live, and
    // until this sample nothing here fetched one (found in review,
    // 2026-10-06). The chunk is whichever `*.js` sorts first in THIS build:
    // the names are the build's, and the claim is about the folder.
    const chunk = firstChunk();

    const server = startServer(
      await freePort(),
      childEnv({ VERCEL_ENV: "production", ENABLE_TEST_PAGES: "1" }),
    );

    const route = await firstResponse(server);
    const file = await firstResponse(server, PUBLIC_FILE);
    const compiled = await firstResponse(server, chunk);
    const context =
      `/api/health=${route.status} ${PUBLIC_FILE}=${file.status} ${chunk}=${compiled.status}\n` +
      server.output();

    expect(route.status, context).toBe(500);
    expect(file.status, context).toBe(200);
    expect(compiled.status, context).toBe(200);
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

    await expectHealthy(server);
    expect(server.hasExited()).toBe(false);
    // The answer above was only sent once `register()` had settled, so the
    // line would have been printed by now — and a local server prints none.
    // (`logged` waits for it, so a late pipe cannot make this pass by luck.)
    expect(await logged(server, ENFORCED, ABSENCE_SETTLE_MS), server.output()).toBe(false);
  });

  it("boots a deployment that satisfies the contract", async () => {
    // The production scope as `docs/deploy.md` describes it: AUTH_URL and the
    // Google pair present (`.env.test` supplies both), not one test flag set.
    // If this ever goes red, the contract has made a legitimate deploy
    // un-bootable — that is a product bug, never a reason to relax the rule.
    //
    // The three flags are PINNED to "0", not removed. Removed, `next start`
    // refills them from `.env.local` — which the README tells every
    // contributor to copy from `.env.example`, where all three are `1` — and
    // this "clean deployment" is then refused for carrying them (found in
    // review, 2026-10-06: green wherever there is no `.env.local` — a fresh
    // worktree, a simulated CI job environment — and red in any checkout set
    // up as documented; the tier had not run on GitHub Actions). Next's dotenv
    // loader never overrides a variable that is defined, and `lib/env.ts`'s
    // `flag` reads "0" as off.
    const server = startServer(
      await freePort(),
      childEnv({
        VERCEL_ENV: "production",
        ENABLE_TEST_PAGES: "0",
        NEXT_PUBLIC_TEST_HOOKS: "0",
        NEXT_PUBLIC_DEMO_LOGIN: "0",
      }),
    );

    await expectHealthy(server);
    // Positive evidence that the hook RAN in the built server, not merely that
    // nothing refused: a bundle with no instrumentation file answers 200 too.
    expect(
      await logged(server, `${ENFORCED} (VERCEL_ENV=production)`),
      `the built hook did not report that it checked the contract:\n${server.output()}`,
    ).toBe(true);
  });
});
