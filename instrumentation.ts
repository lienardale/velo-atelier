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
 *   - **A throw here stops the server SERVING, but does not kill it** —
 *     measured on 16.3.4, not assumed. `prepareImpl()` awaits `register()`,
 *     but `NextNodeServer`'s constructor fires
 *     `this.prepare().catch(err => console.error('Failed to prepare server', err))`,
 *     so that rejection is logged and swallowed there;
 *     `server/lib/start-server.js` sees `initialize()` resolve and never
 *     reaches its `process.exit(1)`. The socket stays bound and the
 *     per-request `await` of the same rejected promise makes EVERY request a
 *     500, for as long as the process lives. Loud and total — nothing is ever
 *     served — but there is no exit code to read, which is why
 *     `scripts/ci/build.sh`'s boot check (curl `/api/health`) is what catches
 *     it in CI, and why `tests/boot/env-contract.test.ts` samples the status
 *     instead of waiting for an exit. It also means the socket is bound before
 *     this has run at all, so a request in that window gets a 500 on a server
 *     that is perfectly fine: never read one 500 as a verdict.
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
