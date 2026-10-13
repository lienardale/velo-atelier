/**
 * One over-long answer on a to-fix list (`.debug/017` §5.9) — through the REAL
 * `BuildList` and `RefinementForm`, over a storage the wizard's own writers
 * filled.
 *
 * The defect, live on production until 2026-10-13: the list's form drew its
 * free-text fields with no limit; a guest's edit was written to
 * `localStorage` as typed; and the page's parser held a refinement value to 64
 * characters by refusing the whole LIST. So the 65th character typed into
 * "Référence des plaquettes" — or a product title pasted there — turned the
 * page into "Rien à acheter pour l'instant", on the demo bike and on a guest's
 * own, at once and after every reload, with the card that held the field gone
 * and nothing said.
 *
 * `BuildList.test.tsx` had the parser, the list and the form — each fed
 * `item()`, a hand-written line with a refinement nobody had typed. What it
 * did not have is the three of them together under what a person does. So
 * here:
 *
 *   - the storage is written by `writeLocalBike`, the real plan and reducer,
 *     and `writeGuestBuildList` (`tests/_helpers/guest-work.ts`) — and "a list
 *     as the old page left it" by `listPageEdit`, which this file holds to the
 *     real page (the last block);
 *   - typing and pasting go through user-event, which applies `maxLength` the
 *     way a browser does (a real browser is `tests/e2e/build-list-long-answer.spec.ts`);
 *   - "a reload" is the page mounted again with the parser's memo dropped.
 *
 * Only the saved bike's three server actions are stand-ins: they reach
 * `@/auth` and Prisma, and `tests/integration/build-lists.test.ts` is where
 * they meet a database.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { buildListKey, type GuestBikeRef } from "@/lib/bike/storage-keys";
import { deriveBuildList } from "@/lib/checkup/build-list";
import { writeGuestBuildList } from "@/lib/checkup/storage";
import type { BuildListItem } from "@/lib/checkup/types";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { MAX_REFINEMENT_VALUE_LENGTH } from "@/lib/shop/refinement";
import {
  guestRun,
  listPageEdit,
  memoryStorage,
  planFromDisk,
  storedListLines,
  writeGuestList,
  type StoredListLine,
} from "@/tests/_helpers/guest-work";
import { renderWithIntl } from "@/tests/_helpers/intl";
import {
  CHAIN,
  CHAIN_WEAR,
  FRONT_PADS,
  HANGER,
  PAD_WEAR,
  partialCheckup,
  PRODUCT_TITLE,
  PRODUCT_URL,
  REAR_PADS,
  wornPadsAndChain,
} from "@/tests/_helpers/long-answers";

type ActionMock = (input: unknown) => Promise<{ ok: boolean; data?: unknown; code?: string }>;

const setBuildListItemDoneAction = vi.fn<ActionMock>(async () => ({ ok: true, data: null }));
const setBuildListItemRefinementAction = vi.fn<ActionMock>(async () => ({ ok: true, data: null }));
const clearDoneBuildListItemsAction = vi.fn<ActionMock>(async () => ({
  ok: true,
  data: { removed: 0 },
}));
vi.mock("@/app/[locale]/velo/[id]/liste/actions", () => ({
  setBuildListItemDoneAction: (input: unknown) => setBuildListItemDoneAction(input),
  setBuildListItemRefinementAction: (input: unknown) => setBuildListItemRefinementAction(input),
  clearDoneBuildListItemsAction: (input: unknown) => clearDoneBuildListItemsAction(input),
}));

const { BuildList, MAX_BUILD_LIST_ITEMS, parseBuildList, resetBuildListSnapshotCache } =
  await import("./BuildList");

// Hoisted: deriving a build walks the whole catalogue (`.debug/009`).
const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));

const FIRST_CHECKUP = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const SECOND_CHECKUP = "8b2e6c14-5d3f-4a7b-9e10-c2f4a6b8d0e1";

const CAP = MAX_REFINEMENT_VALUE_LENGTH;

/** The brands the page hands down for the pads: with them a pads card has its three controls. */
const PAD_TIERS = { entry: ["Clarks"], mid: ["Shimano"], high: ["SwissStop"] };

/** A link §4.4 allows: https, on the named retailer's own host. */
const CHOSEN_PADS = {
  brand: "Shimano",
  model: "J04C",
  size: "paire",
  vendor: "alltricks",
  url: "https://www.alltricks.fr/C-40598-toutes-les-plaquettes",
};

/** The list "Créer ma liste" leaves for `ref`: front pads, rear pads, chain — three lines to replace. */
function listFromTheWizard(ref: GuestBikeRef): void {
  writeGuestList(window.localStorage, ref, wornPadsAndChain(gravel, FIRST_CHECKUP));
}

function renderList(ref: GuestBikeRef) {
  resetBuildListSnapshotCache();
  return renderWithIntl(
    <BuildList
      bikeRef={{ kind: ref }}
      bikeParam={ref}
      build={gravel}
      locale="fr"
      initialItems={null}
      buildListId={null}
      brandsByPart={{ "brake-pads-front": PAD_TIERS, "brake-pads-rear": PAD_TIERS }}
    />,
  );
}

const cards = (): HTMLElement[] => screen.queryAllByTestId("build-item");
const card = (partId: string): HTMLElement => {
  const found = cards().find((candidate) => candidate.getAttribute("data-part-id") === partId);
  if (found === undefined) throw new Error(`no card for "${partId}" — ${screenState()}`);
  return found;
};
const control = <T extends HTMLElement = HTMLInputElement>(partId: string, key: string): T => {
  const found = card(partId).querySelector<T>(`[data-question="${key}"]`);
  if (found === null) throw new Error(`"${partId}" asks no "${key}"`);
  return found;
};
const raw = (ref: GuestBikeRef): string | null => window.localStorage.getItem(buildListKey(ref));
const lines = (ref: GuestBikeRef): StoredListLine[] => storedListLines(window.localStorage, ref);
const storedLine = (ref: GuestBikeRef, partId: string): StoredListLine =>
  lines(ref).find((line) => line.partId === partId)!;

/** What the page shows, in one line — the assertion below says which half is wrong. */
function screenState(): string {
  const list = screen.queryByTestId("build-list") === null ? "absent" : "present";
  const empty = screen.queryByTestId("build-list-empty") === null ? "absent" : "PRESENT";
  return `build-list=${list} cards=${cards().length} empty-state=${empty} alerts=${screen.queryAllByRole("alert").length}`;
}
const WHOLE = "build-list=present cards=3 empty-state=absent alerts=0";

/** The longest value any line of the stored list holds. */
function longestStoredValue(ref: GuestBikeRef): number {
  return Math.max(
    0,
    ...lines(ref).flatMap((line) =>
      Object.values((line.refinement ?? {}) as Record<string, unknown>).map((value) =>
        typeof value === "string" ? value.length : 0,
      ),
    ),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetBuildListSnapshotCache();
  setBuildListItemDoneAction.mockClear();
  setBuildListItemRefinementAction.mockClear();
  clearDoneBuildListItemsAction.mockClear();
});

const BIKES = [
  { bike: "the demo bike", ref: "demo" },
  { bike: "a guest's own bike", ref: "local" },
] as const;

describe.each(BIKES)("$bike — what the form's controls can put in the list", ({ ref }) => {
  it("every free-text field stops at the cap; a number field has no such attribute", async () => {
    // The pads, the chain — and the rear derailleur, whose line a bent hanger adds.
    writeGuestList(
      window.localStorage,
      ref,
      partialCheckup({
        id: FIRST_CHECKUP,
        build: gravel,
        ko: {
          [PAD_WEAR]: "pad-worn",
          [CHAIN_WEAR]: "chain-elongation",
          [HANGER]: "hanger-bent",
        },
        at: "2026-09-14T08:00:00.000Z",
      }),
    );
    await renderList(ref);

    const TEXT = [
      // The two genuine text attributes…
      ["brake-pads-rear", "pad-model"],
      ["brake-pads-front", "pad-model"],
      ["rear-derailleur", "hanger-model"],
      // …and the yes/no ones this form still draws as a text box.
      ["chain", "e-rated"],
      ["rear-derailleur", "clutch"],
    ] as const;
    for (const [partId, key] of TEXT) {
      const input = control(partId, key);
      expect(input.type, `${partId} ${key}`).toBe("text");
      expect(input.getAttribute("maxlength"), `${partId} ${key}`).toBe(String(CAP));
    }
    for (const [partId, key] of [
      ["brake-pads-rear", "pad-thickness"],
      ["rear-derailleur", "max-cog"],
    ] as const) {
      const input = control(partId, key);
      expect(input.type, `${partId} ${key}`).toBe("number");
      // `maxlength` does not apply to a number field: the form holds those itself.
      expect(input.hasAttribute("maxlength"), `${partId} ${key}`).toBe(false);
    }
  });

  it("typing: the 65th character is not taken — the list stays, at once and after a reload", async () => {
    listFromTheWizard(ref);
    const view = await renderList(ref);
    expect(screenState()).toBe(WHOLE);

    // An 80-character note, one key at a time.
    const typed =
      "plaquettes metal fritte a ailettes pour etrier quatre pistons, usage enduro (x2)";
    expect(typed).toHaveLength(80);
    await view.user.type(control("brake-pads-rear", "pad-model"), typed);

    expect(control("brake-pads-rear", "pad-model").value).toBe(typed.slice(0, CAP));
    expect(screenState()).toBe(WHOLE);
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({
      "pad-model": typed.slice(0, CAP),
    });
    expect(longestStoredValue(ref)).toBe(CAP);

    view.unmount();
    await renderList(ref);
    expect(screenState(), "after a reload").toBe(WHOLE);
    expect(control("brake-pads-rear", "pad-model").value).toBe(typed.slice(0, CAP));
  });

  it("pasting a 99-character product title: the field keeps its beginning, and the list stays", async () => {
    listFromTheWizard(ref);
    const view = await renderList(ref);

    await view.user.click(control("brake-pads-rear", "pad-model"));
    await view.user.paste(PRODUCT_TITLE);

    expect(control("brake-pads-rear", "pad-model").value).toBe(PRODUCT_TITLE.slice(0, CAP));
    expect(screenState()).toBe(WHOLE);
    expect(longestStoredValue(ref)).toBe(CAP);
    // What is in storage is a list the page reads — the whole of it.
    expect(parseBuildList(raw(ref))).toHaveLength(3);

    view.unmount();
    await renderList(ref);
    expect(screenState(), "after a reload").toBe(WHOLE);
    expect(control("brake-pads-rear", "pad-model").value).toBe(PRODUCT_TITLE.slice(0, CAP));
  });

  it("pasting an address into a field that already holds a reference: only what fits is added", async () => {
    listFromTheWizard(ref);
    const view = await renderList(ref);

    await view.user.type(control("brake-pads-rear", "pad-model"), "J04C ");
    await view.user.paste(PRODUCT_URL);

    const kept = `J04C ${PRODUCT_URL}`.slice(0, CAP);
    expect(control("brake-pads-rear", "pad-model").value).toBe(kept);
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({ "pad-model": kept });
    expect(screenState()).toBe(WHOLE);
  });

  it("text that reaches the form PAST the attribute is cut the same way, and the list stays", async () => {
    // `fireEvent` sets the value and dispatches: nothing applies `maxLength`
    // on the way. A browser does not do this to a visitor; the form does not
    // depend on that.
    listFromTheWizard(ref);
    const view = await renderList(ref);

    fireEvent.change(control("brake-pads-rear", "pad-model"), { target: { value: PRODUCT_URL } });

    expect(control("brake-pads-rear", "pad-model").value).toBe(PRODUCT_URL.slice(0, CAP));
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({
      "pad-model": PRODUCT_URL.slice(0, CAP),
    });
    expect(screenState()).toBe(WHOLE);

    view.unmount();
    await renderList(ref);
    expect(screenState(), "after a reload").toBe(WHOLE);
  });

  it("a number field given 65 digits: nothing over the cap is stored, the field keeps what it held, the list stays", async () => {
    // user-event rewrites a number field's value through `Number()` (its own
    // jsdom workaround), which turns 65 digits into 22 characters of exponent
    // notation: typed that way, this case cannot fail. A browser hands the
    // page the digits as typed, so they are given as typed here.
    listFromTheWizard(ref);
    const view = await renderList(ref);
    const thickness = (): HTMLInputElement => control("brake-pads-rear", "pad-thickness");

    fireEvent.change(thickness(), { target: { value: "2.5" } });
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({ "pad-thickness": "2.5" });

    const digits = "1".repeat(CAP + 1);
    fireEvent.change(thickness(), { target: { value: digits } });

    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({ "pad-thickness": "2.5" });
    expect(thickness().value).toBe("2.5");
    expect(screenState()).toBe(WHOLE);

    // Exactly at the cap is an answer like any other: absurd, stored, harmless.
    fireEvent.change(thickness(), { target: { value: "1".repeat(CAP) } });
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({
      "pad-thickness": "1".repeat(CAP),
    });
    expect(screenState()).toBe(WHOLE);

    view.unmount();
    await renderList(ref);
    expect(screenState(), "after a reload").toBe(WHOLE);
  });
});

describe.each(BIKES)("$bike — a browser that ALREADY holds an over-long answer", ({ ref }) => {
  /**
   * The list as a visitor of production left it: three lines from the
   * wizard, the chain ticked, a product chosen for the front pads, and on the
   * rear pads a thickness, a price tier — and `long` under the reference,
   * written by the list page of before the fix.
   */
  function listHolding(long: string): string {
    listFromTheWizard(ref);
    listPageEdit(window.localStorage, ref, CHAIN, (line) => ({
      ...line,
      done: true,
      doneReason: "manual",
    }));
    listPageEdit(window.localStorage, ref, FRONT_PADS, (line) => ({
      ...line,
      chosenProduct: CHOSEN_PADS,
    }));
    listPageEdit(window.localStorage, ref, REAR_PADS, (line) => ({
      ...line,
      refinement: { "pad-thickness": "2", "brand-tier": "mid", "pad-model": long },
    }));
    return raw(ref)!;
  }

  it.each([
    ["a 99-character product title", PRODUCT_TITLE],
    ["a 138-character product address", PRODUCT_URL],
    ["one character over the cap", "r".repeat(CAP + 1)],
    ["5 000 characters", "r".repeat(5000)],
  ])(
    "%s: every line is on screen, with its tick, its product and its other answers — and nothing was written",
    async (_what, long) => {
      const bytes = listHolding(long);
      const view = await renderList(ref);

      expect(screenState()).toBe(WHOLE);
      // The tick…
      expect(screen.getByTestId("build-list-state")).toHaveTextContent("1 sur 3 fait");
      expect(within(card("chain")).getByTestId("build-item-done")).toBeChecked();
      // …the product…
      expect(within(card("brake-pads-front")).getByTestId("build-item-chosen")).toHaveTextContent(
        "Shimano J04C",
      );
      // …the other answers of the very line that held the long one…
      expect(control("brake-pads-rear", "pad-thickness").value).toBe("2");
      expect(control<HTMLSelectElement>("brake-pads-rear", "brand-tier").value).toBe("mid");
      // …and the field the long one was typed in is there to be filled again.
      expect(control("brake-pads-rear", "pad-model").value).toBe("");
      // Reading wrote nothing: the bytes are the ones the old page left.
      expect(raw(ref)).toBe(bytes);

      view.unmount();
      await renderList(ref);
      expect(screenState(), "after a reload").toBe(WHOLE);
      expect(raw(ref)).toBe(bytes);
    },
  );

  it("the next edit writes the list WITHOUT the long answer, and does not hide it again", async () => {
    listHolding(PRODUCT_TITLE);
    const view = await renderList(ref);

    // Any edit: the front pads ticked.
    await view.user.click(within(card("brake-pads-front")).getByTestId("build-item-done"));

    expect(screenState()).toBe(WHOLE);
    expect(screen.getByTestId("build-list-state")).toHaveTextContent("2 sur 3 fait");
    // The long answer left storage with that write; nothing else did.
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({
      "pad-thickness": "2",
      "brand-tier": "mid",
    });
    expect(longestStoredValue(ref)).toBeLessThanOrEqual(CAP);
    expect(storedLine(ref, "brake-pads-front")).toMatchObject({
      done: true,
      doneReason: "manual",
      chosenProduct: CHOSEN_PADS,
    });
    expect(storedLine(ref, "chain")).toMatchObject({ done: true, doneReason: "manual" });

    view.unmount();
    await renderList(ref);
    expect(screenState(), "after a reload").toBe(WHOLE);
  });

  it("the reference typed again, short this time, is kept beside the other answers", async () => {
    listHolding(PRODUCT_URL);
    const view = await renderList(ref);

    await view.user.type(control("brake-pads-rear", "pad-model"), "J04C");

    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({
      "pad-thickness": "2",
      "brand-tier": "mid",
      "pad-model": "J04C",
    });
    expect(screenState()).toBe(WHOLE);
  });

  it("the next CHECKUP merges into it and the list is still on screen, with the new finding and without the long answer", async () => {
    listHolding(PRODUCT_TITLE);

    // A later checkup, by the wizard's own write: the pads are still worn —
    // their lines are derived again — the chain is fine now, and the hanger
    // is bent: a line the list did not have.
    writeGuestList(
      window.localStorage,
      ref,
      partialCheckup({
        id: SECOND_CHECKUP,
        build: gravel,
        ko: { [PAD_WEAR]: "pad-worn", [HANGER]: "hanger-bent" },
        at: "2026-10-01T08:00:00.000Z",
      }),
    );
    expect(longestStoredValue(ref), "what the merge wrote").toBeLessThanOrEqual(CAP);
    expect(storedLine(ref, "brake-pads-rear").refinement).toEqual({
      "pad-thickness": "2",
      "brand-tier": "mid",
    });

    await renderList(ref);
    expect(screenState()).toBe("build-list=present cards=4 empty-state=absent alerts=0");
    expect(card("rear-derailleur")).toBeInTheDocument();
    expect(control("brake-pads-rear", "pad-thickness").value).toBe("2");
    expect(within(card("brake-pads-front")).getByTestId("build-item-chosen")).toHaveTextContent(
      "Shimano J04C",
    );
  });

  it("a number field's stored 65 digits cost that answer, and nothing else", async () => {
    listFromTheWizard(ref);
    listPageEdit(window.localStorage, ref, REAR_PADS, (line) => ({
      ...line,
      refinement: { "pad-model": "J04C", "pad-thickness": "1".repeat(CAP + 1) },
    }));
    await renderList(ref);

    expect(screenState()).toBe(WHOLE);
    expect(control("brake-pads-rear", "pad-model").value).toBe("J04C");
    expect(control("brake-pads-rear", "pad-thickness").value).toBe("");
  });
});

describe("what a bad value of a stored line costs — field by field", () => {
  /** The three lines the wizard wrote, as JSON holds them, in the page's envelope. */
  function storedLines(): StoredListLine[] {
    const storage = memoryStorage();
    writeGuestList(storage, "local", wornPadsAndChain(gravel, FIRST_CHECKUP));
    return storedListLines(storage, "local");
  }
  const envelope = (items: unknown): string =>
    JSON.stringify({ version: 1, items, updatedAt: "2026-09-14T08:00:00.000Z" });
  /** The list with exactly one thing broken: `field` of the rear pads' line set to `value`. */
  const withRearPads = (field: string, value: unknown): string =>
    envelope(
      storedLines().map((line) =>
        line.partId === "brake-pads-rear" ? { ...line, [field]: value } : line,
      ),
    );
  const partIds = (items: readonly BuildListItem[] | null): string[] | null =>
    items === null ? null : items.map((line) => line.partId);
  const ALL = ["brake-pads-front", "brake-pads-rear", "chain"];

  it("reads the wizard's three lines whole — the control for every row below", () => {
    expect(partIds(parseBuildList(envelope(storedLines())))).toEqual(ALL);
  });

  // What the VISITOR types or picks: at most what they typed.
  it.each([
    ["a value over the cap", { "pad-model": PRODUCT_TITLE, "pad-thickness": "2" }],
    ["a value that is a number", { "pad-model": 11, "pad-thickness": "2" }],
    ["a value that is null", { "pad-model": null, "pad-thickness": "2" }],
    ["a value that is an object", { "pad-model": { ref: "J04C" }, "pad-thickness": "2" }],
    ["an over-long key", { ["k".repeat(65)]: "J04C", "pad-thickness": "2" }],
  ])("one refinement entry — %s — costs that ENTRY", (_what, refinement) => {
    const parsed = parseBuildList(withRearPads("refinement", refinement));
    expect(partIds(parsed)).toEqual(ALL);
    expect(parsed?.find((line) => line.partId === "brake-pads-rear")?.refinement).toEqual({
      "pad-thickness": "2",
    });
  });

  it.each([
    ["a string", "pad-model=J04C"],
    ["an array", ["pad-model", "J04C"]],
    ["null", null],
    ["a number", 64],
    ["nothing but an over-long answer", { "pad-model": PRODUCT_URL }],
  ])("a refinement that is %s costs that line's REFINEMENT, never the line", (_what, value) => {
    const parsed = parseBuildList(withRearPads("refinement", value));
    expect(partIds(parsed)).toEqual(ALL);
    const rear = parsed?.find((line) => line.partId === "brake-pads-rear");
    expect(rear).toBeDefined();
    expect(Object.hasOwn(rear as object, "refinement")).toBe(false);
  });

  it("a chosen product whose link breaks §4.4 costs the PRODUCT (unchanged)", () => {
    const parsed = parseBuildList(
      withRearPads("chosenProduct", { ...CHOSEN_PADS, url: "https://evil.example/x" }),
    );
    expect(partIds(parsed)).toEqual(ALL);
    expect(
      parsed?.find((line) => line.partId === "brake-pads-rear")?.chosenProduct,
    ).toBeUndefined();
  });

  it("a part this release has no part for costs the LINE (unchanged)", () => {
    expect(partIds(parseBuildList(withRearPads("partId", "sprocket")))).toEqual([
      "brake-pads-front",
      "chain",
    ]);
  });

  it("the lines after the 80th cost those LINES (unchanged)", () => {
    const [line] = storedLines();
    const many = Array.from({ length: MAX_BUILD_LIST_ITEMS + 5 }, (_, index) => ({
      ...line,
      id: `${line.id as string}-${index}`,
      sortOrder: index,
    }));
    expect(parseBuildList(envelope(many))).toHaveLength(MAX_BUILD_LIST_ITEMS);
  });

  // What only the APPLICATION writes: the list, as before. None of these is a
  // value a control of the page can produce — the block after this one is
  // what holds that for the writers.
  it.each([
    ["id", 7],
    ["id", "i".repeat(201)],
    ["stepKey", null],
    ["sourceKeys", "check-brakes-disc#pad-wear"],
    ["partId", "p".repeat(65)],
    ["action", "burn"],
    ["reasonKey", "r".repeat(81)],
    ["guideSlug", "g".repeat(161)],
    ["done", "yes"],
    ["doneReason", "because"],
    ["sortOrder", "first"],
    ["sortOrder", null],
  ])(
    "a line whose `%s` is %j costs the LIST (unchanged: only the application writes it)",
    (field, value) => {
      expect(parseBuildList(withRearPads(field, value))).toBeNull();
    },
  );

  it.each([
    ["not JSON", "{not json"],
    ["a string", JSON.stringify("liste")],
    ["an unknown version", JSON.stringify({ version: 2, items: [], updatedAt: "x" })],
    ["no `updatedAt`", JSON.stringify({ version: 1, items: [] })],
    ["`items` that is not an array", JSON.stringify({ version: 1, items: {}, updatedAt: "x" })],
    [
      "a line that is not an object",
      JSON.stringify({ version: 1, items: ["chain"], updatedAt: "x" }),
    ],
  ])("a value that is %s costs the LIST (unchanged)", (_what, value) => {
    expect(parseBuildList(value)).toBeNull();
  });
});

describe("only the application writes the fields that cost the list — and what it writes reads back whole", () => {
  /**
   * The table above lets `id`, `stepKey`, `sourceKeys`, `action`, `reasonKey`,
   * `guideSlug` and `sortOrder` cost the list on the ground that no visitor
   * produces them. That is a claim about `deriveBuildList`, so it is checked
   * against everything `deriveBuildList` can say: the FULL plan of each of the
   * seven presets, every question answered "ça ne marche pas" with no symptom
   * picked — which lands every consequence of every step (§5.4).
   */
  it.each(Object.keys(BIKE_PRESETS) as PresetId[])(
    "%s: every line a full checkup can derive is read back as written",
    (preset) => {
      // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
      const build = buildOf(deriveBike(BIKE_PRESETS[preset]));
      const plan = planFromDisk(build, { kind: "full" });
      const everythingBroken = guestRun({
        id: FIRST_CHECKUP,
        build,
        scope: { kind: "full" },
        verdicts: Object.fromEntries(plan.map((step) => [step.key, "ko" as const])),
        startedAt: "2026-09-14T08:00:00.000Z",
        completedAt: "2026-09-14T09:00:00.000Z",
      });
      const derived = deriveBuildList(everythingBroken);
      expect(derived.length).toBeGreaterThan(20);

      const storage = memoryStorage();
      expect(writeGuestBuildList("local", derived, everythingBroken.id, storage)).toBe(true);
      const parsed = parseBuildList(storage.getItem(buildListKey("local")));

      // The page keeps a list's first 80 lines; every one of them, as written.
      expect(parsed).toEqual(derived.slice(0, MAX_BUILD_LIST_ITEMS));
    },
  );
});

describe("a saved bike — unchanged, except that the field now stops at the cap", () => {
  function renderSaved(items: BuildListItem[]) {
    return renderWithIntl(
      <BuildList
        bikeRef={{ kind: "db", id: "00000000-0000-4000-8000-000000000009" }}
        bikeParam="00000000-0000-4000-8000-000000000009"
        build={gravel}
        locale="fr"
        initialItems={items}
        buildListId="00000000-0000-4000-8000-00000000000a"
      />,
    );
  }
  /** The account's lines: the same three, as `liste/load.ts` hands them down. */
  const savedItems = (): BuildListItem[] =>
    deriveBuildList(wornPadsAndChain(gravel, FIRST_CHECKUP)).map((line, index) => ({
      ...line,
      id: `00000000-0000-4000-8000-0000000000${String(10 + index)}`,
    }));

  /** Every value the page sent to the refinement action, longest first. */
  const sentLengths = (): number[] =>
    setBuildListItemRefinementAction.mock.calls
      .flatMap(([input]) =>
        Object.values((input as { refinement: Record<string, string> }).refinement),
      )
      .map((value) => value.length)
      .sort((a, b) => b - a);

  it("a pasted product title is sent as its first 64 characters: no refused round trip, no alert", async () => {
    // The real action refuses a value over the cap (`tests/integration/
    // build-lists.test.ts`): that refusal was the visitor's "Modification non
    // enregistrée" before the field had a limit.
    setBuildListItemRefinementAction.mockImplementation(async (input) => {
      const { refinement } = input as { refinement: Record<string, string> };
      return Object.values(refinement).some((value) => value.length > CAP)
        ? { ok: false, code: "VALIDATION" }
        : { ok: true, data: null };
    });
    const { user } = await renderSaved(savedItems());

    await user.click(control("brake-pads-rear", "pad-model"));
    await user.paste(PRODUCT_TITLE);

    expect(setBuildListItemRefinementAction).toHaveBeenCalledTimes(1);
    expect(setBuildListItemRefinementAction).toHaveBeenCalledWith({
      itemId: "00000000-0000-4000-8000-000000000011",
      refinement: { "pad-model": PRODUCT_TITLE.slice(0, CAP) },
    });
    expect(control("brake-pads-rear", "pad-model").value).toBe(PRODUCT_TITLE.slice(0, CAP));
    expect(screen.queryByTestId("build-list-save-failed")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("80 characters typed: nothing over the cap is ever sent", async () => {
    const { user } = await renderSaved(savedItems());
    await user.type(control("brake-pads-rear", "pad-model"), "r".repeat(80));

    expect(sentLengths()[0]).toBe(CAP);
    // One write a keystroke up to the cap, and none for the sixteen after it.
    expect(setBuildListItemRefinementAction).toHaveBeenCalledTimes(CAP);
    expect(screen.queryByTestId("build-list-save-failed")).toBeNull();
  });
});

describe("`listPageEdit` is the list page's own write", () => {
  /**
   * The node tiers cannot load this component, so they make "an edit on the
   * list page" with `listPageEdit`. It is only worth something if it writes
   * what the page writes: the same edit, made here through the real page and
   * there through the helper, must leave the same lines in the same envelope.
   */
  it.each(BIKES)(
    "$bike: a reference typed in the page, and the same edit by the helper",
    async ({ ref }) => {
      listFromTheWizard(ref);
      const view = await renderList(ref);
      await view.user.click(control("brake-pads-rear", "pad-model"));
      await view.user.paste("J04C");
      const byThePage = JSON.parse(raw(ref)!) as Record<string, unknown>;
      view.unmount();

      window.localStorage.clear();
      listFromTheWizard(ref);
      listPageEdit(window.localStorage, ref, REAR_PADS, (line) => ({
        ...line,
        refinement: { "pad-model": "J04C" },
      }));
      const byTheHelper = JSON.parse(raw(ref)!) as Record<string, unknown>;

      expect(Object.keys(byThePage).sort()).toEqual(["items", "updatedAt", "version"]);
      expect({ ...byTheHelper, updatedAt: null }).toEqual({ ...byThePage, updatedAt: null });
    },
  );
});
