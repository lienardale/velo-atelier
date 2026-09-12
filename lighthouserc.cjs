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

const URLS = [
  "/fr",
  "/en",
  "/fr/velo/demo",
  "/en/bike/demo",
  "/fr/guides/check-brakes-disc",
  "/en/guides/check-brakes-disc",
  "/fr/connexion",
  "/fr/acheter",
].map((path) => `${BASE_URL}${path}`);

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

/** Bike pages: a WebGL canvas rendered in software. */
const bikeAssertions = {
  ...contentAssertions,
  "categories:performance": ["error", { minScore: 0.7 }],
  "largest-contentful-paint": ["error", { maxNumericValue: 3000 }],
  "total-blocking-time": ["error", { maxNumericValue: 600 }],
  // Home first-load (≈130 kB gzip) + the lazy 3D chunk (≤400 kB gzip) + slack.
  // resource-summary reports transfer size, so this is the gzipped total.
  "resource-summary:script:size": ["error", { maxNumericValue: 560000 }],
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
        // Auth and analytics are out of scope for a Lighthouse pass.
        skipAudits: ["uses-http2"],
      },
    },
    assert: {
      // Median of the runs, so one slow cold start cannot fail a PR.
      aggregationMethod: "median",
      assertMatrix: [
        {
          matchingUrlPattern: ".*/(velo|bike)/.*",
          assertions: bikeAssertions,
        },
        {
          matchingUrlPattern: ".*",
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
