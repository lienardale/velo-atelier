/**
 * The checkup wizard on the demo bike (§6.8 AC6).
 *
 * What only a browser can settle, and what each test is actually for:
 *
 *   - the TOOL LIST is the union of the plan's guides, and ticking "je n'ai pas
 *     cet outil" is remembered in `va:checkup:demo` and honoured by the step
 *     that needs the tool — three files and a storage round trip agreeing;
 *   - one step of one guide is on screen at a time, which is the §5.2 contract
 *     (`StepScope`) and cannot be checked without rendering the compiled MDX;
 *   - an answer survives a reload, which is the difference between a wizard and
 *     a form;
 *   - typing "2" in a note is a note. The keyboard shortcuts are the fastest
 *     way through a checkup and the easiest way to ruin one.
 */
import { expect, forEachLocale, href, test } from "./_fixtures";
import { noteFor, storedCheckup, verdictFor } from "./_checkup";

/** The demo bike is the gravel preset: hydraulic discs, 1×11, tubeless. */
const CHAIN_STEP = "check-drivetrain#chain-wear";

const TOOL_LABEL = {
  fr: { "chain-checker": "Contrôleur d'usure de chaîne", "steel-ruler": "Réglet métallique" },
  en: { "chain-checker": "Chain checker", "steel-ruler": "Steel ruler" },
} as const;

forEachLocale((locale) => {
  test(`the tool list is the union of the plan's tools (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/velo/[id]/controle", { id: "demo" }));

    const list = page.getByTestId("tool-checklist");
    await expect(list).toBeVisible();
    const ids = await list
      .locator("li[data-tool-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tool-id")));
    // `toolsFor(planCheckup(gravelBuild, full))`, in catalogue order — the same
    // list `tests/unit/checkup/plan-corpus.test.ts` pins on the engine side.
    expect(ids).toEqual([
      "allen-keys",
      "torque-wrench",
      "pedal-wrench",
      "phillips-screwdriver",
      "floor-pump",
      "pressure-gauge",
      "chain-checker",
      "zip-tie",
      "work-stand",
      "rags",
    ]);
  });

  test(`a missing tool is remembered and the step offers the stand-in (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/velo/[id]/controle", { id: "demo" }));

    await page.getByTestId("tool-missing-chain-checker").check();
    await expect(page.getByTestId("tool-alternative-chain-checker")).toContainText(
      // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale literal
      TOOL_LABEL[locale]["steel-ruler"],
    );

    await expect
      .poll(async () => (await storedCheckup(page))?.toolsMissing)
      .toEqual(["chain-checker"]);

    // The chain question is the one that asks for a chain checker. Deep-linking
    // to it also proves `?step=` resumes into a question rather than the list.
    await page.goto(
      `${href(locale, "/velo/[id]/controle", { id: "demo" })}?step=${encodeURIComponent(CHAIN_STEP)}`,
    );
    await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN_STEP);

    const substitution = page.getByTestId("tool-substitution");
    await expect(substitution).toBeVisible();
    // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale literal
    await expect(substitution).toContainText(TOOL_LABEL[locale]["steel-ruler"]);
  });
});

test("one step of one guide is on screen, and it is the planned one", async ({ page }) => {
  await page.goto(
    `${href("fr", "/velo/[id]/controle", { id: "demo" })}?step=${encodeURIComponent(CHAIN_STEP)}`,
  );

  const body = page.getByTestId("step-body");
  await expect(body.locator("[data-step-id]")).toHaveCount(1);
  await expect(body.locator("[data-step-id]")).toHaveAttribute("data-step-id", "chain-wear");
  // The guide's table of contents belongs to the guide page, not to a wizard
  // showing one of its steps (§5.2).
  await expect(body.locator("[data-testid=guide-toc]")).toHaveCount(0);
});

test("an answer moves the wizard on and survives a reload", async ({ page }) => {
  await page.goto(href("fr", "/velo/[id]/controle", { id: "demo" }));
  await page.getByTestId("checkup-start").click();

  const card = page.getByTestId("step-card");
  const first = await card.getAttribute("data-step-key");
  expect(first).not.toBeNull();

  await page.getByTestId("verdict-ok").click();
  await expect(card).not.toHaveAttribute("data-step-key", first!);
  const second = await card.getAttribute("data-step-key");

  await expect.poll(() => verdictFor(page, first!)).toBe("ok");

  await page.reload();
  // Back on the SAME question, with the first one still answered: the plan is
  // recomputed and the answers are reconciled onto it (§5.4).
  await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", second!);
  expect(await verdictFor(page, first!)).toBe("ok");
});

test("the keyboard answers the question, and a note never does", async ({ page }) => {
  await page.goto(href("fr", "/velo/[id]/controle", { id: "demo" }));
  await page.getByTestId("checkup-start").click();

  const card = page.getByTestId("step-card");
  const first = await card.getAttribute("data-step-key");

  // "1" is "ça marche".
  await page.keyboard.press("1");
  await expect(card).not.toHaveAttribute("data-step-key", first!);

  // "2" is "ça ne marche pas" — and the step stays put, because the symptom is
  // what turns a KO into one line of the list.
  const second = await card.getAttribute("data-step-key");
  await page.keyboard.press("2");
  await expect(page.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
  await expect(card).toHaveAttribute("data-step-key", second!);

  // …and inside the note, "2" is a character.
  const note = page.getByTestId("symptom-note");
  await note.fill("bruit à 2 km/h");
  await note.press("2");
  await expect(page.getByTestId("step-card")).toHaveAttribute("data-step-key", second!);
  await expect(page.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
  await expect(note).toHaveValue("bruit à 2 km/h2");

  await expect.poll(() => noteFor(page, second!)).toBe("bruit à 2 km/h2");
});

test("going back returns to the previous question with its verdict", async ({ page }) => {
  await page.goto(href("fr", "/velo/[id]/controle", { id: "demo" }));
  await page.getByTestId("checkup-start").click();

  const card = page.getByTestId("step-card");
  const first = await card.getAttribute("data-step-key");
  await page.getByTestId("verdict-ok").click();
  await expect(card).not.toHaveAttribute("data-step-key", first!);

  await page.getByTestId("checkup-back").click();
  await expect(card).toHaveAttribute("data-step-key", first!);
  await expect(page.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ok");
});
