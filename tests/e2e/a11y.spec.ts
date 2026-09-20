/**
 * The axe sweep (§6.8 AC4): zero **serious or critical** violations on every
 * page of the site, in both colour schemes and both languages.
 *
 * Why those two dimensions and not just "the page":
 *
 *   - **dark is a different palette**, not a filter. `styles/globals.css`
 *     redefines every token under `prefers-color-scheme: dark`, so a contrast
 *     ratio proven in light says nothing about dark.
 *     `tests/unit/tokens-contrast.test.ts` checks the tokens against the two
 *     papers; this checks what the browser actually painted, which is where a
 *     hard-coded colour or an opacity utility shows up.
 *   - **the two locales are different text**, and text length changes
 *     truncation, wrapping and whether a control still has its name.
 *
 * Only serious and critical are the gate, deliberately: `minor`/`moderate`
 * findings (a missing landmark on a decorative wrapper, a best-practice
 * heading-order note) are worth reading and not worth blocking a merge on. The
 * filtered-out ones are still printed in the failure message when a test goes
 * red, so nothing is hidden.
 *
 * The header menu gets its own test because it only exists below `lg` — the
 * viewport is narrowed inside the test so the row runs on every project,
 * desktop included, rather than being silently skipped where the sheet has no
 * button to open it.
 *
 * `/velo/demo/controle` and `/velo/demo/liste` are W3-T1's and W3-T2's routes;
 * their rows are written here in full and are red until those branches land.
 *
 * **Every test here is two page loads and two axe analyses**, and one of the
 * pages warms a SwiftShader WebGL context. That is 16 s for `/velo/demo` on
 * this machine with the workers idle, and it timed out at the config's 45 s
 * under four parallel workers — reporting nothing about accessibility. The
 * budget is therefore raised per test rather than the whole suite's being
 * loosened, and every `goto` stops at `domcontentloaded` and waits for the
 * element that proves the page is up, instead of for every asset.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import en from "../../messages/en/common.json";
import fr from "../../messages/fr/common.json";

import { expect, forEachLocale, href, test, type Locale, type RouteKey } from "./_fixtures";

/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures */
const COMMON: Record<Locale, typeof fr> = { fr, en };

type Scheme = "light" | "dark";
const SCHEMES: readonly Scheme[] = ["light", "dark"];

interface Target {
  /** The path as §6.8 AC4 writes it — also this test's name. */
  label: string;
  key: RouteKey;
  params?: Record<string, string>;
  /** Something that proves the page finished rendering before axe looks at it. */
  settle?: (page: Page) => Promise<void>;
}

const BIKE = { id: "demo" };

const TARGETS: readonly Target[] = [
  { label: "/", key: "/", settle: waitForMain },
  { label: "/velo/demo", key: "/velo/[id]", params: BIKE, settle: waitForWorkspace },
  { label: "/velo/demo/controle", key: "/velo/[id]/controle", params: BIKE, settle: waitForMain },
  { label: "/velo/demo/liste", key: "/velo/[id]/liste", params: BIKE, settle: waitForMain },
  {
    label: "/velo/demo/reglages",
    key: "/velo/[id]/reglages",
    params: BIKE,
    settle: waitForMain,
  },
  {
    label: "/guides/check-brakes-disc",
    key: "/guides/[slug]",
    params: { slug: "check-brakes-disc" },
    settle: waitForMain,
  },
  { label: "/inscription", key: "/inscription", settle: waitForMain },
];

async function waitForMain(page: Page): Promise<void> {
  await expect(page.getByRole("main")).toBeVisible();
}

/** The workspace renders the silhouette first and swaps in the canvas (§6.4). */
async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.getByTestId("bike-workspace")).toBeVisible();
  await expect(page.getByTestId("parts-list")).toBeVisible();
}

/**
 * Run axe and return a message naming every violation, or `null` when the page
 * is clean at serious/critical. Lower impacts are appended for context.
 */
async function axeReport(page: Page, where: string): Promise<string | null> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  if (blocking.length === 0) return null;

  const describe = (list: typeof violations) =>
    list
      .map(
        (violation) =>
          `  [${violation.impact}] ${violation.id}: ${violation.help}\n` +
          violation.nodes
            .slice(0, 3)
            .map((node) => `      ${node.target.join(" ")}`)
            .join("\n"),
      )
      .join("\n");

  const rest = violations.filter((violation) => !blocking.includes(violation));
  return (
    `${where}\n${describe(blocking)}` +
    (rest.length > 0 ? `\n  — not blocking, for context —\n${describe(rest)}` : "")
  );
}

/**
 * Open the header sheet, retrying the click until it actually opens.
 *
 * `domcontentloaded` (above) returns before the client bundle has run, and
 * `MobileNav`'s sheet is a native `<dialog>` opened by an `onClick` handler: a
 * click that lands before React attaches it does nothing at all — no error, no
 * dialog, and ten seconds later `toBeVisible` reports "element(s) not found".
 * Reproduced on `--project=no-webgl` under six workers, five runs out of six.
 *
 * Only the CLICK is retried, and only while the dialog is closed (the open
 * sheet is modal, so its backdrop covers the button). The assertion that the
 * menu opens is unchanged — a menu that never opens still fails, it just fails
 * for a reason about the menu.
 */
async function openHeaderMenu(page: Page, locale: Locale): Promise<void> {
  const button = page.getByRole("button", { name: COMMON[locale].nav.openMenu });
  const dialog = page.getByRole("dialog", { name: COMMON[locale].nav.menu });

  await expect(button).toBeVisible();
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

forEachLocale((locale) => {
  for (const target of TARGETS) {
    test(`${target.label} has no serious or critical axe violation (${locale})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const problems: string[] = [];

      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme });
        const response = await page.goto(href(locale, target.key, target.params), {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), `${target.label} did not render`).toBe(200);
        await target.settle?.(page);

        const report = await axeReport(page, `${target.label} · ${locale} · ${scheme}`);
        if (report) problems.push(report);
      }

      expect(problems.join("\n\n"), problems.join("\n\n")).toBe("");
    });
  }

  test(`the open header menu has no serious or critical axe violation (${locale})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // The sheet exists below lg only; narrow the viewport so this row runs on
    // every project rather than being skipped wherever the nav is inline.
    await page.setViewportSize({ width: 390, height: 844 });
    const problems: string[] = [];

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(href(locale, "/"), { waitUntil: "domcontentloaded" });

      await openHeaderMenu(page, locale);

      const report = await axeReport(page, `header menu · ${locale} · ${scheme}`);
      if (report) problems.push(report);
    }

    expect(problems.join("\n\n"), problems.join("\n\n")).toBe("");
  });
});
