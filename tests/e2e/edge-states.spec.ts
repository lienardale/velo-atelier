/**
 * The empty and edge states of §6.7 — one `test()` per row of that table,
 * titled with the row text, so the table and this file can be read side by side
 * (§6.8 AC13).
 *
 * Several of these behaviours are also exercised in passing by the spec that
 * owns the feature (`part-panel` visits `/velo/local`, `guides-filter` empties
 * the filter). That duplication is the point: §6.7 is a list of promises about
 * what happens when there is *nothing to show*, and a promise nobody checks as
 * a promise is one that quietly stops being kept when the feature around it is
 * rewritten.
 *
 * Three rows depend on routes W3-T1 and W3-T2 are building in parallel
 * (`/velo/demo/controle`, `/velo/demo/liste`) and a fourth completes a checkup
 * without WebGL. They are written in full here and are red until those branches
 * land; they are asserted against the published contracts — `lib/checkup/types.ts`,
 * `lib/bike/storage-keys.ts`, `routing.pathnames` — and never against invented
 * test ids.
 */
/* eslint-disable security/detect-non-literal-regexp -- locale-keyed message fixtures and patterns built from paths this file computed itself */
import type { Page } from "@playwright/test";

import { buildListKey } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { routing, type Pathname } from "../../lib/i18n/routing";
import enBike from "../../messages/en/bike.json";
import enCommon from "../../messages/en/common.json";
import enGuides from "../../messages/en/guides.json";
import frBike from "../../messages/fr/bike.json";
import frCommon from "../../messages/fr/common.json";
import frGuides from "../../messages/fr/guides.json";
import frAuth from "../../messages/fr/auth.json";
import frTree from "../../messages/fr/decision-tree.json";

import { expect, href, test, type Locale, type RouteKey } from "./_fixtures";
import { seedLocalBike } from "./_local-bike";

const BIKE_T: Record<Locale, typeof frBike> = { fr: frBike, en: enBike };
const COMMON_T: Record<Locale, typeof frCommon> = { fr: frCommon, en: enCommon };
const GUIDES_T: Record<Locale, typeof frGuides> = { fr: frGuides, en: enGuides };

/** A well-formed v4 UUID that belongs to nobody in this run. */
const FOREIGN_BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Every `/velo/[id]…` key of the routing table — the page and its sub-routes. */
const BIKE_ROUTES = (Object.keys(routing.pathnames) as Pathname[]).filter((key) =>
  key.startsWith("/velo/[id]"),
);

/** The params a `/velo/[id]…` key needs, for the given bike. */
function bikeParams(key: Pathname, id: string): Record<string, string> {
  return key.includes("[partId]") ? { id, partId: "saddle" } : { id };
}

/** The bottom sheet holds the panel below 1024 px; open it fully first. */
async function expandSheetIfPresent(page: Page): Promise<void> {
  const handle = page.locator("[data-testid=parts-sheet] [data-slot=mobile-sheet-handle]");
  if ((await handle.count()) === 0) return;
  await handle.focus();
  await page.keyboard.press("End");
}

// ────────────────────────────────────────────────────────────────── row 1 ──

test("/velo/local without storage → / + toast", async ({ page }) => {
  // Nothing is seeded: this is a visitor who typed the URL, or came back after
  // clearing their browser data.
  await page.goto(href("fr", "/velo/[id]", { id: "local" }));

  await expect(page).toHaveURL(new RegExp("/fr(\\?.*)?$"));
  // The redirect alone is indistinguishable from a broken link — the toast is
  // what tells them why they are looking at the front page.
  await expect(page.getByText(BIKE_T.fr.canvas.emptyToast)).toBeVisible();
});

// ────────────────────────────────────────────────────────────────── row 2 ──

test("/velo/<other-user-uuid> and sub-routes → 404 (never 403)", async ({
  request,
  signedInContext,
}) => {
  // Signed in as somebody: a 403 would confirm the id exists, which is the
  // whole reason §4.7 says 404 (`lib/bike/load-bike.ts`).
  await signedInContext();

  for (const key of BIKE_ROUTES) {
    const foreign = await request.get(href("fr", key as RouteKey, bikeParams(key, FOREIGN_BIKE)));
    expect(foreign.status(), `${key} for another user's bike`).toBe(404);
    expect(foreign.status(), `${key} must never answer 403`).not.toBe(403);

    // …and the same URL on a bike this visitor may see is a 200, so the 404
    // above is about ownership and not about the route being absent.
    const own = await request.get(href("fr", key as RouteKey, bikeParams(key, "demo")));
    expect(own.status(), `${key} on the demo bike`).toBe(200);
  }
});

// ────────────────────────────────────────────────────────────────── row 3 ──

test("/velo/not-a-uuid → 404", async ({ request }) => {
  // `resolveBikeRef` accepts `demo`, `local` and a v4 UUID; everything else is
  // not a bike. The nil UUID and a v1-shaped one are the interesting refusals:
  // both would parse as "a UUID" under a looser pattern and reach a query.
  for (const id of [
    "not-a-uuid",
    "00000000-0000-0000-0000-000000000000",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  ]) {
    const response = await request.get(`/fr/velo/${encodeURIComponent(id)}`);
    expect(response.status(), `/velo/${id}`).toBe(404);
  }
});

// ────────────────────────────────────────────────────────────────── row 4 ──

test("/velo/[id]/piece/<part not on bike> → 404", async ({ request }) => {
  // The demo bike is a gravel bike: it has a saddle and no motor.
  const present = await request.get(
    href("fr", "/velo/[id]/piece/[partId]", { id: "demo", partId: "saddle" }),
  );
  expect(present.status()).toBe(200);

  for (const partId of ["e-motor", "not-a-part"]) {
    const absent = await request.get(
      href("fr", "/velo/[id]/piece/[partId]", { id: "demo", partId }),
    );
    expect(absent.status(), partId).toBe(404);
  }
});

// ────────────────────────────────────────────────────────────────── row 5 ──

test("/mes-velos empty → illustration + CTA", async ({ page, signupEmail }) => {
  // A brand-new account is the only honest way to an empty garage: the seeded
  // demo user has four bikes, and deleting them would race the other specs.
  await page.goto(href("fr", "/inscription"));
  await page.getByLabel(frAuth.fields.email, { exact: true }).fill(signupEmail);
  await page.getByLabel(frAuth.fields.password, { exact: true }).fill("Guidon-Tandem-47!");
  await page.getByRole("button", { name: frAuth.signUp.submit }).click();
  await page.waitForURL(`**${href("fr", "/mes-velos")}`);

  const empty = page.getByTestId("my-bikes-empty");
  await expect(empty).toBeVisible();
  await expect(empty.locator("svg")).toHaveCount(1);
  await expect(empty).toContainText(BIKE_T.fr.myBikes.emptyTitle);
  await expect(page.getByTestId("my-bikes-list")).toHaveCount(0);

  const cta = page.getByTestId("my-bikes-empty-cta");
  await expect(cta).toHaveText(BIKE_T.fr.myBikes.emptyCta);
  await expect(cta).toHaveAttribute("href", href("fr", "/"));
});

// ────────────────────────────────────────────────────────────────── row 6 ──

test("/velo/[id]/liste empty → CTA", async ({ page }) => {
  // No checkup has been answered, so the list is derived from nothing.
  const response = await page.goto(href("fr", "/velo/[id]/liste", { id: "demo" }));
  expect(response?.status()).toBe(200);

  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  // Nothing to buy, and no line pretending there is.
  await expect(main.getByRole("listitem")).toHaveCount(0);
  // The way out is the checkup that would fill it — asserted as a link to that
  // route rather than by a test id, so W3-T2 is free to shape the empty state.
  await expect(
    main.locator(`a[href^="${href("fr", "/velo/[id]/controle", { id: "demo" })}"]`),
  ).toBeVisible();
});

// ────────────────────────────────────────────────────────────────── row 7 ──

test("?parts= with unknown ids → dropped, none left → full checkup + info callout", async ({
  page,
}) => {
  // Half-valid first: the unknown id is dropped and the real one is kept.
  const response = await page.goto(
    href("fr", "/velo/[id]/controle", { id: "demo" }, { parts: "chain,not-a-part" }),
  );
  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-step-key]").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("not-a-part");

  // Nothing left: the scope falls back to a FULL checkup, and says so.
  await page.goto(
    href("fr", "/velo/[id]/controle", { id: "demo" }, { parts: "not-a-part,also-not-a-part" }),
  );
  const callout = page.locator('[data-slot="callout"]');
  await expect(callout.first()).toBeVisible();
  // A full checkup plans more steps than any two-part scope could.
  const scoped = await page.evaluate(() => document.querySelectorAll("[data-step-key]").length);
  expect(scoped).toBeGreaterThan(2);
});

// ────────────────────────────────────────────────────────────────── row 8 ──

test('/guides?kind=… no result → "Aucun guide" + reset', async ({ page }) => {
  await page.goto(`${href("fr", "/guides")}?kind=clean&system=suspension`);

  const empty = page.getByTestId("guides-empty");
  await expect(empty).toContainText(GUIDES_T.fr.list.empty);

  await empty.getByRole("button", { name: GUIDES_T.fr.list.reset }).click();
  await expect(page).toHaveURL(new RegExp(`${href("fr", "/guides")}$`));
  await expect(page.getByTestId("guides-empty")).toHaveCount(0);
});

// ────────────────────────────────────────────────────────────────── row 9 ──

test("partial checkup OK on a part with an open item → item done (recheck-ok)", async ({
  page,
}) => {
  await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);

  // 1. A full checkup, answering KO on the first step, produces an open item.
  await page.goto(href("fr", "/velo/[id]/controle", { id: "local" }));
  const openItem = await answerFirstStepKo(page);

  // 2. A partial checkup on that same part, answered OK, closes it — and says
  //    WHY it closed, which is the part of §5.4 a "done" flag alone loses.
  await page.goto(href("fr", "/velo/[id]/controle", { id: "local" }, { parts: openItem.partId }));
  await answerEveryStepOk(page);

  // `va:buildlist:local`, not `va:checkup:local` — the list is what closes.
  const items = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null
      ? []
      : ((JSON.parse(raw) as { items?: Array<Record<string, unknown>> }).items ?? []);
  }, buildListKey("local"));
  expect(items.length, "the first checkup produced no list to close").toBeGreaterThan(0);

  const closed = items.find((item) => item.partId === openItem.partId);
  expect(closed?.done).toBe(true);
  expect(closed?.doneReason).toBe("recheck-ok");
});

/** Answer KO on the first planned step and return the part it reported on. */
async function answerFirstStepKo(page: Page): Promise<{ partId: string }> {
  const step = page.locator("[data-step-key]").first();
  await expect(step).toBeVisible();
  const partId = (await step.getAttribute("data-part-id")) ?? "";
  await step.getByRole("button", { name: /.+/ }).last().click();
  return { partId };
}

/**
 * Answer OK on every step of the current plan.
 *
 * It asserts that there WAS a plan: a page with no step at all would otherwise
 * make "every step answered" trivially true, which is exactly how a row that
 * depends on a route nobody has written yet passes for the wrong reason.
 */
async function answerEveryStepOk(page: Page): Promise<void> {
  let answered = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const step = page.locator("[data-step-key]").first();
    if ((await step.count()) === 0) break;
    await step.getByRole("button", { name: /.+/ }).first().click();
    answered += 1;
  }
  expect(answered, "the checkup planned no step at all").toBeGreaterThan(0);
}

// ───────────────────────────────────────────────────────────────── row 10 ──

test("new local bike while one exists → confirm dialog", async ({ page }) => {
  // Every answer the mtb branch asks for, so the tree lands on its summary.
  const complete = [
    "drive=muscular",
    "discipline=mtb",
    "wheel-size=29",
    "brake-type=disc-hydraulic",
    "brake-mount=post-mount",
    "cockpit=riser",
    "drivetrain=derailleur-1x",
    "speeds=12",
    "shifter=trigger",
    "pedals=flat",
    "suspension=front",
    "seatpost=dropper",
    "tire-system=tubeless",
  ].join("&");

  await page.goto(`${href("fr", "/")}?${complete}`);
  await expect(page.getByTestId("decision-summary")).toBeVisible();
  await page.getByRole("button", { name: frTree.summary.generate }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/local"));
  const first = await storedBikeId(page);

  // Second time round, the tree must ask before overwriting the stored bike.
  await page.goto(`${href("fr", "/")}?${complete}`);
  await expect(page.getByTestId("decision-summary")).toBeVisible();
  await page.getByRole("button", { name: frTree.summary.generate }).click();

  const dialog = page.getByRole("dialog", { name: frTree.summary.replace.title });
  await expect(dialog).toBeVisible();

  // Cancelling keeps the visitor, and their bike, exactly where they were.
  await dialog.getByRole("button", { name: frTree.summary.replace.cancel }).click();
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).pathname).toBe(href("fr", "/"));
  expect(await storedBikeId(page)).toBe(first);
});

async function storedBikeId(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (JSON.parse(window.localStorage.getItem("va:bike:local") ?? "{}") as { id?: string }).id,
  );
}

// ───────────────────────────────────────────────────────────────── row 11 ──

test("/en/does-not-exist → EN 404 with status 404", async ({ page }) => {
  const response = await page.goto("/en/does-not-exist");

  // A streamed 200 "not found" page is a soft 404 — the status is the assertion
  // (`app/[locale]/[...rest]/page.tsx`, `.debug/001`).
  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COMMON_T.en.notFound.title);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

// ───────────────────────────────────────────────────────────────── row 12 ──

test("WebGL unavailable → SVG + list still complete the checkup", async ({ page, webgl }) => {
  test.skip(webgl, "the no-webgl project is the one without a GL context");

  await page.goto(href("fr", "/velo/[id]", { id: "demo" }));

  // The silhouette is the product here, not a placeholder waiting for a canvas.
  await expect(page.getByTestId("bike3d-viewer")).toHaveAttribute("data-state", "no-webgl");
  await expect(page.getByTestId("bike3d-svg")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);

  // The parts list is complete: every part of the bike is reachable by name.
  await expandSheetIfPresent(page);
  await expect(page.getByTestId("parts-list").getByRole("listitem")).not.toHaveCount(0);

  // …and a checkup can be answered to the end without ever seeing the 3D bike.
  const checkup = await page.goto(href("fr", "/velo/[id]/controle", { id: "demo" }));
  expect(checkup?.status(), "the checkup route did not render").toBe(200);
  await answerEveryStepOk(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("[data-step-key]")).toHaveCount(0);
});
