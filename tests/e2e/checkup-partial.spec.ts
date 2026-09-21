/**
 * A checkup scoped to the parts the visitor picked (§6.8 AC6).
 *
 * `?parts=` is the whole feature: tapping a caliper in the viewer and asking
 * "check THIS" has to produce the questions about that caliper and no others —
 * including the questions about the pads inside it, which have no mesh of their
 * own and are picked through it (§1.2 `hostPartId`).
 *
 * The second half is the loop closing: a KO, a symptom, a reload, "Créer ma
 * liste", and exactly one line about exactly one part in `va:buildlist:demo`.
 * The list PAGE is W3-T2's; what this asserts is the payload it will read.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures, indexed by a Locale literal */
import enCheckup from "../../messages/en/checkup.json";
import frCheckup from "../../messages/fr/checkup.json";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";
import { storedBuildList, storedCheckup, symptomsFor, verdictFor } from "./_checkup";

const CHECKUP_T: Record<Locale, typeof frCheckup> = { fr: frCheckup, en: enCheckup };

const CALIPER_STEPS = [
  "check-brakes-disc#pad-wear",
  "check-brakes-disc#caliper-alignment",
  "check-brakes-disc#hose-leak",
];

const CHAIN_STEP = "check-drivetrain#chain-wear";

forEachLocale((locale) => {
  test(`picking the two calipers asks exactly the caliper questions (${locale})`, async ({
    page,
  }) => {
    await page.goto(
      `${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=brake-caliper-front,brake-caliper-rear`,
    );

    await expect(page.getByTestId("checkup-scope")).toHaveText(CHECKUP_T[locale].scopePartial);
    await page.getByTestId("checkup-start").click();

    const card = page.getByTestId("step-card");
    const seen: string[] = [];
    for (let index = 0; index < CALIPER_STEPS.length; index += 1) {
      await expect(card).toBeVisible();
      seen.push((await card.getAttribute("data-step-key")) ?? "");
      // The stepper knows how long the plan is; a fourth question would show here.
      await expect(card.locator("[data-slot=stepper]")).toHaveAttribute(
        "data-total",
        String(CALIPER_STEPS.length),
      );
      await page.getByTestId("verdict-ok").click();
    }

    expect(seen).toEqual(CALIPER_STEPS);
    await expect(page.getByTestId("checkup-summary")).toBeVisible();
  });

  test(`a KO with a symptom becomes one line of the list, across a reload (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=chain`);
    await page.getByTestId("checkup-start").click();
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);

    await page.getByTestId("verdict-ko").click();
    // The step's own symptoms, from `checkQuestion.ko[]` grouped by reason.
    await expect(page.getByTestId("symptom-chain-elongation")).toBeVisible();
    await expect(page.getByTestId("symptom-chain-dirty")).toBeVisible();
    await page.getByTestId("symptom-chain-elongation").click();

    await expect.poll(() => symptomsFor(page, CHAIN_STEP)).toEqual(["chain-elongation"]);

    await page.reload();
    // One question, answered: the wizard comes back on the summary.
    await expect(page.getByTestId("checkup-summary")).toBeVisible();
    await expect(page.getByTestId("summary-group-ko").locator("li")).toHaveCount(1);

    await page.getByTestId("summary-create").click();

    const list = await storedBuildList(page);
    expect(list?.items).toHaveLength(1);
    expect(list?.items[0]).toMatchObject({
      id: "check-drivetrain#chain-wear|chain|replace",
      partId: "chain",
      action: "replace",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
    });
    // Finishing closes the checkup — which is what makes the resume banner go.
    await expect.poll(async () => (await storedCheckup(page))?.completedAt).not.toBeUndefined();
  });

  test(`the resume banner appears on the bike, and goes once the checkup is done (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=chain`);
    await page.getByTestId("checkup-start").click();
    await page.getByTestId("verdict-ko").click();
    await page.getByTestId("symptom-chain-elongation").click();
    await expect.poll(() => verdictFor(page, CHAIN_STEP)).toBe("ko");

    // An answered but unfinished checkup is what the banner is for.
    await page.goto(href(locale, "/velo/[id]", { id: "demo" }));
    await expect(page.getByTestId("resume-banner")).toBeVisible();

    // The link carries the SCOPE, so "reprendre" comes back to the one question
    // that was asked and not to a freshly planned full checkup. Followed by URL
    // rather than by a click: the workspace under the banner is a WebGL canvas
    // that is still settling, and "stable enough to click" is not what this test
    // is about.
    await expect(page.getByTestId("resume-cta")).toHaveAttribute(
      "href",
      `${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=chain`,
    );
    await page.goto(`${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=chain`);
    await expect(page.getByTestId("checkup-summary")).toBeVisible();
    await page.getByTestId("summary-create").click();
    // Finishing opens the list: the wizard writes it, then `router.push`es. Let
    // that soft navigation land before leaving. A `goto` issued while its RSC
    // fetch is in flight makes WebKit cancel the fetch; Next falls back to a
    // browser navigation to the list, and the `goto` is "interrupted by another
    // navigation" (.debug/015 §8).
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: "demo" }),
    );
    await expect.poll(async () => (await storedBuildList(page))?.items.length).toBe(1);

    await page.goto(href(locale, "/velo/[id]", { id: "demo" }));
    await expect(page.getByTestId("resume-banner")).toHaveCount(0);
  });

  test(`a scope that matches no question says so instead of asking nothing (${locale})`, async ({
    page,
  }) => {
    // A rack is a real part, and the demo bike does not have one: the step that
    // would ask about it is about parts this bike does not carry.
    await page.goto(`${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=rack`);
    await expect(page.getByTestId("checkup-full-cta")).toBeVisible();
  });
});
