/**
 * Lighthouse CI.
 *
 * Run: `npm run lhci` (after `npm run build`), or the `lighthouse` job, which
 * calls scripts/ci/lighthouse.sh.
 *
 * Two things make this configuration unusual:
 *
 *  - **SwiftShader.** The demo-bike pages render WebGL, and a CI runner has no
 *    GPU. Without the ANGLE/SwiftShader flags Chrome falls back to "WebGL not
 *    supported" and Lighthouse measures the fallback page instead of the app.
 *    Software rasterising is slow, which is why the bike routes carry their own,
 *    looser thresholds rather than dragging the whole site's budget down.
 *
 *  - **Two budgets, not one.** `/fr` and a guide page are content pages and are
 *    held to a real Core Web Vitals bar; `/fr/velo/demo` is an interactive 3D
 *    canvas and is held to a bar that a 3D canvas can actually meet.
 *
 * Numbers below are the plan's §7.3 values. `assertMatrix` order matters: the
 * first `matchingUrlPattern` that matches a URL wins.
 */
const GL_FLAGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  // Containers run as root; Chrome refuses its sandbox there.
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

const BASE_URL = process.env.LHCI_BASE_URL || "http://localhost:3100";

/**
 * Every URL the plan audits, each with the route file that must exist first.
 * Waves land routes one at a time (/velo in W2, /acheter in W3): auditing a route
 * that does not exist yet 404s and fails the job (it did on the W1 push). A URL is
 * audited as soon as its route file appears — no edit here when a wave lands.
 */
// lhci loads this file as CommonJS: `require` is the only import form it can use.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const ROUTES = [
  ["/fr", "app/[locale]/page.tsx"],
  ["/en", "app/[locale]/page.tsx"],
  ["/fr/velo/demo", "app/[locale]/velo/[id]/page.tsx"],
  ["/en/bike/demo", "app/[locale]/velo/[id]/page.tsx"],
  ["/fr/guides/check-brakes-disc", "content/guides/check-brakes-disc/fr.mdx"],
  ["/en/guides/check-brakes-disc", "content/guides/check-brakes-disc/en.mdx"],
  ["/fr/connexion", "app/[locale]/(auth)/connexion/page.tsx"],
  ["/fr/acheter", "app/[locale]/acheter/page.tsx"],
];

const URLS = ROUTES.filter(([urlPath, file]) => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `file` comes from the literal ROUTES table above
  const exists = fs.existsSync(path.join(__dirname, file));
  if (!exists) console.warn(`lighthouserc: skipping ${urlPath} — ${file} does not exist yet`);
  return exists;
}).map(([urlPath]) => `${BASE_URL}${urlPath}`);

/** Content pages: the real bar. */
const contentAssertions = {
  "categories:performance": ["error", { minScore: 0.85 }],
  "categories:accessibility": ["error", { minScore: 0.95 }],
  "categories:seo": ["error", { minScore: 0.95 }],
  "categories:best-practices": ["error", { minScore: 0.9 }],
  "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
  "total-blocking-time": ["error", { maxNumericValue: 300 }],
  "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
  "unsized-images": "error",
  "errors-in-console": "warn",
};

/**
 * Sign-in / sign-up are `noindex` on purpose (tests/e2e/auth-*.spec.ts), so the SEO
 * category — dominated by `is-crawlable` — cannot and must not reach 0.95 there.
 * Everything else still applies.
 */
const authAssertions = {
  ...contentAssertions,
  "categories:seo": "off",
};

/**
 * The bike page's script ceiling, derived rather than pinned: the home route's
 * own first-load budget plus the lazy 3D chunk, both from `perf.budgets.json`,
 * which is the single source of truth for every size number.
 *
 * It used to be the literal 560000, written when home first-load was ≈130 kB.
 * W2 put the real decision tree on home and the constant went stale silently —
 * the bike page then measured 560 498 B and failed by 498 B for a reason that
 * had nothing to do with the bike page (W2 integration, 2026-09-18). Deriving
 * it means the two files cannot drift apart again.
 *
 * This is the page's TOTAL script transfer, a coarse "nothing unexpected got
 * pulled in" guard. The tight per-route ratchet on first-load JS lives in
 * `perf.budgets.json` (9 % headroom, re-pinned every wave) — that is what
 * catches a real regression on this route.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const budgets = require("./perf.budgets.json");
const BIKE_SCRIPT_CEILING =
  budgets.routes["/[locale]"].firstLoadJsGzipBytes + budgets.lazy3dChunkGzipBytes;

/** Bike pages: a WebGL canvas rendered in software. */
const bikeAssertions = {
  ...contentAssertions,
  "categories:performance": ["error", { minScore: 0.7 }],
  "largest-contentful-paint": ["error", { maxNumericValue: 3000 }],
  "total-blocking-time": ["error", { maxNumericValue: 600 }],
  // resource-summary reports transfer size, so this is the gzipped total.
  "resource-summary:script:size": ["error", { maxNumericValue: BIKE_SCRIPT_CEILING }],
  /**
   * OFF, like the auth pages above and for the same reason: §6 requires
   * `robots: { index: false, follow: false }` on every `/velo/**` route, so
   * `is-crawlable` and `canonical` score 0 by design and the category can never
   * reach 0.95. Asserting it would only ever punish the page for obeying the
   * spec. The indexable routes (home, guides) still carry the real SEO bar.
   */
  "categories:seo": "off",
};

module.exports = {
  ci: {
    collect: {
      url: URLS,
      // The production server, not `next dev`: dev builds are unminified and
      // their numbers mean nothing.
      startServerCommand: "npm run start -- -p 3100",
      startServerReadyPattern: "Ready in|started server on|Local:",
      startServerReadyTimeout: 60000,
      numberOfRuns: Number(process.env.LHCI_NUMBER_OF_RUNS || 3),
      settings: {
        preset: "desktop" === process.env.LHCI_PRESET ? "desktop" : undefined,
        // Mobile is the default form factor: this site is used with a phone in
        // one hand and a 5 mm Allen key in the other.
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 915,
          deviceScaleFactor: 2.625,
          disabled: false,
        },
        chromeFlags: GL_FLAGS.join(" "),
        // Applied ("devtools") throttling, not Lighthouse's default simulation. Same
        // mobile network and 4x CPU profile, but the browser really runs under it.
        // Measured on W1's content pages (.debug/003): simulated LCP 3.6 s vs applied
        // LCP 1.5-1.6 s (TBT 20-30 ms, perf 0.99-1.0). Locally the first paint came
        // AFTER the JS chunks had already loaded, so the simulation hung the whole
        // script download on the LCP and replayed it over slow 4G — a model artifact
        // that tracked time-to-interactive, not what a visitor sees. The thresholds
        // stay exactly as §7 sets them; the three runs + median absorb the extra
        // variance of applied throttling.
        throttlingMethod: "devtools",
        // Auth and analytics are out of scope for a Lighthouse pass.
        skipAudits: ["uses-http2"],
      },
    },
    assert: {
      // LHCI refuses any other assert option next to `assertMatrix` ("Cannot use
      // assertMatrix with other options"), so each entry carries its own
      // aggregation: the median of the runs, so one slow cold start cannot fail a PR.
      assertMatrix: [
        {
          matchingUrlPattern: ".*/(velo|bike)/.*",
          aggregationMethod: "median",
          assertions: bikeAssertions,
        },
        {
          matchingUrlPattern: ".*/(connexion|sign-in|inscription|sign-up)(\\?.*)?$",
          aggregationMethod: "median",
          assertions: authAssertions,
        },
        {
          // Everything EXCEPT the 3D and auth pages: LHCI applies EVERY matching
          // entry, so a plain `.*` would hold those pages to this bar as well.
          matchingUrlPattern:
            "^(?!.*/(velo|bike)/)(?!.*/(connexion|sign-in|inscription|sign-up)(\\?.*)?$).*$",
          aggregationMethod: "median",
          assertions: contentAssertions,
        },
      ],
    },
    upload: {
      // No LHCI server: the assertion results are the gate and the
      // `.lighthouseci/` directory is uploaded as a workflow artifact.
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
