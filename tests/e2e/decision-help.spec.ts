/**
 * The decision tree's "check it on your own bike" help (§6.3, §6.8 AC3).
 *
 * Walking the tree with the keyboard, for EVERY question reached, the
 * `<details>` help holds exactly one `svg[role=img]` whose `<title>` is
 * `illustrations.<id>.alt` and a paragraph equal to `decision.<q>.help` — in FR
 * and EN — and, once opened on the first question, it stays open on every
 * following one (its state lives in `localStorage`).
 */
/* eslint-disable security/detect-object-injection -- locale-keyed catalogues read by question ids from the page */
import type { Page } from "@playwright/test";

import enDecision from "../../messages/en/decision.json";
import enTree from "../../messages/en/decision-tree.json";
import enIllustrations from "../../messages/en/illustrations.json";
import frDecision from "../../messages/fr/decision.json";
import frTree from "../../messages/fr/decision-tree.json";
import frIllustrations from "../../messages/fr/illustrations.json";

import { expect, forEachLocale, href, test } from "./_fixtures";

type Decision = Record<string, { help: string }>;
type Alts = Record<string, { alt: string }>;
const DECISION: Record<"fr" | "en", Decision> = { fr: frDecision, en: enDecision };
const ALTS: Record<"fr" | "en", Alts> = {
  fr: frIllustrations as unknown as Alts,
  en: enIllustrations as unknown as Alts,
};
const TREE = { fr: frTree, en: enTree };

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
  test(`every question's help shows its named drawing and text, and stays open (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/"));
    await expect(page.getByTestId("question-step")).toBeVisible();
    // The tree is in the prerendered document since `.debug/011`, so being
    // visible no longer means it is listening: wait for the ref callback that
    // says React has taken it over, or the first Continue goes nowhere.
    await expect(page.getByTestId("decision-tree")).toHaveAttribute("data-hydrated", "true");

    // Open the help on the first question with the keyboard.
    const firstHelp = page.getByTestId("decision-help");
    await expect(firstHelp).not.toHaveAttribute("open", "");
    await tabUntil(page, "el?.tagName === 'SUMMARY'");
    await expect(firstHelp.locator("summary")).toHaveText(TREE[locale].help.summary);
    await page.keyboard.press("Enter");
    await expect(firstHelp).toHaveAttribute("open", "");

    const checked: string[] = [];
    for (let step = 0; step < 20; step++) {
      const question = (await page.getByTestId("question-step").getAttribute("data-question"))!;
      const help = page.getByTestId("decision-help");
      await expect(help).toHaveAttribute("data-question", question);
      await expect(help, `help for ${question} is open`).toHaveAttribute("open", "");

      const images = help.locator("svg[role=img]");
      await expect(images).toHaveCount(1);
      await expect(images.locator("title")).toHaveText(ALTS[locale][`ill-${question}`].alt);
      // The shapes come from `/tree-drawings.json` after hydration
      // (.debug/005), so an empty frame with the right name would otherwise
      // pass every assertion above.
      await expect(
        images.locator("path, circle, rect, line, polyline, ellipse"),
        `${question} has shapes`,
      ).not.toHaveCount(0);
      await expect(help.locator("p", { hasText: DECISION[locale][question].help })).toHaveText(
        DECISION[locale][question].help,
      );
      checked.push(question);

      // Answer: into the radio group, arrow to pick, over to Continue.
      await tabUntil(page, "el?.getAttribute('role') === 'radio'");
      // Held across the focus move (Radix selects only while the arrow is pressed).
      await page.keyboard.down("ArrowRight");
      await expect(page.getByRole("radio", { checked: true })).toBeFocused();
      await page.keyboard.up("ArrowRight");
      await tabUntil(page, "el?.dataset.testid === 'tree-continue'");
      await page.keyboard.press("Enter");
      await expect(page.locator("h1")).toBeFocused();
      if (await page.getByTestId("decision-summary").isVisible()) break;
    }

    await expect(page.getByTestId("decision-summary")).toBeVisible();
    expect(checked[0]).toBe("drive");
    expect(checked.length).toBeGreaterThanOrEqual(10);
    // Remembered in storage, where the Disclosure keeps it.
    expect(
      await page.evaluate(() => window.localStorage.getItem("va:ui:disclosure:decision-tree-help")),
    ).toBe("1");
  });
});
