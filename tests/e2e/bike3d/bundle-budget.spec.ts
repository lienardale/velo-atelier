/**
 * The lazy 3D chunk budget (§3.4, §7.3): JavaScript downloaded between the
 * navigation and `__va.bike.ready` that the server HTML did not reference —
 * three + fiber + the drei subset + parts — must stay under
 * `perf.budgets.json#lazy3dChunkGzipBytes` (transfer sizes, compressed).
 */
import budgets from "../../../perf.budgets.json";
import { expect, test } from "../_fixtures";
import { openViewer, waitReady } from "./_viewer";

test("the lazy 3D chunk fits its budget @webgl", async ({ page, isMobile }) => {
  test.skip(isMobile, "measured once, on desktop");
  const scripts: Array<{ url: string; bytes: Promise<number> }> = [];
  let documentHtml = "";
  page.on("response", (response) => {
    const url = response.url();
    if (response.request().resourceType() === "document" && url.includes("/dev/bike3d")) {
      documentHtml = "pending";
      void response.text().then((text) => (documentHtml = text));
    }
    if (url.endsWith(".js") || response.headers()["content-type"]?.includes("javascript")) {
      scripts.push({
        url,
        bytes: response
          .request()
          .sizes()
          .then((s) => s.responseBodySize),
      });
    }
  });

  await openViewer(page, "fr");
  await waitReady(page);
  await expect.poll(() => documentHtml !== "pending" && documentHtml.length > 0).toBe(true);

  let lazyBytes = 0;
  const lazy: string[] = [];
  for (const script of scripts) {
    const path = new URL(script.url).pathname;
    if (documentHtml.includes(path)) continue;
    lazyBytes += await script.bytes;
    lazy.push(`${path} ${await script.bytes}`);
  }
  test
    .info()
    .annotations.push({ type: "lazy-3d-bytes", description: `${lazyBytes} B\n${lazy.join("\n")}` });
  expect(lazy.length).toBeGreaterThan(0);
  expect(lazyBytes).toBeLessThanOrEqual(budgets.lazy3dChunkGzipBytes);
});
