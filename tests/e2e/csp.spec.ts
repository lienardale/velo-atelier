/**
 * Content-Security-Policy, on the real header of a real production build
 * (§5.2, §1.3).
 *
 * `tests/security/csp-header.test.ts` pins the policy string character for
 * character and runs in milliseconds. This file answers the two questions that
 * one cannot: **does the server actually send it**, on a static route and on a
 * dynamic one, and **is the promise the policy makes true of the bundle it
 * protects**.
 *
 * That promise is `script-src` without `'unsafe-eval'`. It holds only because
 * MDX is compiled to JavaScript at build time by content-collections and
 * rendered in React Server Components, so no guide body is ever evaluated in a
 * browser (§5.2). The day a dependency ships `new Function(…)` in a client
 * chunk, the policy stops being a description of the site and becomes a
 * promise the site breaks at runtime — visibly, as a blank page. So the last
 * test greps the built client bundle, which is what `scripts/bundle-guard.ts`
 * does after every build; here it runs against the same `.next` the browser
 * above was served from.
 *
 * Both routes are named by §5.2: `/fr` is statically prerendered and `/fr/velo/demo`
 * is server-rendered per request (`.debug/006`), and a header served by one
 * path and not the other is exactly the kind of gap a single-route check
 * misses.
 *
 * The policy is IMPORTED, never retyped. A copy here would pass forever while
 * the real one drifted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { contentSecurityPolicy } from "../../lib/security/csp";

import { expect, href, test } from "./_fixtures";

/**
 * Playwright runs `next start`, i.e. `NODE_ENV=production`, so this is the
 * exact string the server must send — the nonce-free, eval-free one.
 */
const PRODUCTION_POLICY = contentSecurityPolicy("production");

const ROUTES = [
  { label: "/fr (static)", path: href("fr", "/") },
  { label: "/fr/velo/demo (dynamic)", path: href("fr", "/velo/[id]", { id: "demo" }) },
] as const;

for (const route of ROUTES) {
  test(`serves the exact production CSP on ${route.label}`, async ({ request }) => {
    const response = await request.get(route.path);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toBe(PRODUCTION_POLICY);
  });
}

test("the served policy has no eval and no nonce", async ({ request }) => {
  // Spelled out rather than implied by the equality above, because these two
  // are the reasons the policy is shaped the way it is: `'unsafe-eval'` would
  // undo the build-time MDX compilation (§5.2), and a nonce would force every
  // route dynamic (§1.3).
  for (const route of ROUTES) {
    const csp = (await request.get(route.path)).headers()["content-security-policy"] ?? "";

    expect(csp, route.label).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp, route.label).not.toContain("unsafe-eval");
    expect(csp, route.label).not.toContain("nonce-");
    expect(csp, route.label).toContain("frame-ancestors 'none'");
    expect(csp, route.label).toContain("object-src 'none'");
  }
});

/* eslint-disable security/detect-non-literal-fs-filename -- fixed paths under .next/static */
function clientChunks(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return clientChunks(path);
    // `.map` files ship source text, not code a browser executes.
    return /\.m?js$/.test(entry) ? [path] : [];
  });
}

test("no runtime evaluator ships to the browser", async () => {
  const root = join(process.cwd(), ".next", "static");
  const files = clientChunks(root);

  // If this is empty the test proves nothing, so say so rather than pass.
  expect(
    files.length,
    `no client chunks under ${root} — run \`npm run build\` first`,
  ).toBeGreaterThan(0);

  const offenders = files.filter((file) => /\bnew Function\s*\(/.test(readFileSync(file, "utf8")));

  expect(
    offenders.map((file) => file.slice(root.length + 1)),
    "a client chunk builds functions from strings; script-src has no 'unsafe-eval'",
  ).toEqual([]);
});
/* eslint-enable security/detect-non-literal-fs-filename */
