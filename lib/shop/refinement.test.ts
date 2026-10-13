/**
 * The cap on one refinement answer, and the one reader of a stored refinement
 * (`.debug/017` §5.9).
 *
 * The reader's whole job is to make a bad ENTRY cost that entry: before it
 * existed in one place, the guest list's parser applied the same two bounds by
 * refusing the list, and one product title pasted into a reference field hid
 * every line a visitor had.
 */
import { describe, expect, it } from "vitest";

import {
  clipRefinementText,
  isRefinementEntry,
  isRefinementKey,
  MAX_REFINEMENT_KEY_LENGTH,
  MAX_REFINEMENT_VALUE_LENGTH,
  refinementOf,
} from "./refinement";

/** The two halves of U+1F600, by their codes: this file holds no surrogate. */
const HIGH = String.fromCharCode(0xd83d);
const LOW = String.fromCharCode(0xde00);
const EMOJI = HIGH + LOW;

const AT_CAP = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH);
const OVER_CAP = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH + 1);

describe("the cap", () => {
  it("is 64 UTF-16 code units — the number the action, the loader and the page already held a value to", () => {
    expect(MAX_REFINEMENT_VALUE_LENGTH).toBe(64);
    expect(MAX_REFINEMENT_KEY_LENGTH).toBe(64);
  });
});

/**
 * A record holding an OWN key of that name, as storage or a request body can
 * carry one: `JSON.parse` creates it, where an object literal would set the
 * prototype (or name the constructor) and prove nothing.
 */
const own = (json: string): Record<string, unknown> => JSON.parse(json) as Record<string, unknown>;

describe("isRefinementKey — the one definition of a key an answer is stored under", () => {
  it.each(["pad-model", "brand-tier", "e-rated", "speeds", "max-cog", "11", "k"])(
    "takes an attribute key: %j",
    (key) => {
      expect(isRefinementKey(key)).toBe(true);
    },
  );

  it("takes a key of exactly its cap, and not one character more — nor none at all", () => {
    expect(isRefinementKey("k".repeat(MAX_REFINEMENT_KEY_LENGTH))).toBe(true);
    expect(isRefinementKey("k".repeat(MAX_REFINEMENT_KEY_LENGTH + 1))).toBe(false);
    expect(isRefinementKey("")).toBe(false);
  });

  it.each(["Speeds", "pad_model", "pad model", "speeds.nested", "pad-modèle", "a/b", "speeds\n"])(
    "refuses a key that is not in the catalogue's shape: %j",
    (key) => {
      expect(isRefinementKey(key)).toBe(false);
    },
  );

  // `constructor` and `prototype` are all-lowercase: the shape alone lets them
  // through. The saved bike's action has always refused them by name; the
  // import's contract did not, and a line imported with one could never be
  // edited again (`.debug/017` §5.9, the review of the fix).
  it.each(["__proto__", "constructor", "prototype"])(
    "refuses %j — a name that means something to an object",
    (key) => {
      expect(isRefinementKey(key)).toBe(false);
    },
  );

  it("still takes a key that merely CONTAINS one of those names", () => {
    expect(isRefinementKey("constructor-type")).toBe(true);
    expect(isRefinementKey("prototype-2")).toBe(true);
  });
});

describe("isRefinementEntry", () => {
  it("takes a string of at most the cap, under an attribute key of at most its own", () => {
    expect(isRefinementEntry("pad-model", "J04C")).toBe(true);
    expect(isRefinementEntry("pad-model", "")).toBe(true);
    expect(isRefinementEntry("pad-model", AT_CAP)).toBe(true);
    expect(isRefinementEntry("k".repeat(MAX_REFINEMENT_KEY_LENGTH), "x")).toBe(true);
  });

  it("refuses one character more, on either side", () => {
    expect(isRefinementEntry("pad-model", OVER_CAP)).toBe(false);
    expect(isRefinementEntry("k".repeat(MAX_REFINEMENT_KEY_LENGTH + 1), "x")).toBe(false);
  });

  it.each([11, true, null, undefined, ["J04C"], { model: "J04C" }])(
    "refuses a value that is not a string: %j",
    (value) => {
      expect(isRefinementEntry("pad-model", value)).toBe(false);
    },
  );
});

describe("refinementOf — a bad entry costs that entry", () => {
  it("returns what it was given when every entry is an answer", () => {
    const stored = { "pad-model": "J04C", "pad-thickness": "2", "brand-tier": "mid" };
    expect(refinementOf(stored)).toEqual(stored);
  });

  it.each([
    ["a product title", 99],
    ["a product URL", 138],
    ["one character over", MAX_REFINEMENT_VALUE_LENGTH + 1],
    ["the import contract's old cap", 120],
    ["one over that", 121],
    ["a pasted page", 5000],
  ])("drops an over-long answer (%s: %i characters) and keeps the others", (_what, length) => {
    expect(
      refinementOf({ "pad-model": "r".repeat(length), "pad-thickness": "2", "brand-tier": "mid" }),
    ).toEqual({ "pad-thickness": "2", "brand-tier": "mid" });
  });

  it("keeps an answer exactly at the cap", () => {
    expect(refinementOf({ "pad-model": AT_CAP })).toEqual({ "pad-model": AT_CAP });
  });

  it("drops what is not a string, and an entry under an over-long key, one by one", () => {
    expect(
      refinementOf({
        speeds: 11,
        "e-rated": true,
        clutch: null,
        nested: { model: "J04C" },
        list: ["J04C"],
        ["k".repeat(MAX_REFINEMENT_KEY_LENGTH + 1)]: "x",
        "pad-model": "J04C",
      }),
    ).toEqual({ "pad-model": "J04C" });
  });

  it("drops an entry under a key the account's action would refuse, and keeps the others", () => {
    // What a reader hands the page, the page hands back whole with the next
    // edit: an entry the writer refuses must not be read, or that line can
    // never be edited again.
    const read = refinementOf(
      own(
        '{"__proto__":"a","constructor":"b","prototype":"c","Speeds":"11","pad_model":"x","a.b":"y","":"z","pad-thickness":"2","brand-tier":"mid"}',
      ),
    );
    expect(read).toEqual({ "pad-thickness": "2", "brand-tier": "mid" });
    expect(Object.keys(read ?? {})).toEqual(["pad-thickness", "brand-tier"]);
    // Every key it returns is one the action takes.
    expect(Object.keys(read ?? {}).every(isRefinementKey)).toBe(true);
    // Nothing was written anywhere but on the object returned.
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it("answers undefined — no refinement, never an error — when nothing can be kept", () => {
    expect(refinementOf({ "pad-model": OVER_CAP })).toBeUndefined();
    expect(refinementOf({})).toBeUndefined();
    expect(refinementOf(own('{"constructor":"x"}'))).toBeUndefined();
  });

  it.each([undefined, null, "pad-model=J04C", 64, true, ["pad-model", "J04C"]])(
    "answers undefined for a value that is not an object: %j",
    (value) => {
      expect(refinementOf(value)).toBeUndefined();
    },
  );

  it("returns a new, plain object and leaves the stored one as it was", () => {
    const stored = Object.freeze({ "pad-model": OVER_CAP, "pad-thickness": "2" });
    const read = refinementOf(stored);
    expect(read).toEqual({ "pad-thickness": "2" });
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(stored).toEqual({ "pad-model": OVER_CAP, "pad-thickness": "2" });
  });

  it("counts what the browser's maxLength and zod count: code units, so an emoji is two", () => {
    const fits = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 2) + EMOJI;
    expect(fits).toHaveLength(MAX_REFINEMENT_VALUE_LENGTH);
    expect(refinementOf({ "pad-model": fits })).toEqual({ "pad-model": fits });
    expect(refinementOf({ "pad-model": `r${fits}` })).toBeUndefined();
  });
});

describe("clipRefinementText — the wall behind a text input's maxLength", () => {
  it("hands on text that fits exactly as it is", () => {
    expect(clipRefinementText("")).toBe("");
    expect(clipRefinementText("J04C")).toBe("J04C");
    expect(clipRefinementText(AT_CAP)).toBe(AT_CAP);
  });

  it("keeps the beginning of text that does not — what maxLength leaves of a paste", () => {
    const title =
      "Plaquettes de frein à disque Shimano J04C métal fritté avec ailettes de refroidissement Ice-Tech";
    expect(title.length).toBeGreaterThan(MAX_REFINEMENT_VALUE_LENGTH);
    const clipped = clipRefinementText(title);
    expect(clipped).toBe(title.slice(0, MAX_REFINEMENT_VALUE_LENGTH));
    expect(refinementOf({ "pad-model": clipped })).toEqual({ "pad-model": clipped });
  });

  it("never cuts between the two halves of a surrogate pair", () => {
    // The pair sits astride the cap: its first half is the 64th code unit.
    const astride = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 1) + EMOJI + "tail";
    const clipped = clipRefinementText(astride);
    expect(clipped).toBe("r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 1));
    expect(clipped.isWellFormed()).toBe(true);
    // A pair that ends exactly at the cap is whole, and kept.
    const flush = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 2) + EMOJI + "tail";
    expect(clipRefinementText(flush)).toBe("r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 2) + EMOJI);
    // A half that was already alone is not this function's to repair.
    const lone = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 1) + LOW + "tail";
    expect(clipRefinementText(lone)).toBe("r".repeat(MAX_REFINEMENT_VALUE_LENGTH - 1) + LOW);
  });
});
