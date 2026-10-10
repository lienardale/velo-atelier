import { beforeEach, describe, expect, it } from "vitest";

import { fieldOf, forgetWrites, isInDoubt, sendTracked, type Left } from "./own-writes";

/**
 * The part form's record of its own writes (`.debug/017` §5.8). What the form
 * does with it is held through the panel and the workspace
 * (`components/bike/{PartsPanel,BikeWorkspace}.test.tsx`); here, the record
 * alone: when what a page says of a field is in doubt, and when it is not.
 */

const BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const WIDTH = fieldOf(BIKE, "tire-front", "etrto-width");

/** A write the case answers itself. */
function write(field: string | null) {
  let answer: (left: Left | null) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const sent = sendTracked<Left | null>(
    field,
    () =>
      new Promise((resolve, reject) => {
        answer = resolve;
        fail = reject;
      }),
    (left) => left,
  );
  return { sent, answer, fail };
}

beforeEach(() => {
  forgetWrites();
});

/** Two guest bikes, as `BikeRepo.bikeKey()` names them: each by its own id. */
const GUEST_A = "local:0b0a8d6e-8f1c-4c63-9a55-0f6d2b1c7e01";
const GUEST_B = "local:5d3c9a10-2e4b-4f7a-8b21-6c9e0d4f3a02";

describe("a field's key", () => {
  it("names the bike, the part and the attribute — and two bikes never share one", () => {
    expect(WIDTH).toBe(`${BIKE}/tire-front:etrto-width`);
    expect(fieldOf(GUEST_A, "tire-front", "etrto-width")).not.toBe(WIDTH);
    expect(fieldOf(GUEST_A, "tire-front", "etrto-width")).not.toBe(
      fieldOf(GUEST_B, "tire-front", "etrto-width"),
    );
    expect(fieldOf("demo", "tire-front", "etrto-width")).not.toBe(WIDTH);
    expect(fieldOf(BIKE, "tire-rear", "etrto-width")).not.toBe(WIDTH);
    expect(fieldOf(BIKE, "tire-front", "tread")).not.toBe(WIDTH);
  });

  it("is no key at all for a field of no bike", () => {
    expect(fieldOf(null, "tire-front", "etrto-width")).toBeNull();
  });
});

describe("what a page says of a field is in doubt…", () => {
  it("never, for a field this document has not written", () => {
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(WIDTH, undefined)).toBe(false);
  });

  it("while a write of it is in flight, whatever the page says — and the send itself is made synchronously", () => {
    let called = false;
    void sendTracked(
      WIDTH,
      () => {
        // On record before the write has even left.
        expect(isInDoubt(WIDTH, 42)).toBe(true);
        called = true;
        return new Promise<null>(() => {});
      },
      () => null,
    );
    expect(called).toBe(true);
    expect(isInDoubt(WIDTH, 42)).toBe(true);
    expect(isInDoubt(WIDTH, 45)).toBe(true);
    expect(isInDoubt(fieldOf(BIKE, "tire-rear", "etrto-width"), 42)).toBe(false);
  });

  it("once the write has ANSWERED, for as long as the page does not say what it left", async () => {
    const first = write(WIDTH);
    first.answer({ value: 45 });
    await expect(first.sent).resolves.toEqual({ value: 45 });

    expect(isInDoubt(WIDTH, 42), "the page the router kept").toBe(true);
    expect(isInDoubt(WIDTH, undefined)).toBe(true);
    expect(isInDoubt(WIDTH, 45), "the page fetched again").toBe(false);
  });

  it("AGAIN when a page that says something else arrives after one that said it: the record is kept past the first agreement", async () => {
    // A page rendered before the write can be delivered after the one that
    // was rendered after it.
    const first = write(WIDTH);
    first.answer({ value: 45 });
    await first.sent;
    expect(isInDoubt(WIDTH, 45)).toBe(false);
    expect(isInDoubt(WIDTH, 42)).toBe(true);
    expect(isInDoubt(WIDTH, 45)).toBe(false);
  });

  it("a write that cleared the field left NO value: a page that shows none agrees with it", async () => {
    const cleared = write(WIDTH);
    cleared.answer({ value: undefined });
    await cleared.sent;
    expect(isInDoubt(WIDTH, 42)).toBe(true);
    expect(isInDoubt(WIDTH, undefined)).toBe(false);
  });
});

describe("a write that wrote nothing leaves nothing on record", () => {
  it("a refused write: no doubt once it has answered", async () => {
    const refused = write(WIDTH);
    refused.answer(null);
    await expect(refused.sent).resolves.toBeNull();
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(WIDTH, 45)).toBe(false);
  });

  it("a write that did not answer at all: no doubt either, and its failure is the caller's as it was thrown", async () => {
    const lost = write(WIDTH);
    const error = new TypeError("Failed to fetch");
    lost.fail(error);
    await expect(lost.sent).rejects.toBe(error);
    expect(isInDoubt(WIDTH, 42)).toBe(false);
  });

  it("a failure takes nothing away from an EARLIER write that answered", async () => {
    const first = write(WIDTH);
    first.answer({ value: 45 });
    await first.sent;
    const second = write(WIDTH);
    expect(isInDoubt(WIDTH, 45), "the second is in flight").toBe(true);
    second.fail(new Error("down"));
    await expect(second.sent).rejects.toThrow("down");
    expect(isInDoubt(WIDTH, 45)).toBe(false);
    expect(isInDoubt(WIDTH, 42)).toBe(true);
  });
});

describe("two writes of one field", () => {
  it("in doubt until BOTH have answered; then the page must say what the LAST one sent left", async () => {
    const first = write(WIDTH);
    const second = write(WIDTH);
    first.answer({ value: 45 });
    await first.sent;
    expect(isInDoubt(WIDTH, 45), "the second is still in flight").toBe(true);

    second.answer({ value: 42 });
    await second.sent;
    expect(isInDoubt(WIDTH, 45)).toBe(true);
    expect(isInDoubt(WIDTH, 42)).toBe(false);
  });

  it("answers that come back in the other order: it is still what the last one SENT left", async () => {
    const first = write(WIDTH);
    const second = write(WIDTH);
    second.answer({ value: 42 });
    await second.sent;
    first.answer({ value: 45 }); // the earlier write's answer, arriving late
    await first.sent;

    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(WIDTH, 45)).toBe(true);
  });

  it("the later one refused: what the earlier one left stands", async () => {
    const first = write(WIDTH);
    const second = write(WIDTH);
    second.answer(null);
    await second.sent;
    first.answer({ value: 45 });
    await first.sent;

    expect(isInDoubt(WIDTH, 45)).toBe(false);
    expect(isInDoubt(WIDTH, 42)).toBe(true);
  });
});

describe("one bike's write is not another's", () => {
  it("nor one field's another's", async () => {
    const other = fieldOf("9b2d7c1a-5e3f-4a8b-b6c4-0d1e2f3a4b5c", "tire-front", "etrto-width");
    const sent = write(other);
    expect(isInDoubt(other, 42)).toBe(true);
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    sent.answer({ value: 45 });
    await sent.sent;
    expect(isInDoubt(other, 42)).toBe(true);
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(fieldOf(BIKE, "tire-front", "tread"), "slick")).toBe(false);
  });
});

/**
 * `/velo/local` is a slot: the guest bike in it is replaced by another — the
 * demo's local copy, a bike generated again from the tree — in the same
 * document. Named by the slot, as every guest bike was until the third review,
 * the second inherited what had been written to the first.
 */
describe("one GUEST bike's write is not the next guest bike's", () => {
  it("answered: the bike that replaced it in the slot is not in doubt", async () => {
    const first = fieldOf(GUEST_A, "tire-front", "etrto-width");
    const second = fieldOf(GUEST_B, "tire-front", "etrto-width");
    const sent = write(first);
    sent.answer({ value: 45 });
    await sent.sent;

    expect(isInDoubt(first, 42), "the bike that was written").toBe(true);
    expect(isInDoubt(second, 42), "the bike that replaced it").toBe(false);
    expect(isInDoubt(second, 45)).toBe(false);
  });

  it("in flight: neither", () => {
    void write(fieldOf(GUEST_A, "tire-front", "etrto-width"));
    expect(isInDoubt(fieldOf(GUEST_A, "tire-front", "etrto-width"), 42)).toBe(true);
    expect(isInDoubt(fieldOf(GUEST_B, "tire-front", "etrto-width"), 42)).toBe(false);
  });
});

describe("a field of no bike — the repo could name none", () => {
  const NONE = fieldOf(null, "tire-front", "etrto-width");

  it("is never in doubt", () => {
    expect(isInDoubt(NONE, 42)).toBe(false);
    expect(isInDoubt(NONE, undefined)).toBe(false);
  });

  it("is sent all the same — synchronously, and settling as its own promise does", async () => {
    let called = false;
    const sent = sendTracked(
      NONE,
      () => {
        called = true;
        return Promise.resolve("answer");
      },
      () => ({ value: 45 }),
    );
    expect(called).toBe(true);
    await expect(sent).resolves.toBe("answer");

    const lost = new Error("the action did not answer");
    await expect(
      sendTracked(
        NONE,
        () => Promise.reject(lost),
        () => null,
      ),
    ).rejects.toBe(lost);
  });

  it("leaves nothing on the record, in flight or answered — for itself or for any bike", async () => {
    const pending = write(NONE);
    expect(isInDoubt(NONE, 42)).toBe(false);
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(fieldOf(GUEST_A, "tire-front", "etrto-width"), 42)).toBe(false);

    pending.answer({ value: 45 });
    await pending.sent;
    expect(isInDoubt(NONE, 42)).toBe(false);
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(fieldOf(GUEST_A, "tire-front", "etrto-width"), 42)).toBe(false);
  });
});

describe("forgetWrites — for tests", () => {
  it("empties the record, and a write that answers afterwards puts nothing back", async () => {
    const before = write(WIDTH);
    const kept = write(fieldOf(BIKE, "tire-rear", "etrto-width"));
    kept.answer({ value: 38 });
    await kept.sent;
    forgetWrites();
    expect(isInDoubt(WIDTH, 42)).toBe(false);
    expect(isInDoubt(fieldOf(BIKE, "tire-rear", "etrto-width"), 42)).toBe(false);
    before.answer({ value: 45 });
    await before.sent;
    expect(isInDoubt(WIDTH, 42)).toBe(false);
  });
});
