/**
 * Shared helpers of the bike3d e2e specs: open the dev harness, wait for the
 * canvas, click a part where a click really lands (via `window.__va`), watch
 * for RSC round-trips.
 *
 * The dev pages exist only with ENABLE_TEST_PAGES=1 (set by playwright.config's
 * web server) and `window.__va` only in a NEXT_PUBLIC_TEST_HOOKS=1 build.
 */
import type { Page } from "@playwright/test";

import frParts from "../../../messages/fr/parts.json";
import enParts from "../../../messages/en/parts.json";
import { POSE_NAMES } from "../../../lib/bike3d/focus";
import { expect, href, type Locale } from "../_fixtures";

/** Whole-bike poses first, then close-ups (lib/bike3d/focus.ts). */
export const POSES = POSE_NAMES;

const PART_LABELS: Record<Locale, Record<string, { label: string }>> = {
  fr: frParts as unknown as Record<string, { label: string }>,
  en: enParts as unknown as Record<string, { label: string }>,
};

export function partLabel(locale: Locale, id: string): string {
  const entry = Object.hasOwn(PART_LABELS[locale], id) ? PART_LABELS[locale][id] : undefined;
  if (!entry) throw new Error(`no label for ${id}`);
  return entry.label;
}

export async function openViewer(
  page: Page,
  locale: Locale,
  query: Record<string, string> = {},
  path: "/dev/bike3d" | "/dev/bike3d-perf" = "/dev/bike3d",
): Promise<void> {
  const search = Object.keys(query).length > 0 ? query : undefined;
  await page.goto(href(locale, path, {}, search));
  await expect(page.getByTestId("bike3d-viewer")).toBeVisible();
}

/** Wait for the 3D canvas to be mounted, compiled and drawn. */
export async function waitReady(page: Page): Promise<void> {
  await page.getByTestId("bike3d-viewer").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__va?.bike.ready === true, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("bike3d-viewer")).toHaveAttribute("data-state", "ready");
}

export async function selectedPartId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__va?.bike.selectedPartId ?? null);
}

/**
 * Move the camera to a pose from which `id` can be clicked and return the
 * point, or null when no pose shows it.
 */
export async function pointFor(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ id, poses }) => {
      const bike = window.__va!.bike;
      const here = bike.screenPositionOf(id);
      if (here) return here;
      for (const pose of poses) {
        const found = bike.hittable(pose);
        if (Object.hasOwn(found, id)) return bike.screenPositionOf(id);
      }
      return null;
    },
    { id, poses: [...POSES] },
  );
}

/** Click (mouse) or tap (touch) the canvas on `id`. */
export async function clickPart(page: Page, id: string): Promise<void> {
  const point = await pointFor(page, id);
  expect(point, `${id} is not clickable from any pose`).not.toBeNull();
  const hasTouch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (hasTouch) await page.touchscreen.tap(point!.x, point!.y);
  else await page.mouse.click(point!.x, point!.y);
}

/**
 * RSC fetches (`?_rsc=`) collected from now on — what a selection written
 * through the router (`router.replace`) would cost.
 *
 * `onlyViewerPage`: count only fetches of the viewer page itself. Use it when
 * the test scrolls (keyboard focus down a long list): Next prefetches the
 * footer's links as they enter the viewport, which is not selection traffic.
 */
export function watchRsc(page: Page, { onlyViewerPage = false } = {}): string[] {
  const urls: string[] = [];
  const viewerPath = new URL(page.url()).pathname;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.searchParams.has("_rsc")) return;
    if (onlyViewerPage && url.pathname !== viewerPath) return;
    urls.push(request.url());
  });
  return urls;
}

export async function scrollViewerIntoView(page: Page): Promise<void> {
  await page
    .getByTestId("bike3d-viewer")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
}
