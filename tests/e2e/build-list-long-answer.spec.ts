/**
 * One over-long answer on a to-fix list, in a real browser (`.debug/017` §5.9).
 *
 * The defect, live on production until 2026-10-13: "Référence des plaquettes"
 * took any number of characters, a guest's list was written with them, and the
 * page — whose parser refused the whole list for one answer over 64 — showed
 * "Rien à acheter pour l'instant" from the 65th character on, after every
 * reload, with the card that held the field gone. A product title copied off a
 * shop's page (99 characters here) is what a visitor pastes there.
 *
 * `components/build-list/BuildList.long-answer.test.tsx` holds the same thing
 * through the real components in jsdom, where `maxLength` is user-event's
 * imitation of a browser's. Two things only a browser can say:
 *
 *   1. **The inputs cannot produce it.** A guest on the demo bike makes a list
 *      in the real wizard — no fixture — then types 80 characters into the
 *      reference field, pastes a product title into it, and types 70 digits
 *      into the number field next to it, where `maxlength` does not apply.
 *      Each time the list is still there, and still there after a reload.
 *   2. **A browser that already holds one recovers by itself.** The storage is
 *      what a visitor of production still has: the wizard's own list, and the
 *      long answer written by the list page of before the fix
 *      (`tests/_helpers/guest-work.ts`, `listPageEdit` — held to the real page
 *      in the jsdom file). The list is on screen at the first load, for the
 *      demo bike and for a guest's own; the read wrote nothing; and the next
 *      tick writes the list without the long answer.
 *
 * A paste is done twice. First as text inserted without key presses
 * (`keyboard.insertText`, the path an input method takes), in every browser:
 * that is the assertion every project makes. Then, in Chromium, as a REAL
 * paste — the clipboard written, Ctrl/Cmd+V pressed — when the browser lets
 * the page write the clipboard; when it does not, the test says so in an
 * annotation and that second paste is not made (it ran on macOS, in the
 * headless shell, when this was written; a Linux runner was not tried).
 * Both go through the browser's own editing, which is where `maxlength` lives.
 *
 * Every test runs in FR and EN: the labels the fields are found by, and the
 * sentences asserted, are each language's own.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures */
import type { Locator, Page } from "@playwright/test";

import { buildOf, deriveBike } from "../../lib/bike/rules";
import { encodeSpec } from "../../lib/bike/spec-codec";
import { buildListKey, LOCAL_BIKE_KEY, type GuestBikeRef } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { MAX_REFINEMENT_VALUE_LENGTH } from "../../lib/shop/refinement";
import enParts from "../../messages/en/parts.json";
import enShop from "../../messages/en/shop.json";
import frParts from "../../messages/fr/parts.json";
import frShop from "../../messages/fr/shop.json";
import {
  guestWork,
  listPageEdit,
  memoryStorage,
  writeGuestList,
  type MemoryStorage,
  type StoredListLine,
} from "../_helpers/guest-work";
import {
  CHAIN,
  FRONT_PADS,
  PAD_WEAR,
  PRODUCT_TITLE,
  REAR_PADS,
  wornPadsAndChain,
} from "../_helpers/long-answers";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const SHOP_T: Record<Locale, typeof frShop> = { fr: frShop, en: enShop };
const PARTS_T: Record<Locale, typeof frParts> = { fr: frParts, en: enParts };

const CAP = MAX_REFINEMENT_VALUE_LENGTH;
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";

/** "{done} sur {total} fait" / "{done} of {total} done", filled in. */
function doneState(locale: Locale, done: number, total: number): string {
  return SHOP_T[locale].list.done.state
    .replace("{done}", String(done))
    .replace("{total}", String(total));
}

function card(page: Page, partId: string): Locator {
  return page.locator(`[data-testid="build-item"][data-part-id="${partId}"]`);
}

/** The lines `va:buildlist:<ref>` holds, as JSON holds them. */
async function storedLines(page: Page, ref: GuestBikeRef): Promise<StoredListLine[]> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), buildListKey(ref));
  if (raw === null) return [];
  const stored = JSON.parse(raw) as { items: StoredListLine[] } | StoredListLine[];
  return Array.isArray(stored) ? stored : stored.items;
}

/** The longest answer any line of the stored list holds. */
async function longestStoredAnswer(page: Page, ref: GuestBikeRef): Promise<number> {
  const lines = await storedLines(page, ref);
  return Math.max(
    0,
    ...lines.flatMap((line) =>
      Object.values((line.refinement ?? {}) as Record<string, unknown>).map((value) =>
        typeof value === "string" ? value.length : 0,
      ),
    ),
  );
}

/** The whole list is on screen: `count` cards, and not the "nothing to buy" page. */
async function expectTheList(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId("build-list")).toBeVisible();
  await expect(page.getByTestId("build-item")).toHaveCount(count);
  await expect(page.getByTestId("build-list-empty")).toHaveCount(0);
  await expect(page.getByTestId("build-list-save-failed")).toHaveCount(0);
}

forEachLocale((locale) => {
  const padModel = PARTS_T[locale].attr["pad-model"].label;
  const padThickness = PARTS_T[locale].attr["pad-thickness"].label;

  /**
   * Put `text` on the clipboard and paste it into the focused field, the way
   * a person does. `false` when this browser does not let the page write the
   * clipboard: nothing was pasted, and the caller says so.
   */
  async function pasteFromTheClipboard(page: Page, text: string): Promise<boolean> {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"])
      .catch(() => undefined);
    const written = await page.evaluate(
      (value) =>
        navigator.clipboard.writeText(value).then(
          () => true,
          () => false,
        ),
      text,
    );
    if (written) await page.keyboard.press("ControlOrMeta+V");
    return written;
  }

  test(`a guest on the demo bike types and pastes far more than a reference: the field stops, and the list stays (${locale})`, async ({
    page,
    browserName,
  }, testInfo) => {
    // The list, made by the application: the brakes checked in the real
    // wizard, the pads found worn — front and rear, two lines. Both pads are
    // picked: a checkup limited to the rear ones lists the rear ones only
    // (`.debug/017` §5.11); until 2026-10-22 it listed both.
    await page.goto(
      href(
        locale,
        "/velo/[id]/controle",
        { id: "demo" },
        { parts: "brake-pads-front,brake-pads-rear" },
      ),
    );
    await page.getByTestId("checkup-start").click();
    const wizard = page.getByTestId("checkup-wizard");
    for (let guard = 0; guard < 10; guard += 1) {
      if ((await wizard.getAttribute("data-phase")) === "summary") break;
      const step = page.getByTestId("step-card");
      const key = await step.getAttribute("data-step-key");
      if (key === PAD_WEAR) {
        await page.getByTestId("verdict-ko").click();
        await page.getByTestId("symptom-pad-worn").click();
      } else {
        await page.getByTestId("verdict-ok").click();
      }
      await expect
        .poll(async () =>
          (await wizard.getAttribute("data-phase")) === "summary"
            ? "summary"
            : await page.getByTestId("step-card").getAttribute("data-step-key"),
        )
        .not.toBe(key);
    }
    await page.getByTestId("summary-create").click();
    await page.waitForURL(
      (url) => url.pathname === href(locale, "/velo/[id]/liste", { id: "demo" }),
    );
    await expectTheList(page, 2);

    const rear = card(page, "brake-pads-rear");
    const reference = rear.getByLabel(padModel, { exact: true });

    // ── typed: an 80-character note, one key at a time ──────────────────────
    const typed =
      "plaquettes metal fritte a ailettes pour etrier quatre pistons, usage enduro (x2)";
    expect(typed).toHaveLength(80);
    await reference.click();
    // Up to the cap first: on the site of before the fix the 65th key press
    // took the field itself off the page, and the rest had nowhere to go.
    await reference.pressSequentially(typed.slice(0, CAP));
    await expect(reference).toHaveValue(typed.slice(0, CAP));
    await expectTheList(page, 2);
    await page.keyboard.type(typed.slice(CAP));
    await expectTheList(page, 2);
    await expect(reference).toHaveValue(typed.slice(0, CAP));
    await expect.poll(() => longestStoredAnswer(page, "demo")).toBe(CAP);
    // It is the BROWSER that stopped the typing: without the attribute the
    // form would cut the text itself (`clipRefinementText`), one write a key.
    await expect(reference).toHaveAttribute("maxlength", String(CAP));

    await page.reload();
    await expectTheList(page, 2);
    await expect(card(page, "brake-pads-rear").getByLabel(padModel, { exact: true })).toHaveValue(
      typed.slice(0, CAP),
    );

    // ── pasted: a product title, 99 characters ──────────────────────────────
    const again = card(page, "brake-pads-rear").getByLabel(padModel, { exact: true });
    await again.fill("");
    await again.focus();
    await page.keyboard.insertText(PRODUCT_TITLE);
    await expect(again).toHaveValue(PRODUCT_TITLE.slice(0, CAP));
    await expectTheList(page, 2);
    await expect.poll(() => longestStoredAnswer(page, "demo")).toBe(CAP);

    // …and the same title off the clipboard, where a test may put one there.
    if (browserName === "chromium") {
      await again.fill("");
      await expect.poll(() => longestStoredAnswer(page, "demo")).toBe(0);
      await again.focus();
      if (await pasteFromTheClipboard(page, PRODUCT_TITLE)) {
        await expect(again).toHaveValue(PRODUCT_TITLE.slice(0, CAP));
        await expectTheList(page, 2);
        await expect.poll(() => longestStoredAnswer(page, "demo")).toBe(CAP);
      } else {
        testInfo.annotations.push({
          type: "clipboard",
          description: "this browser refused the clipboard write: the real paste was not made",
        });
        await page.keyboard.insertText(PRODUCT_TITLE);
        await expect(again).toHaveValue(PRODUCT_TITLE.slice(0, CAP));
      }
    }

    await page.reload();
    await expectTheList(page, 2);
    await expect(card(page, "brake-pads-rear").getByLabel(padModel, { exact: true })).toHaveValue(
      PRODUCT_TITLE.slice(0, CAP),
    );

    // ── a number field, where `maxlength` does not apply: 70 digits ─────────
    const thickness = card(page, "brake-pads-rear").getByLabel(padThickness, { exact: true });
    await expect(thickness).toHaveAttribute("type", "number");
    await thickness.click();
    await thickness.pressSequentially("1".repeat(70));
    // Whatever the browser makes of 70 digits, nothing over the cap is stored…
    await expect.poll(() => longestStoredAnswer(page, "demo")).toBeLessThanOrEqual(CAP);
    expect((await thickness.inputValue()).length).toBeLessThanOrEqual(CAP);
    // …and the list is there, now and after a reload.
    await expectTheList(page, 2);
    await page.reload();
    await expectTheList(page, 2);
    await expect(card(page, "brake-pads-rear").getByLabel(padModel, { exact: true })).toHaveValue(
      PRODUCT_TITLE.slice(0, CAP),
    );
  });

  /**
   * What a browser that pasted a product title on production holds today, for
   * the demo bike or for a guest's own: the wizard's three lines — front pads,
   * rear pads, chain — the chain ticked, and on the rear pads a thickness and
   * the title, written by the list page of before the fix.
   */
  function affectedBrowser(ref: GuestBikeRef): { storage: MemoryStorage; specCode: string | null } {
    let storage: MemoryStorage;
    let specCode: string | null = null;
    if (ref === "local") {
      const work = guestWork({
        answers: BIKE_PRESETS["gravel-1x11"],
        checkup: (build) => wornPadsAndChain(build, CHECKUP_ID),
      });
      storage = work.storage;
      specCode = encodeSpec(work.bike.answers);
    } else {
      // The demo bike is a preset: nothing of it is stored but its list.
      storage = memoryStorage();
      const demo = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));
      writeGuestList(storage, "demo", wornPadsAndChain(demo, CHECKUP_ID));
    }
    listPageEdit(storage, ref, CHAIN, (line) => ({ ...line, done: true, doneReason: "manual" }));
    listPageEdit(storage, ref, REAR_PADS, (line) => ({
      ...line,
      refinement: { "pad-thickness": "2", "pad-model": PRODUCT_TITLE },
    }));
    return { storage, specCode };
  }

  for (const ref of ["demo", "local"] as const) {
    test(`a browser that already holds a pasted product title shows its list again, by itself — ${ref} bike (${locale})`, async ({
      page,
    }) => {
      const { storage, specCode } = affectedBrowser(ref);
      const keys = [LOCAL_BIKE_KEY, buildListKey(ref)].filter((key) => storage.map.has(key));
      const bytes = storage.getItem(buildListKey(ref))!;
      // The poison is really there: what this browser holds, production's page
      // of before the fix could not open.
      expect(bytes).toContain(PRODUCT_TITLE);

      // Written once, with `evaluate` after a first document — never an init
      // script, which would put the long answer back at every reload.
      await page.goto(href(locale, "/"));
      await page.evaluate(
        (pairs: [string, string][]) => {
          for (const [key, value] of pairs) window.localStorage.setItem(key, value);
        },
        keys.map((key): [string, string] => [key, storage.getItem(key)!]),
      );

      const list = href(
        locale,
        "/velo/[id]/liste",
        { id: ref },
        specCode === null ? undefined : { spec: specCode },
      );
      await page.goto(list);

      // Every line, with nothing done by the visitor: the tick…
      await expectTheList(page, 3);
      await expect(page.getByTestId("build-list-state")).toHaveText(doneState(locale, 1, 3));
      await expect(card(page, "chain").getByTestId("build-item-done")).toBeChecked();
      // …the other answer of the very line that held the long one…
      const rear = card(page, "brake-pads-rear");
      await expect(rear.getByLabel(padThickness, { exact: true })).toHaveValue("2");
      // …and the field itself, empty and there to be filled again.
      await expect(rear.getByLabel(padModel, { exact: true })).toHaveValue("");
      // Looking at the list wrote nothing.
      expect(
        await page.evaluate((key) => window.localStorage.getItem(key), buildListKey(ref)),
      ).toBe(bytes);

      await page.reload();
      await expectTheList(page, 3);
      expect(
        await page.evaluate((key) => window.localStorage.getItem(key), buildListKey(ref)),
      ).toBe(bytes);

      // The next edit — the front pads ticked — writes the list without the
      // long answer, and it does not hide the list again.
      await card(page, FRONT_PADS.partId).getByTestId("build-item-done").check();
      await expect(page.getByTestId("build-list-state")).toHaveText(doneState(locale, 2, 3));
      await expect.poll(() => longestStoredAnswer(page, ref)).toBeLessThanOrEqual(CAP);
      const rearLine = (await storedLines(page, ref)).find(
        (line) => line.partId === REAR_PADS.partId,
      );
      expect(rearLine?.refinement).toEqual({ "pad-thickness": "2" });

      await page.reload();
      await expectTheList(page, 3);
      await expect(page.getByTestId("build-list-state")).toHaveText(doneState(locale, 2, 3));
    });
  }
});
