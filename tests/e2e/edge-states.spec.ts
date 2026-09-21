/**
 * The empty and edge states of §6.7 — one `test()` per row of that table,
 * titled with the row text, so the table and this file can be read side by side
 * (§6.8 AC13). Every row runs in FR and EN (the locale is appended to the title);
 * the last row names its locale itself, so its English instance carries the
 * row text verbatim and its French twin says "FR".
 *
 * Several of these behaviours are also exercised in passing by the spec that
 * owns the feature (`part-panel` visits `/velo/local`, `guides-filter` empties
 * the filter). That duplication is the point: §6.7 is a list of promises about
 * what happens when there is *nothing to show*, and a promise nobody checks as
 * a promise is one that quietly stops being kept when the feature around it is
 * rewritten.
 *
 * The rows are asserted against the published contracts — `lib/checkup/types.ts`,
 * `lib/bike/storage-keys.ts`, `routing.pathnames` — and never against invented
 * test ids.
 */
/* eslint-disable security/detect-non-literal-regexp, security/detect-object-injection -- locale-keyed message fixtures and patterns built from paths this file computed itself */
import type { Page } from "@playwright/test";

import { buildListKey } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { routing, type Pathname } from "../../lib/i18n/routing";
import enAuth from "../../messages/en/auth.json";
import enBike from "../../messages/en/bike.json";
import enCommon from "../../messages/en/common.json";
import enTree from "../../messages/en/decision-tree.json";
import enGuides from "../../messages/en/guides.json";
import frAuth from "../../messages/fr/auth.json";
import frBike from "../../messages/fr/bike.json";
import frCommon from "../../messages/fr/common.json";
import frTree from "../../messages/fr/decision-tree.json";
import frGuides from "../../messages/fr/guides.json";

import { expect, forEachLocale, href, test, type Locale, type RouteKey } from "./_fixtures";
import { seedLocalBike } from "./_local-bike";

const AUTH_T: Record<Locale, typeof frAuth> = { fr: frAuth, en: enAuth };
const BIKE_T: Record<Locale, typeof frBike> = { fr: frBike, en: enBike };
const COMMON_T: Record<Locale, typeof frCommon> = { fr: frCommon, en: enCommon };
const GUIDES_T: Record<Locale, typeof frGuides> = { fr: frGuides, en: enGuides };
const TREE_T: Record<Locale, typeof frTree> = { fr: frTree, en: enTree };

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

forEachLocale((locale) => {
  // ──────────────────────────────────────────────────────────────── row 1 ──

  test(`/velo/local without storage → / + toast (${locale})`, async ({ page }) => {
    // Nothing is seeded: this is a visitor who typed the URL, or came back after
    // clearing their browser data.
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));

    await expect(page).toHaveURL(new RegExp(`/${locale}(\\?.*)?$`));
    // The redirect alone is indistinguishable from a broken link — the toast is
    // what tells them why they are looking at the front page.
    await expect(page.getByText(BIKE_T[locale].canvas.emptyToast)).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────── row 2 ──

  test(`/velo/<other-user-uuid> and sub-routes → 404 (never 403) (${locale})`, async ({
    request,
    signedInContext,
  }) => {
    // Signed in as somebody: a 403 would confirm the id exists, which is the
    // whole reason §4.7 says 404 (`lib/bike/load-bike.ts`).
    await signedInContext();

    for (const key of BIKE_ROUTES) {
      const foreign = await request.get(
        href(locale, key as RouteKey, bikeParams(key, FOREIGN_BIKE)),
      );
      expect(foreign.status(), `${key} for another user's bike`).toBe(404);
      expect(foreign.status(), `${key} must never answer 403`).not.toBe(403);

      // …and the same URL on a bike this visitor may see is a 200, so the 404
      // above is about ownership and not about the route being absent.
      const own = await request.get(href(locale, key as RouteKey, bikeParams(key, "demo")));
      expect(own.status(), `${key} on the demo bike`).toBe(200);
    }
  });

  // ──────────────────────────────────────────────────────────────── row 3 ──

  test(`/velo/not-a-uuid → 404 (${locale})`, async ({ request }) => {
    // `resolveBikeRef` accepts `demo`, `local` and a v4 UUID; everything else is
    // not a bike. The nil UUID and a v1-shaped one are the interesting refusals:
    // both would parse as "a UUID" under a looser pattern and reach a query.
    for (const id of [
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    ]) {
      const response = await request.get(href(locale, "/velo/[id]", { id }));
      expect(response.status(), `/velo/${id}`).toBe(404);
    }
  });

  // ──────────────────────────────────────────────────────────────── row 4 ──

  test(`/velo/[id]/piece/<part not on bike> → 404 (${locale})`, async ({ request }) => {
    // The demo bike is a gravel bike: it has a saddle and no motor.
    const present = await request.get(
      href(locale, "/velo/[id]/piece/[partId]", { id: "demo", partId: "saddle" }),
    );
    expect(present.status()).toBe(200);

    for (const partId of ["e-motor", "not-a-part"]) {
      const absent = await request.get(
        href(locale, "/velo/[id]/piece/[partId]", { id: "demo", partId }),
      );
      expect(absent.status(), partId).toBe(404);
    }
  });

  // ──────────────────────────────────────────────────────────────── row 5 ──

  test(`/mes-velos empty → illustration + CTA (${locale})`, async ({ page, signupEmail }) => {
    // A brand-new account is the only honest way to an empty garage: the seeded
    // demo user has four bikes, and deleting them would race the other specs.
    const auth = AUTH_T[locale];
    await page.goto(href(locale, "/inscription"));
    await page.getByLabel(auth.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(auth.fields.password, { exact: true }).fill("Guidon-Tandem-47!");
    await page.getByRole("button", { name: auth.signUp.submit }).click();
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);

    const empty = page.getByTestId("my-bikes-empty");
    await expect(empty).toBeVisible();
    await expect(empty.locator("svg")).toHaveCount(1);
    await expect(empty).toContainText(BIKE_T[locale].myBikes.emptyTitle);
    await expect(page.getByTestId("my-bikes-list")).toHaveCount(0);

    const cta = page.getByTestId("my-bikes-empty-cta");
    await expect(cta).toHaveText(BIKE_T[locale].myBikes.emptyCta);
    await expect(cta).toHaveAttribute("href", href(locale, "/"));
  });

  // ──────────────────────────────────────────────────────────────── row 6 ──

  test(`/velo/[id]/liste empty → CTA (${locale})`, async ({ page }) => {
    // No checkup has been answered, so the list is derived from nothing.
    const response = await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    expect(response?.status()).toBe(200);

    const main = page.getByRole("main");
    await expect(main).toBeVisible();
    // Nothing to buy, and no line pretending there is.
    await expect(main.getByRole("listitem")).toHaveCount(0);
    // The way out is the checkup that would fill it — asserted as a link to that
    // route rather than by a test id, so the list is free to shape its empty state.
    await expect(
      main.locator(`a[href^="${href(locale, "/velo/[id]/controle", { id: "demo" })}"]`),
    ).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────── row 7 ──

  test(`?parts= with unknown ids → dropped, none left → full checkup + info callout (${locale})`, async ({
    page,
  }) => {
    // Half-valid first: the unknown id is dropped and the real one is kept.
    const response = await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "chain,not-a-part" }),
    );
    expect(response?.status()).toBe(200);
    await startWizard(page);
    await expect(page.locator("body")).not.toContainText("not-a-part");
    const kept = await plannedStepCount(page);

    // Nothing left: the scope falls back to a FULL checkup, and says so.
    await page.goto(
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "not-a-part,also-not-a-part" }),
    );
    const callout = page.locator('[data-slot="callout"]');
    await expect(callout.first()).toBeVisible();
    await startWizard(page);
    // A full checkup plans more questions than the one-part scope above.
    expect(await plannedStepCount(page)).toBeGreaterThan(kept);
  });

  // ──────────────────────────────────────────────────────────────── row 8 ──

  test(`/guides?kind=… no result → "Aucun guide" + reset (${locale})`, async ({ page }) => {
    await page.goto(`${href(locale, "/guides")}?kind=clean&system=suspension`);

    const empty = page.getByTestId("guides-empty");
    await expect(empty).toContainText(GUIDES_T[locale].list.empty);

    await empty.getByRole("button", { name: GUIDES_T[locale].list.reset }).click();
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/guides")}$`));
    await expect(page.getByTestId("guides-empty")).toHaveCount(0);
  });

  // ──────────────────────────────────────────────────────────────── row 9 ──

  test(`partial checkup OK on a part with an open item → item done (recheck-ok) (${locale})`, async ({
    page,
  }) => {
    const { specCode } = await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);

    // 1. A full checkup, KO on the first question, finished: an OPEN line.
    await page.goto(href(locale, "/velo/[id]/controle", { id: "local" }, { spec: specCode }));
    await startWizard(page);
    const koStep = await answerStepKo(page);
    await answerEveryStepOk(page);
    await page.getByTestId("summary-create").click();

    const opened = await storedItems(page);
    expect(opened.length, "the first checkup produced no list to close").toBeGreaterThan(0);
    const target = opened.find((item) => (item.sourceKeys as string[]).includes(koStep));
    expect(target, `no line came from ${koStep}`).toBeDefined();
    expect(target!.done, "the line starts open").toBe(false);

    // 2. A partial checkup on that same part, answered OK, closes it — and says
    //    WHY it closed, which is the part of §5.4 a "done" flag alone loses.
    //
    //    Scoped by the line's own part, which is what the parts panel would send:
    //    `brake-pads-front` is a consumable with no mesh, so the planner expands
    //    it to the caliper that hosts it (§5.4) and the question that produced
    //    the line is planned again. `markRechecked` then matches that step's
    //    `ko[]` against the line.
    await page.goto(
      href(
        locale,
        "/velo/[id]/controle",
        { id: "local" },
        { spec: specCode, parts: String(target!.partId) },
      ),
    );
    await startWizard(page);
    await answerEveryStepOk(page);
    await page.getByTestId("summary-create").click();

    const closed = (await storedItems(page)).find((item) => item.partId === target!.partId);
    expect(closed?.done).toBe(true);
    expect(closed?.doneReason).toBe("recheck-ok");
  });

  // ─────────────────────────────────────────────────────────────── row 10 ──

  test(`new local bike while one exists → confirm dialog (${locale})`, async ({ page }) => {
    const tree = TREE_T[locale];
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

    await page.goto(`${href(locale, "/")}?${complete}`);
    await expect(page.getByTestId("decision-summary")).toBeVisible();
    await page.getByRole("button", { name: tree.summary.generate }).click();
    await page.waitForURL((url) => url.pathname.endsWith("/local"));
    const first = await storedBikeId(page);

    // Second time round, the tree must ask before overwriting the stored bike.
    await page.goto(`${href(locale, "/")}?${complete}`);
    await expect(page.getByTestId("decision-summary")).toBeVisible();
    await page.getByRole("button", { name: tree.summary.generate }).click();

    const dialog = page.getByRole("dialog", { name: tree.summary.replace.title });
    await expect(dialog).toBeVisible();

    // Cancelling keeps the visitor, and their bike, exactly where they were.
    await dialog.getByRole("button", { name: tree.summary.replace.cancel }).click();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).pathname).toBe(href(locale, "/"));
    expect(await storedBikeId(page)).toBe(first);
  });

  // ─────────────────────────────────────────────────────────────── row 11 ──

  test(`/${locale}/does-not-exist → ${locale.toUpperCase()} 404 with status 404`, async ({
    page,
  }) => {
    const response = await page.goto(`/${locale}/does-not-exist`);

    // A streamed 200 "not found" page is a soft 404 — the status is the assertion
    // (`app/[locale]/[...rest]/page.tsx`, `.debug/001`).
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      COMMON_T[locale].notFound.title,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  // ─────────────────────────────────────────────────────────────── row 12 ──

  test(`WebGL unavailable → SVG + list still complete the checkup (${locale})`, async ({
    page,
    webgl,
  }) => {
    test.skip(webgl, "the no-webgl project is the one without a GL context");

    await page.goto(href(locale, "/velo/[id]", { id: "demo" }));

    // The silhouette is the product here, not a placeholder waiting for a canvas.
    await expect(page.getByTestId("bike3d-viewer")).toHaveAttribute("data-state", "no-webgl");
    await expect(page.getByTestId("bike3d-svg")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    // The parts list is complete: every part of the bike is reachable by name.
    await expandSheetIfPresent(page);
    await expect(page.getByTestId("parts-list").getByRole("listitem")).not.toHaveCount(0);

    // …and a checkup can be answered to the end without ever seeing the 3D bike.
    const checkup = await page.goto(href(locale, "/velo/[id]/controle", { id: "demo" }));
    expect(checkup?.status(), "the checkup route did not render").toBe(200);
    await startWizard(page);
    await answerEveryStepOk(page);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByTestId("step-card")).toHaveCount(0);
  });
});

/**
 * The wizard opens on its TOOL CHECKLIST, not on a question (§6.5) — nothing
 * carries `data-step-key` until "commencer" is pressed. The helpers below use
 * the contract `checkup.spec.ts` uses.
 */
/** The guest to-fix list under `va:buildlist:local`. */
async function storedItems(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null
      ? []
      : ((JSON.parse(raw) as { items?: Array<Record<string, unknown>> }).items ?? []);
  }, buildListKey("local"));
}

async function startWizard(page: Page): Promise<void> {
  await page.getByTestId("checkup-start").click();
  await expect(page.getByTestId("step-card")).toBeVisible();
}

/** How many questions the plan holds, from the progress bar that announces it. */
async function plannedStepCount(page: Page): Promise<number> {
  const max = await page.getByRole("progressbar").first().getAttribute("aria-valuemax");
  return Number(max ?? 0);
}

/** Answer KO + its first symptom on the current step, and name that step. */
async function answerStepKo(page: Page): Promise<string> {
  const card = page.getByTestId("step-card");
  const stepKey = (await card.getAttribute("data-step-key")) ?? "";
  await page.getByTestId("verdict-ko").click();
  // A KO does not advance until a symptom is chosen, so the consequence that
  // reaches the list is the one the visitor picked rather than all of them —
  // unless the step declares none, in which case the whole `ko[]` lands (§5.4)
  // and the wizard moves on by itself.
  const picker = page.getByTestId("symptom-picker");
  if ((await picker.count()) > 0) await picker.getByRole("radio").first().click();
  return stepKey;
}

/**
 * Answer OK on every remaining step, leaving the wizard on its summary.
 *
 * It asserts that there WAS a plan: a page with no step at all would otherwise
 * make "every step answered" trivially true, which is exactly how a row that
 * depends on a route nobody has written yet passes for the wrong reason.
 */
async function answerEveryStepOk(page: Page): Promise<void> {
  let answered = 0;
  for (let guard = 0; guard < 60; guard += 1) {
    if ((await page.getByTestId("step-card").count()) === 0) break;
    await page.getByTestId("verdict-ok").click();
    answered += 1;
  }
  expect(answered, "the checkup planned no step at all").toBeGreaterThan(0);
  await expect(page.getByTestId("checkup-summary")).toBeVisible();
}

async function storedBikeId(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (JSON.parse(window.localStorage.getItem("va:bike:local") ?? "{}") as { id?: string }).id,
  );
}
