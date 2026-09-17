/**
 * The home page decision tree against the production build (§6.3, §6.8 AC3).
 *
 *   - a deep link (and a reload of it) restores the step and its answers;
 *   - "Je ne sais pas" is context-dependent and marks the answer with `~`;
 *   - editing an earlier answer prunes its dependants from the URL;
 *   - the whole tree can be completed with the keyboard alone, focus lands on
 *     the `<h1>` after every step, and answering costs no RSC request (the URL
 *     is written with `history.pushState` / `replaceState`, never the router);
 *   - "Générer mon vélo" stores `va:bike:local` and opens `/velo/local`, asking
 *     first when a guest bike already exists.
 *
 * Runs in FR and EN on every e2e project it is given (the §6.8 command uses
 * desktop-chromium and mobile-chromium).
 */
/* eslint-disable security/detect-object-injection -- locale-keyed catalogues read by question ids from the URL */
import type { Page, Request } from "@playwright/test";

import enDecision from "../../messages/en/decision.json";
import enTree from "../../messages/en/decision-tree.json";
import frDecision from "../../messages/fr/decision.json";
import frTree from "../../messages/fr/decision-tree.json";

import { expect, forEachLocale, href, test } from "./_fixtures";

type Decision = Record<string, { title: string; help: string }>;
const DECISION: Record<"fr" | "en", Decision> = { fr: frDecision, en: enDecision };
const TREE = { fr: frTree, en: enTree };

const GRAVEL_AT_BRAKES = "drive=muscular&discipline=gravel&wheel-size=700c&step=brake-type";

const MTB_UP_TO_SUSPENSION = [
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
].join("&");

const query = (page: Page) => new URL(page.url()).searchParams;

/** The tree has hydrated when its question (or summary) is on screen, not the skeleton. */
async function waitForTree(page: Page): Promise<void> {
  await expect(page.getByTestId("decision-tree")).toBeVisible();
}

/** Press Tab until `predicate` holds for the focused element (keyboard only, no .focus()). */
async function tabUntil(page: Page, predicate: string, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    if (
      await page.evaluate(`(() => { const el = document.activeElement; return ${predicate}; })()`)
    ) {
      return;
    }
  }
  throw new Error(`focus never satisfied: ${predicate}`);
}

forEachLocale((locale) => {
  const decision = DECISION[locale];
  const tree = TREE[locale];

  test(`a reload restores step 4 with three answers (${locale})`, async ({ page }) => {
    await page.goto(`${href(locale, "/")}?${GRAVEL_AT_BRAKES}`);
    await page.reload();
    await waitForTree(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(decision["brake-type"].title);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    const params = query(page);
    expect(["drive", "discipline", "wheel-size"].map((key) => params.get(key))).toEqual([
      "muscular",
      "gravel",
      "700c",
    ]);
    await expect.poll(() => page.title()).toContain(decision["brake-type"].title);
  });

  for (const [discipline, size, expected] of [
    ["gravel", "700c", "disc-hydraulic~"],
    ["city-hybrid", "26", "v-brake~"],
  ] as const) {
    test(`"${tree.actions.dontKnow}" on brake-type gives ${expected} for ${discipline} (${locale})`, async ({
      page,
    }) => {
      await page.goto(
        `${href(locale, "/")}?drive=muscular&discipline=${discipline}&wheel-size=${size}&step=brake-type`,
      );
      await waitForTree(page);
      await page.getByRole("button", { name: tree.actions.dontKnow }).click();
      await expect(page.getByTestId("default-callout")).toBeVisible();
      // No auto-advance: still on the same question until Continue.
      expect(query(page).get("brake-type")).toBeNull();

      await page.getByRole("button", { name: tree.actions.continue }).click();
      await expect.poll(() => query(page).get("brake-type")).toBe(expected);
      expect(page.url()).toContain(`brake-type=${expected}`);
    });
  }

  test(`changing the discipline from mtb to road removes suspension (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${href(locale, "/")}?${MTB_UP_TO_SUSPENSION}&step=discipline`);
    await waitForTree(page);
    expect(query(page).get("suspension")).toBe("front");
    await expect(page.getByRole("radio", { checked: true })).toHaveAttribute(
      "data-option-id",
      "mtb",
    );

    await page.locator('[role=radio][data-option-id="road"]').click();
    await page.getByRole("button", { name: tree.actions.continue }).click();

    await expect.poll(() => query(page).get("discipline")).toBe("road");
    expect(query(page).has("suspension")).toBe(false);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test(`keyboard-only completion reaches the summary, focus on each h1, zero RSC requests (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/"));
    await waitForTree(page);
    await page.waitForLoadState("networkidle");

    const homePath = new URL(page.url()).pathname;
    const rsc: string[] = [];
    const onRequest = (request: Request) => {
      const url = new URL(request.url());
      if (!url.searchParams.has("_rsc")) return;
      // A prefetch of a link that scrolled into view is not caused by answering;
      // anything aimed at the home page itself, or any real navigation, is.
      const prefetch = request.headers()["next-router-prefetch"] !== undefined;
      if (url.pathname === homePath || !prefetch) rsc.push(request.url());
    };
    page.on("request", onRequest);

    const visited: string[] = [];
    for (let step = 0; step < 20; step++) {
      const current = await page.getByTestId("question-step").getAttribute("data-question");
      visited.push(current ?? "?");

      // Into the radio group, pick with an arrow key, over to Continue, press Enter.
      await tabUntil(page, "el?.getAttribute('role') === 'radio'");
      // Held down across the focus move, as a real key press is: Radix moves
      // focus on a macrotask and selects only while the arrow is still pressed.
      await page.keyboard.down("ArrowRight");
      await expect(page.getByRole("radio", { checked: true })).toBeFocused();
      await page.keyboard.up("ArrowRight");
      await tabUntil(page, "el?.dataset.testid === 'tree-continue'");
      await page.keyboard.press("Enter");

      await expect(page.locator("h1")).toBeFocused();
      expect(rsc, `after answering ${current}:\n${rsc.join("\n")}`).toEqual([]);
      if (!query(page).has("step")) break;
      const next = query(page).get("step")!;
      await expect(page.locator("h1")).toHaveText(decision[next].title);
      await expect(page.getByTestId("question-step")).toHaveAttribute("data-question", next);
    }

    const summary = page.getByTestId("decision-summary");
    await expect(summary).toBeVisible();
    await expect(page.locator("h1")).toHaveText(tree.summary.title);
    await expect(page.locator("h1")).toBeFocused();
    expect(visited[0]).toBe("drive");
    expect(visited.length).toBeGreaterThanOrEqual(10);
    await expect(summary.locator("tbody tr")).toHaveCount(visited.length);

    page.off("request", onRequest);
    expect(rsc, rsc.join("\n")).toEqual([]);
  });

  test(`"Générer mon vélo" stores the guest bike and opens /velo/local (${locale})`, async ({
    page,
  }) => {
    const complete = `${MTB_UP_TO_SUSPENSION}&seatpost=dropper&tire-system=tubeless~`;
    await page.goto(`${href(locale, "/")}?${complete}`);
    const summary = page.getByTestId("decision-summary");
    await expect(summary).toBeVisible();
    await expect(summary.getByTestId("default-badge")).toHaveCount(1);

    await page.getByRole("button", { name: tree.summary.generate }).click();
    await page.waitForURL((url) => url.pathname === href(locale, "/velo/[id]", { id: "local" }));

    const stored = await page.evaluate(() => window.localStorage.getItem("va:bike:local"));
    const bike = JSON.parse(stored ?? "null") as {
      version: number;
      id: string;
      answers: Record<string, string>;
      spec: { discipline: string; suspension: { front: boolean } };
      parts: unknown[];
    };
    expect(bike.version).toBe(1);
    expect(bike.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(bike.answers).toMatchObject({
      discipline: "mtb",
      suspension: "front",
      "tire-system": "tubeless",
    });
    expect(bike.spec.discipline).toBe("mtb");
    expect(bike.spec.suspension.front).toBe(true);
    expect(bike.parts.length).toBeGreaterThan(20);
  });

  test(`asks before replacing a guest bike already stored (${locale})`, async ({ page }) => {
    const complete = `${MTB_UP_TO_SUSPENSION}&seatpost=dropper&tire-system=tubeless`;
    await page.goto(`${href(locale, "/")}?${complete}`);
    await expect(page.getByTestId("decision-summary")).toBeVisible();
    await page.getByRole("button", { name: tree.summary.generate }).click();
    await page.waitForURL((url) => url.pathname.endsWith("/local"));
    const firstId = await page.evaluate(
      () =>
        (JSON.parse(window.localStorage.getItem("va:bike:local") ?? "{}") as { id?: string }).id,
    );

    await page.goto(`${href(locale, "/")}?${complete}`);
    await page.getByRole("button", { name: tree.summary.generate }).click();
    const dialog = page.getByRole("dialog", { name: tree.summary.replace.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: tree.summary.replace.cancel }).click();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).pathname).toBe(href(locale, "/"));

    await page.getByRole("button", { name: tree.summary.generate }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: tree.summary.replace.confirm })
      .click();
    await page.waitForURL((url) => url.pathname.endsWith("/local"));
    const secondId = await page.evaluate(
      () =>
        (JSON.parse(window.localStorage.getItem("va:bike:local") ?? "{}") as { id?: string }).id,
    );
    expect(secondId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondId).not.toBe(firstId);
  });

  test(`option cards and tree buttons are at least 44 px (${locale})`, async ({ page }) => {
    await page.goto(`${href(locale, "/")}?${GRAVEL_AT_BRAKES}`);
    await waitForTree(page);
    const targets = page.locator(
      "[role=radio], [data-testid=dont-know], [data-testid=tree-continue], [data-testid=tree-back]",
    );
    const count = await targets.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox();
      expect(box?.width, `target ${i}`).toBeGreaterThanOrEqual(44);
      expect(box?.height, `target ${i}`).toBeGreaterThanOrEqual(44);
    }
  });
});
