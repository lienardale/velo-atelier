/**
 * Boot hook — the one caller of `getEnv()`.
 *
 * `lib/env.ts` has declared the environment contract since W0 and, until W5,
 * nothing ran it outside its own unit test: a typo in the Vercel dashboard
 * still surfaced at 2 a.m. as an `undefined` deep inside Auth.js. This file is
 * what turns that declaration into a boot failure carrying the variable's name.
 *
 * Three facts about Next 16.3.4 shape it, all read off the installed package:
 *
 *   - **`register()` does not run during `next build`.**
 *     `server/lib/router-utils/instrumentation-globals.external.js` returns
 *     early when `NEXT_PHASE=phase-production-build`. A build therefore still
 *     needs no database URL and no production secret — the property
 *     `lib/env.ts`'s header promises — and the BUILD-time half of the contract
 *     (`NEXT_PUBLIC_TEST_HOOKS`, which the bundler inlines and no runtime check
 *     can take back) has to be guarded in `scripts/vercel-build.sh` instead.
 *   - **On `next start` it is awaited before the server takes requests**
 *     (`next-server.js` `prepareImpl()`), and a throw reaches
 *     `server/lib/start-server.js`, which prints it and calls
 *     `process.exit(1)`. The socket binds before init, so a request landing in
 *     that race window gets a 500 rather than a refused connection;
 *     `tests/boot/env-contract.test.ts` asserts on the exit code and the
 *     printed error, never on a connection failing.
 *   - **The `next` CLI defaults `NODE_ENV` to `production` for every command
 *     but `dev`** (`dist/bin/next`). Every `next start` is therefore
 *     "production" to `lib/env.ts` — CI's boot check, Playwright, Lighthouse
 *     and perf included. That is why the three test flags are refused on
 *     `VERCEL_ENV` being set and not on `isProduction`.
 *
 * `NEXT_RUNTIME` is `nodejs` under the CLI and `edge` for the edge compilation
 * of this same file; the guard keeps zod — and a `process.env` read that means
 * nothing there — out of the edge bundle. The import is dynamic for the same
 * reason.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("@/lib/env");
  getEnv();
}
