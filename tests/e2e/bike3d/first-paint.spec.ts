/**
 * First paint (§3.3 Loading): the server HTML carries the SVG bike (the LCP
 * element) inside a box whose size is reserved before any script runs; the 3D
 * canvas then fades in over it without moving anything (CLS 0).
 */
import type { Page } from "@playwright/test";

import { expect, forEachLocale, href, test } from "../_fixtures";
import { openViewer, waitReady } from "./_viewer";

/** The SVG's box in DOCUMENT coordinates (independent of the scroll position). */
function documentBox(page: Page) {
  return page.getByTestId("bike3d-svg").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

forEachLocale((locale) => {
  test(`SVG first, then the canvas fades in without layout shift (${locale}) @webgl`, async ({
    page,
    request,
  }) => {
    const html = await (await request.get(href(locale, "/dev/bike3d"))).text();
    expect(html).toContain('data-testid="bike3d-svg"');
    expect(html).not.toContain("<canvas");

    // Record layout shifts from the very start.
    await page.addInitScript(() => {
      (window as Window & { __cls?: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { value: number; hadRecentInput: boolean }
        >) {
          if (!entry.hadRecentInput) (window as Window & { __cls?: number }).__cls! += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await openViewer(page, locale);
    const svg = page.getByTestId("bike3d-svg");
    await expect(svg).toBeVisible();
    const boxBefore = await documentBox(page);

    await waitReady(page);
    await expect(page.getByTestId("bike3d-canvas")).toBeVisible();
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(svg).toHaveCSS("opacity", "0");
    const boxAfter = await documentBox(page);
    expect(boxAfter).toEqual(boxBefore);

    const cls = await page.evaluate(() => (window as Window & { __cls?: number }).__cls ?? 0);
    expect(cls).toBeLessThan(0.01);
  });
});
