/**
 * Boot hook — the runtime lock on the environment contract.
 *
 * `lib/env.ts` has declared the environment contract since W0 and, until W5,
 * nothing ran it outside its own unit test: a typo in the Vercel dashboard
 * still surfaced at 2 a.m. as an `undefined` deep inside Auth.js. This file is
 * what turns that declaration into a refused server carrying the variable's
 * name. It is the second of two evaluations on Vercel: `scripts/check-env.ts`
 * runs the same `parseEnv` during the Vercel build (`scripts/vercel-build.sh`),
 * so a wrong scope normally fails the BUILD and never gets this far.
 *
 * Four facts about Next 16.3.6 shape it. Each was read off the installed
 * package, and the three about a running server were also measured against
 * it, 2026-10-06 (`tests/boot/env-contract.test.ts` holds the refusal and the
 * file that is still served, and relies on the fourth to take a FIRST answer):
 *
 *   - **`register()` does not run during `next build`.**
 *     `server/lib/router-utils/instrumentation-globals.external.js` returns
 *     early when `NEXT_PHASE=phase-production-build`. A build therefore still
 *     needs no database URL and no production secret — the property
 *     `lib/env.ts`'s header promises — and nothing in `next build` evaluates
 *     the contract. That is why the Vercel entry point runs its own preflight,
 *     and why `NEXT_PUBLIC_TEST_HOOKS`, which the bundler inlines, is refused
 *     there before the compile.
 *   - **A throw here stops the server answering pages, but does not kill it.**
 *     `prepareImpl()` awaits `register()`, but `NextNodeServer`'s constructor
 *     fires
 *     `this.prepare().catch(err => console.error('Failed to prepare server', err))`,
 *     so that rejection is logged and swallowed there;
 *     `server/lib/start-server.js` sees `initialize()` resolve and never
 *     reaches its `process.exit(1)`. The socket stays bound, the rejected
 *     promise is kept (`base-server.js` clears it only on success), and every
 *     request that reaches `handleRequest` awaits it again: **every page,
 *     route handler and metadata route answers 500**, for as long as the
 *     process lives. There is no exit code to read, which is why
 *     `scripts/ci/build.sh`'s boot check (curl `/api/health`) is what catches
 *     it in CI, and why the boot tier samples the status instead of waiting
 *     for an exit.
 *   - **Not everything is a 500: files under `/_next/static` and `public/` are
 *     still served.** `server/lib/router-server.js` answers them with
 *     `serveStatic` before a request ever reaches the server whose `prepare()`
 *     rejected. So a refusal here keeps every PAGE from loading a poisoned
 *     bundle, but the chunks themselves stay fetchable — the real reason
 *     `NEXT_PUBLIC_TEST_HOOKS` has to be refused at BUILD time, not here.
 *     (Measured with `next start`. What Vercel's own routing serves from a
 *     deployment whose functions refuse was not observed.)
 *   - **A request that arrives while this is still running is HELD, not
 *     failed.** `start-server.js` awaits its handlers and `handleRequest`
 *     awaits `prepare()`, so the request is answered once `register()`
 *     settles — by the route if it resolved, with a 500 if it threw. Before
 *     the port is bound, a connection is refused. A healthy server therefore
 *     never answers 500 on its way up — none in some 2 700 answers per
 *     server, polled from the moment of spawn — and a 500 from `/api/health`
 *     (which itself only ever returns 200 or 503) is a verdict, not a race.
 *
 * And one about the CLI: **`next` defaults `NODE_ENV` to `production` for
 * every command but `dev`** (`dist/bin/next`, only when the variable is
 * unset). Every `next start` is therefore "production" to `lib/env.ts` — CI's
 * boot check, Playwright, Lighthouse and perf included. That is why the three
 * test flags are refused on `VERCEL_ENV` being set and not on `isProduction`.
 *
 * `NEXT_RUNTIME` is `nodejs` under the CLI and `edge` for the edge compilation
 * of this same file; the guard keeps zod — and a `process.env` read that means
 * nothing there — out of the edge bundle. The import is dynamic for the same
 * reason.
 *
 * **The one line this prints, and why.** A server that passed the contract and
 * a server whose bundle never contained this hook look identical from outside:
 * both answer 200. Next loads the hook from its own build output and treats a
 * missing file as "no instrumentation", without a word in the log. So on a
 * deployment — `VERCEL_ENV` set — a successful check says so, once per
 * process (one line per `next start`, measured; on Vercel that should mean one
 * per function instance, which was not observed), and the runtime log is where
 * to look for it. Nothing is printed for a local or CI server: there the line
 * would be noise in every Playwright run.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("@/lib/env");
  const env = getEnv();
  if (env.VERCEL_ENV) {
    console.info(`[env] contract enforced (VERCEL_ENV=${env.VERCEL_ENV})`);
  }
}
