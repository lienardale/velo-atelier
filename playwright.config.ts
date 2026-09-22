/**
 * Playwright — the browser tiers (§7.2).
 *
 * Runs against a PRODUCTION build (`next start`), never `next dev`: build
 * first with
 *
 *   ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh
 *
 * — not a bare `npm run build`, which bakes `.env.local`'s `:3000` origin into
 * the canonicals that `seo.spec.ts` checks against the `:3100` served here.
 * `NEXT_PUBLIC_TEST_HOOKS` compiles the `window.__va` hooks into the bundle
 * (build-time gate); `ENABLE_TEST_PAGES` is read per request by the
 * `force-dynamic` dev pages, so the web server below sets it again. In CI the
 * build job uploads `.next` and every e2e matrix leg downloads it.
 *
 * Project matrix — CI runs one project per job (scripts/ci/e2e.sh):
 *
 *   desktop-chromium   Desktop Chrome, WebGL (SwiftShader)                 blocking
 *   mobile-chromium    Pixel 7, touch, WebGL                               blocking
 *   mobile-landscape   844×390, touch, WebGL                               blocking
 *   mobile-narrow      320×568, touch, WebGL — a subset of specs           blocking
 *   no-webgl           Desktop Chrome with WebGL disabled                  blocking
 *   mobile-webkit      iPhone 14 (Linux WebKit ≠ iOS Safari)               NON-blocking
 *   perf, perf-mobile  tests/perf, one worker, no retries                  hard counters
 *
 * Chromium in CI has no GPU: `--use-gl=angle --use-angle=swiftshader` renders
 * WebGL in software, `--enable-unsafe-swiftshader` keeps it available now that
 * Chrome no longer falls back to SwiftShader silently, and
 * `--ignore-gpu-blocklist` stops the blocklist from vetoing it. Frame time is
 * therefore advisory; draw calls and triangles are the hard gate (§3.4).
 *
 * Verified with @playwright/test 1.63.0 (installed): project-level `workers`
 * exists; `devices["Pixel 7"]` = 412×839 chromium, `devices["iPhone 14"]` =
 * 390×664 webkit; `--list` loads the config without running the global setup
 * or the web server.
 */
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

import type { E2EOptions } from "./tests/e2e/_fixtures";

/**
 * Captured BEFORE `.env.test` is merged in: that file pins both URLs to :3100,
 * so after `loadEnv` there is no way to tell "the operator asked for this URL"
 * from "the committed default". A worktree running on PLAYWRIGHT_PORT=3101 that
 * inherited the file's :3100 would serve on one port and mint Auth.js callbacks
 * for another — every sign-in redirect lands on the other worktree's server.
 */
const shellUrls = {
  auth: process.env.AUTH_URL,
  site: process.env.NEXT_PUBLIC_SITE_URL,
};

// Shell / CI `env:` wins over the committed file (override: false).
loadEnv({ path: ".env.test", override: false, quiet: true });

const CI = Boolean(process.env.CI);
// PLAYWRIGHT_PORT lets parallel runs (one per worktree) use separate servers.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

const chromiumGL = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

/** Specs that also run at 320 px (§7.2). */
const NARROW_SPECS =
  /(^|\/)(smoke|mobile-sheet|checkup\.mobile|auth\.mobile|build-list)\.spec\.ts$/;

/**
 * `@snapshot` (tests/e2e/visual.spec.ts) has baselines for desktop-chromium and
 * mobile-chromium ONLY — `perf.yml`'s read-only `record-snapshots` job records
 * those two, and `update-snapshots` opens them as a PR.
 * Every other project inverts the tag: a missing baseline is written and failed,
 * so a third project running it would be red on every run.
 */
const SNAPSHOT = /@snapshot/;

/**
 * Added on top of the runner's own environment — Playwright 1.63 launches the
 * web server with `{ ...process.env, ...webServer.env }`, and `process.env`
 * already holds `.env.test` (database URLs, AUTH_SECRET, …) from the line above.
 */
const serverEnv: Record<string, string> = {
  PORT: String(PORT),
  // Derived from PORT unless the shell asked for something else (a tunnel, a
  // preview deployment); `.env.test`'s :3100 never wins over PLAYWRIGHT_PORT.
  AUTH_URL: shellUrls.auth ?? BASE_URL,
  NEXT_PUBLIC_SITE_URL: shellUrls.site ?? BASE_URL,
  ENABLE_TEST_PAGES: "1",
  NEXT_PUBLIC_DEMO_LOGIN: "1",
};

type Project = NonNullable<PlaywrightTestConfig<E2EOptions>["projects"]>[number];

const e2eProjects: Project[] = [
  {
    name: "desktop-chromium",
    use: { ...devices["Desktop Chrome"], launchOptions: { args: chromiumGL } },
  },
  {
    name: "mobile-chromium",
    use: { ...devices["Pixel 7"], hasTouch: true, launchOptions: { args: chromiumGL } },
  },
  {
    name: "mobile-landscape",
    grepInvert: SNAPSHOT,
    use: {
      ...devices["Pixel 7 landscape"],
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      launchOptions: { args: chromiumGL },
    },
  },
  {
    name: "mobile-narrow",
    testMatch: NARROW_SPECS,
    grepInvert: SNAPSHOT,
    use: {
      ...devices["Pixel 7"],
      viewport: { width: 320, height: 568 },
      deviceScaleFactor: 2,
      hasTouch: true,
      launchOptions: { args: chromiumGL },
    },
  },
  {
    name: "no-webgl",
    // Specs tagged @webgl assert on the 3D canvas; here the SVG fallback is the product.
    grepInvert: [/@webgl/, SNAPSHOT],
    use: {
      ...devices["Desktop Chrome"],
      webgl: false,
      launchOptions: { args: ["--disable-webgl", "--disable-webgl2"] },
    },
  },
  {
    name: "mobile-webkit",
    // Non-blocking (continue-on-error in CI): validates layout, touch and the
    // fallback. Never a screenshot baseline, never a perf number.
    retries: 2,
    grepInvert: [SNAPSHOT, /@perf/],
    use: { ...devices["iPhone 14"] },
  },
];

/**
 * `RUN_LOCAL_PERF=1` (`npm run perf:local`, docs/bike3d-perf.md): the perf
 * projects render on the machine's GPU instead of SwiftShader, and the soft
 * tier becomes the 16.7 ms gate. Verified on an M2 with Playwright 1.63.0
 * (2026-09-21): headless Chromium reports "ANGLE Metal Renderer: Apple M2" with
 * `--ignore-gpu-blocklist --enable-gpu`, and falls back to SwiftShader without
 * them — so no headed window is needed. `PERF_HEADED=1` opens one anyway, for
 * a machine whose headless mode has no GPU; the spec refuses to pass on
 * SwiftShader, so a wrong setup fails loudly instead of measuring the CPU.
 */
const LOCAL_GPU = process.env.RUN_LOCAL_PERF === "1";
const perfGL = LOCAL_GPU ? ["--ignore-gpu-blocklist", "--enable-gpu"] : chromiumGL;
const perfHeadless = !(LOCAL_GPU && process.env.PERF_HEADED === "1");

const perfProjects: Project[] = [
  {
    name: "perf",
    testDir: "tests/perf",
    workers: 1,
    retries: 0,
    use: {
      ...devices["Desktop Chrome"],
      headless: perfHeadless,
      launchOptions: { args: perfGL },
    },
  },
  {
    name: "perf-mobile",
    testDir: "tests/perf",
    workers: 1,
    retries: 0,
    use: {
      ...devices["Pixel 7"],
      hasTouch: true,
      headless: perfHeadless,
      launchOptions: { args: perfGL },
    },
  },
];

export default defineConfig<E2EOptions>({
  testDir: "tests/e2e",
  outputDir: "test-results",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: CI,
  // One retry on CI absorbs SwiftShader hiccups and is reported as "flaky";
  // locally a failure is a failure.
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", threshold: 0.3 },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    env: serverEnv,
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [...e2eProjects, ...perfProjects],
});
