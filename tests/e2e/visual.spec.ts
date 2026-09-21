/**
 * Visual regression (§7.2, §3.5, §3.6 AC6) — every test here is `@snapshot`.
 *
 * Two families of baselines, ≥ 16 files between them:
 *
 *   - **the 3D bike**: each of the 7 presets (`lib/domain/data/presets.ts`)
 *     through the dev harness `/dev/bike3d?preset=`, on desktop-chromium and
 *     mobile-chromium — 14 images of the canvas, `maxDiffPixelRatio` 0.02;
 *   - **DOM pages**, in French AND English, on mobile-chromium — the home page,
 *     a guide and the checkup's tool list, `maxDiffPixelRatio` 0.03.
 *
 * Every image is taken under `colorScheme: 'light'` and `reducedMotion:
 * 'reduce'`: no camera transition, no fade, no quality governor (§3.3), so the
 * canvas is drawn from one fixed pose; `__va.perf.renderFrames(3)` makes sure
 * the demand frameloop has drawn it before the shot.
 *
 * BASELINES ARE LINUX-RENDERED (§7.2). SwiftShader's WebGL and Linux's font
 * rasterisation are what CI's Playwright container produces; an image from a
 * Mac would fail everyone else. So this file skips unless it runs on Linux:
 * the macOS host matrix stays green, while CI's Linux legs and
 * `npm run e2e:docker -- --grep @snapshot` compare against the committed
 * images. They are (re)generated only by `perf.yml`'s `update-snapshots` job
 * (`workflow_dispatch`, `update_snapshots=true`), which opens a PR labelled
 * `visual-baseline`; the `visual-baseline-guard` workflow refuses a change to
 * `tests/e2e/__screenshots__/**` that is not labelled so.
 *
 * Every OTHER project inverts `@snapshot` (playwright.config.ts): only these
 * two have baselines, and a missing baseline is written and failed.
 *
 * Locales: the canvas draws no text, so the preset images are taken once, on
 * the French harness — an English run would render the same pixels again. The
 * DOM pages are where the two locales differ, and each is taken in both.
 */
import type { Locator, Page } from "@playwright/test";

import { PRESET_IDS } from "../../lib/domain/data/presets";

import { expect, forEachLocale, href, test, type RouteKey } from "./_fixtures";
import { openViewer, waitReady } from "./bike3d/_viewer";

test.skip(process.platform !== "linux", "baselines are Linux-rendered (§7.2)");

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});

/** React has taken the element over: a prerendered page is drawn before it listens. */
async function hydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
}

// ─────────────────────────────────────────────────────────── the 3D bike ──

for (const preset of PRESET_IDS) {
  test(`3D: the ${preset} preset @snapshot @webgl`, async ({ page }) => {
    await openViewer(page, "fr", { preset });
    await waitReady(page);
    await page.evaluate(() => window.__va!.perf.renderFrames(3));

    await expect(page.getByTestId("bike3d-canvas")).toHaveScreenshot(`${preset}.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}

// ─────────────────────────────────────────────────────────── DOM pages ──

interface DomPage {
  name: string;
  key: RouteKey;
  params?: Record<string, string>;
  /** What must be true before the page is worth a picture. */
  settled(page: Page): Promise<void>;
}

const DOM_PAGES: readonly DomPage[] = [
  {
    // The landing page: hero, the tree's first question, features, featured guides.
    name: "home",
    key: "/",
    async settled(page) {
      await expect(page.getByTestId("decision-tree")).toHaveAttribute("data-hydrated", "true");
    },
  },
  {
    // A full guide: MDX prose, numbered illustrations with their legends, callouts.
    name: "guide",
    key: "/guides/[slug]",
    params: { slug: "check-brakes-disc" },
    async settled(page) {
      await hydrated(page.getByRole("heading", { level: 1 }).first());
    },
  },
  {
    // The checkup wizard's first screen: the tool list with its checkbox rows.
    name: "checkup",
    key: "/velo/[id]/controle",
    params: { id: "demo" },
    async settled(page) {
      await expect(page.getByTestId("tool-checklist")).toBeVisible();
      await hydrated(page.getByTestId("checkup-start"));
    },
  },
];

forEachLocale((locale) => {
  for (const dom of DOM_PAGES) {
    test(`page: ${dom.name} (${locale}) @snapshot`, async ({ page, isMobile }) => {
      test.skip(!isMobile, "DOM pages are baselined on mobile only (§7.2)");
      await page.goto(href(locale, dom.key, dom.params));
      await dom.settled(page);

      await expect(page).toHaveScreenshot(`${dom.name}-${locale}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });
  }
});
