import { beforeEach, describe, expect, it } from "vitest";

import {
  fieldOf,
  forgetWrites,
  handed,
  isUnsettled,
  sendTracked,
  type Left,
} from "./unsettled-writes";

/**
 * The part form's record of its own writes (`.debug/017` §5.8). What the form
 * does with it is held through the panel and the workspace
 * (`components/bike/{PartsPanel,BikeWorkspace}.test.tsx`); here, the record
 * alone: when a write is on it, and what takes it off.
 */

const BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const WIDTH = fieldOf(BIKE, "tire-front", "etrto-width");

/** A write the case answers itself. */
function write(field: string) {
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

describe("a field's key", () => {
  it("names the bike, the part and the attribute — and two bikes never share one", () => {
    expect(WIDTH).toBe(`${BIKE}/tire-front:etrto-width`);
    expect(fieldOf("local", "tire-front", "etrto-width")).not.toBe(WIDTH);
    expect(fieldOf(BIKE, "tire-rear", "etrto-width")).not.toBe(WIDTH);
    expect(fieldOf(BIKE, "tire-front", "tread")).not.toBe(WIDTH);
  });
});

describe("a write is on record from before it leaves until it is settled", () => {
  it("is unsettled while it is in flight, and the send itself is made synchronously", () => {
    expect(isUnsettled(WIDTH)).toBe(false);
    let called = false;
    void sendTracked(
      WIDTH,
      () => {
        // On record before the write has even left.
        expect(isUnsettled(WIDTH)).toBe(true);
        called = true;
        return new Promise<null>(() => {});
      },
      () => null,
    );
    expect(called).toBe(true);
    expect(isUnsettled(WIDTH)).toBe(true);
    expect(isUnsettled(fieldOf(BIKE, "tire-rear", "etrto-width"))).toBe(false);
  });

  it("stays unsettled once it has ANSWERED, until the form is handed exactly what it left", async () => {
    const first = write(WIDTH);
    first.answer({ value: 45 });
    await expect(first.sent).resolves.toEqual({ value: 45 });
    expect(isUnsettled(WIDTH)).toBe(true);

    handed(WIDTH, 42); // the page the router kept: not what the write left
    expect(isUnsettled(WIDTH)).toBe(true);
    handed(WIDTH, undefined);
    expect(isUnsettled(WIDTH)).toBe(true);

    handed(WIDTH, 45);
    expect(isUnsettled(WIDTH)).toBe(false);
  });

  it("a write that cleared the field left NO value, and is settled by a form handed none", async () => {
    const cleared = write(WIDTH);
    cleared.answer({ value: undefined });
    await cleared.sent;
    handed(WIDTH, 42);
    expect(isUnsettled(WIDTH)).toBe(true);
    handed(WIDTH, undefined);
    expect(isUnsettled(WIDTH)).toBe(false);
  });

  it("a refused write wrote nothing: it is off the record as soon as it answers", async () => {
    const refused = write(WIDTH);
    refused.answer(null);
    await expect(refused.sent).resolves.toBeNull();
    expect(isUnsettled(WIDTH)).toBe(false);
  });

  it("a write that did not answer at all is off the record too, and its failure is the caller's as it was thrown", async () => {
    const lost = write(WIDTH);
    const error = new TypeError("Failed to fetch");
    lost.fail(error);
    await expect(lost.sent).rejects.toBe(error);
    expect(isUnsettled(WIDTH)).toBe(false);
  });

  it("a failure does not settle an EARLIER write that answered and was never handed over", async () => {
    const first = write(WIDTH);
    first.answer({ value: 45 });
    await first.sent;
    const second = write(WIDTH);
    second.fail(new Error("down"));
    await expect(second.sent).rejects.toThrow("down");
    expect(isUnsettled(WIDTH)).toBe(true);
    handed(WIDTH, 45);
    expect(isUnsettled(WIDTH)).toBe(false);
  });

  it("two writes of one field: unsettled until BOTH have answered and the form holds what the last to answer left", async () => {
    const first = write(WIDTH);
    const second = write(WIDTH);
    first.answer({ value: 45 });
    await first.sent;
    handed(WIDTH, 45); // told of the first — the second is still in flight
    expect(isUnsettled(WIDTH)).toBe(true);

    second.answer({ value: 42 });
    await second.sent;
    handed(WIDTH, 45);
    expect(isUnsettled(WIDTH)).toBe(true);
    handed(WIDTH, 42);
    expect(isUnsettled(WIDTH)).toBe(false);
  });

  it("being handed a value settles nothing that is still in flight, nor a field with nothing on record", () => {
    handed(WIDTH, 45);
    expect(isUnsettled(WIDTH)).toBe(false);
    void write(WIDTH);
    handed(WIDTH, 45);
    expect(isUnsettled(WIDTH)).toBe(true);
  });

  it("one bike's write is not another's, and one field's is not another's", async () => {
    const other = fieldOf("9b2d7c1a-5e3f-4a8b-b6c4-0d1e2f3a4b5c", "tire-front", "etrto-width");
    const sent = write(other);
    expect(isUnsettled(other)).toBe(true);
    expect(isUnsettled(WIDTH)).toBe(false);
    sent.answer({ value: 45 });
    await sent.sent;
    handed(WIDTH, 45);
    expect(isUnsettled(other)).toBe(true);
    handed(other, 45);
    expect(isUnsettled(other)).toBe(false);
  });
});

describe("forgetWrites — for tests", () => {
  it("empties the record, and a write that answers afterwards puts nothing back", async () => {
    const before = write(WIDTH);
    forgetWrites();
    expect(isUnsettled(WIDTH)).toBe(false);
    before.answer({ value: 45 });
    await before.sent;
    expect(isUnsettled(WIDTH)).toBe(false);
  });
});
