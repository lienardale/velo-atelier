/**
 * The runtime gate of the dev pages (`/dev/bike3d`, `/dev/bike3d-perf`).
 *
 * They exist only when `ENABLE_TEST_PAGES=1` is set on the RUNNING server
 * (the e2e / perf web server), read per request: both pages export
 * `dynamic = "force-dynamic"` and `await connection()` first, so the value is
 * never frozen into a prerendered page at build time. Anything but the exact
 * string "1" is off — `tests/security/dev-pages-gated.test.ts`.
 */
export function testPagesEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.ENABLE_TEST_PAGES === "1";
}
