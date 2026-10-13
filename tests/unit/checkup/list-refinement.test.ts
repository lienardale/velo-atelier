/**
 * A saved line's refinement, on the way OUT of Postgres — and the one cap
 * every place that bounds an answer agrees on (`.debug/017` §5.9).
 *
 * `app/[locale]/velo/[id]/liste/load.ts` has always read a refinement entry by
 * entry: an answer that is not a short string under a short key is dropped,
 * and the line is kept. That rule was written out in the loader, again in the
 * buying guide's prefill, and — as a refusal of the whole LIST — in the guest
 * list's parser, with the number 64 typed in each; the guest import's
 * contract said 120, and the form's inputs said nothing. They now share
 * `lib/shop/refinement.ts`. This file holds the two halves no other tier
 * holds without a database:
 *
 *   - the loader still does what it did (the saved bike is unchanged): a row
 *     holding an over-long answer — which the import wrote for an answer of 65
 *     to 120 characters until 2026-10-13 — loses that answer and nothing else;
 *   - the places that bound an answer bound it at the SAME length: one more
 *     character is refused by the contract and dropped by every reader.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { loadBuildList } from "@/app/[locale]/velo/[id]/liste/load";
import { lineRefinement } from "@/components/shop/item-prefill";
import type { StoredBuildList } from "@/lib/checkup/storage";
import { buildOf, deriveBike } from "@/lib/bike/rules";
import { GUEST_CAPS, parseGuestState } from "@/lib/guest/schema";
import { PARTS } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { shopQuestionsFor } from "@/lib/shop/questions";
import {
  isRefinementEntry,
  MAX_REFINEMENT_VALUE_LENGTH,
  refinementOf,
} from "@/lib/shop/refinement";
import { fakeDb } from "@/tests/_fakes/prisma";
import { guestWork } from "@/tests/_helpers/guest-work";
import {
  PRODUCT_TITLE,
  PRODUCT_URL,
  REAR_PADS,
  wornPadsAndChain,
} from "@/tests/_helpers/long-answers";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CAP = MAX_REFINEMENT_VALUE_LENGTH;

/** One list of the owner's bike whose rear pads' line holds `refinement`, read as the page reads it. */
async function readBack(refinement: unknown) {
  await fakeDb.seed("User", { id: OWNER, email: "camille@velo-atelier.test", locale: "fr" });
  const bike = (await fakeDb.seed("Bike", {
    userId: OWNER,
    name: "Gravel",
    answers: {},
    spec: {},
    parts: [],
  })) as { id: string };
  const list = (await fakeDb.seed("BuildList", { bikeId: bike.id, name: "" })) as { id: string };
  await fakeDb.seed("BuildListItem", {
    buildListId: list.id,
    partId: "chain",
    action: "REPLACE",
    reasonKey: "chain-elongation",
    done: true,
    doneReason: "manual",
    sortOrder: 0,
  });
  await fakeDb.seed("BuildListItem", {
    buildListId: list.id,
    partId: "brake-pads-rear",
    action: "REPLACE",
    reasonKey: "pad-worn",
    done: false,
    sortOrder: 1,
    refinement,
  });
  return (await loadBuildList(bike.id, OWNER)).items;
}

beforeEach(() => {
  fakeDb.reset();
});

describe("a saved line's refinement, as the list page receives it", () => {
  it("is what the row holds when every answer is one the form could have written", async () => {
    const stored = { "pad-model": "J04C", "pad-thickness": "2", "brand-tier": "mid" };
    const [, rear] = await readBack(stored);
    expect(rear.refinement).toEqual(stored);
  });

  it.each([
    ["exactly at the cap", CAP, true],
    ["one character over", CAP + 1, false],
    ["a product title", PRODUCT_TITLE.length, false],
    ["what the import's contract took until 2026-10-13", 120, false],
  ])(
    "an answer %s (%i characters) — kept: %s; the line and its other answers always are",
    async (_what, length, kept) => {
      const long = "r".repeat(length);
      const items = await readBack({ "pad-thickness": "2", "pad-model": long });

      expect(items.map((item) => [item.partId, item.done])).toEqual([
        ["chain", true],
        ["brake-pads-rear", false],
      ]);
      expect(items[1].refinement).toEqual(
        kept ? { "pad-thickness": "2", "pad-model": long } : { "pad-thickness": "2" },
      );
    },
  );

  it.each([
    ["nothing but an over-long answer", { "pad-model": PRODUCT_URL }],
    ["not an object", "pad-model=J04C"],
    ["an array", ["pad-model", "J04C"]],
    ["empty", {}],
  ])("is absent — and the line still there — when the column holds %s", async (_what, stored) => {
    const items = await readBack(stored);
    expect(items).toHaveLength(2);
    expect(Object.hasOwn(items[1], "refinement")).toBe(false);
  });
});

describe("one cap, wherever an answer is bounded", () => {
  /**
   * The places that READ a stored refinement, and the contract that lets one
   * into a column, each given an answer at the cap and one character over.
   * (The saved bike's loader is the block above; the form's inputs and the
   * guest list's parser are `BuildList.long-answer.test.tsx`'s; the saved
   * bike's action — which needs `@/auth` and a row to write — is
   * `tests/integration/build-lists.test.ts`'s.)
   */
  const guest = guestWork({
    answers: BIKE_PRESETS["gravel-1x11"],
    checkup: (build) => wornPadsAndChain(build, "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90"),
  });
  const collected = JSON.stringify(guest.collect().state);

  const readers: Record<string, (value: string) => boolean> = {
    "the one reader (`refinementOf`)": (value) =>
      refinementOf({ "pad-model": value })?.["pad-model"] === value,
    "the buying guide's prefill": (value) => {
      const list = {
        items: [{ id: "line-1", partId: REAR_PADS.partId, refinement: { "pad-model": value } }],
      } as unknown as StoredBuildList;
      return lineRefinement(list, REAR_PADS.partId, "line-1")?.["pad-model"] === value;
    },
    "the guest import's contract": (value) => {
      const payload = JSON.parse(collected) as {
        bikes: { lists: { items: { refinement?: Record<string, string> }[] }[] }[];
      };
      payload.bikes[0].lists[0].items[0].refinement = { "pad-model": value };
      return parseGuestState(payload).ok;
    },
  };
  it.each(Object.keys(readers))("%s takes 64 characters and not 65", (name) => {
    // eslint-disable-next-line security/detect-object-injection -- a key of the table above
    const takes = readers[name];
    expect(CAP).toBe(64);
    expect(takes("r".repeat(CAP)), "at the cap").toBe(true);
    expect(takes("r".repeat(CAP + 1)), "one over").toBe(false);
  });
});

describe("what the form's controls OFFER is inside the walls", () => {
  /**
   * A free-text field is stopped by `maxLength` and a number field by the
   * form. A `<select>` is stopped by nothing — it hands up one of its option
   * values — and the KEY of every answer is a question's own. Both come from
   * the catalogue, so the catalogue is what is checked: for every part of
   * every preset, with the price tier asked too.
   */
  const TIERS = { entry: "Entrée de gamme", mid: "Milieu de gamme", high: "Haut de gamme" };
  /** The guest import's contract on a refinement key (`lib/guest/schema.ts`). */
  const CONTRACT_KEY = /^[a-z0-9-]{1,40}$/;

  it.each(Object.keys(BIKE_PRESETS) as PresetId[])(
    "%s: every question's key, every option's value and every part's number of questions",
    (preset) => {
      // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
      const build = buildOf(deriveBike(BIKE_PRESETS[preset]));
      let asked = 0;
      for (const part of PARTS) {
        const questions = shopQuestionsFor(build, part.id, "fr", TIERS, {
          label: "Gamme",
          help: "",
        });
        asked += questions.length;
        // One answer per question at most: a line's refinement fits the contract's count.
        expect(questions.length, part.id).toBeLessThanOrEqual(GUEST_CAPS.refinementEntries);
        for (const question of questions) {
          expect(question.key, `${part.id}.${question.key}`).toMatch(CONTRACT_KEY);
          for (const option of question.options ?? []) {
            expect(
              isRefinementEntry(question.key, option.value),
              `${part.id}.${question.key}=${option.value}`,
            ).toBe(true);
          }
        }
      }
      expect(asked).toBeGreaterThan(50);
    },
  );
});
