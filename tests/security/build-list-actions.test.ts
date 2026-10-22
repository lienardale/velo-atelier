/**
 * THREAT — somebody else's build list, reached through the four actions of
 * `app/[locale]/velo/[id]/liste/actions.ts` (§4.4, §4.7).
 *
 * A build list is what a visitor is about to spend money on, and every one of
 * its actions takes an id the browser supplied: an item id to tick or refine, a
 * list id to clear, an item id (and a bike id) to pre-fill the buying guide
 * from. The integration tier proves a foreign id answers NOT_FOUND on real
 * Postgres; this file proves it for the reason that matters, in the shape of
 * the queries themselves:
 *
 *   1. **The owner is in every `where`** (`expectScopedToUser`) — including the
 *      `deleteMany` of "Retirer ce qui est fait", which relied on the scoped
 *      `findFirst` before it until W4.
 *   2. **A foreign id is NOT_FOUND, never FORBIDDEN**, and touches nothing.
 *   3. **`.strict()`**: `doneReason`, `buildListId`, `userId`, `done` where they
 *      do not belong are refused, not ignored — the reason a line is done is
 *      the server's to write (`manual` from here, `recheck-ok` from a checkup).
 *   4. **The item read is scoped by the bike too**: a line of another of your
 *      own bikes does not pre-fill the guide you opened from this one.
 *   5. **The item read is a reader of a `Json` column, and it is THE reader**
 *      (`refinementOf`, `lib/shop/refinement.ts`): what it answers for a row
 *      is what the list's loader hands the page for the same row, and never
 *      more than 24 answers — the loader's count too since 2026-10-22, when
 *      it stopped being this reader's own (V1-1). Until 2026-10-13 it was a copy of that filter
 *      which no test held — its bound set to 5 000 characters, or the column
 *      returned as stored, left every tier green (`.debug/017` §5.9, the
 *      review of the fix).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectScopedToUser, fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const {
  setBuildListItemDoneAction,
  setBuildListItemRefinementAction,
  clearDoneBuildListItemsAction,
  loadBuildListItemAction,
} = await import("@/app/[locale]/velo/[id]/liste/actions");
const { loadBuildList } = await import("@/app/[locale]/velo/[id]/liste/load");
const { isRefinementKey, MAX_REFINEMENT_VALUE_LENGTH } = await import("@/lib/shop/refinement");

interface Seeded {
  user: { id: string; email: string; name: string; locale: "fr" };
  bike: { id: string };
  list: { id: string };
  open: { id: string };
  done: { id: string };
}

async function seedOwner(email: string): Promise<Seeded> {
  const user = (await fakeDb.seed("User", {
    email,
    name: email.split("@")[0],
    locale: "fr",
  })) as Seeded["user"];
  const bike = (await fakeDb.seed("Bike", {
    userId: user.id,
    name: "Gravel",
    answers: {},
    spec: {},
    parts: [],
  })) as { id: string };
  const list = (await fakeDb.seed("BuildList", { bikeId: bike.id, name: "" })) as { id: string };
  const open = (await fakeDb.seed("BuildListItem", {
    buildListId: list.id,
    partId: "chain",
    action: "REPLACE",
    reasonKey: "chain-elongation",
    refinement: { speeds: "11" },
  })) as { id: string };
  const done = (await fakeDb.seed("BuildListItem", {
    buildListId: list.id,
    partId: "cassette",
    action: "REPLACE",
    reasonKey: "cassette-worn",
    done: true,
    doneReason: "manual",
  })) as { id: string };
  return { user, bike, list, open, done };
}

let me: Seeded;
let victim: Seeded;

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  me = await seedOwner("camille@velo-atelier.test");
  victim = await seedOwner("victime@velo-atelier.test");
  setSession(sessionFor(me.user));
  fakeDb.resetCalls();
});

const victimRows = () =>
  fakeDb
    .rows("BuildListItem")
    .filter((row) => [victim.open.id, victim.done.id].includes(row.id as string));

describe("ownership is in the query", () => {
  it("ticks my line, writes `manual`, and un-ticking clears the reason", async () => {
    expect(await setBuildListItemDoneAction({ itemId: me.open.id, done: true })).toEqual({
      ok: true,
      data: null,
    });
    expect(fakeDb.rows("BuildListItem").find((row) => row.id === me.open.id)).toMatchObject({
      done: true,
      doneReason: "manual",
    });

    await setBuildListItemDoneAction({ itemId: me.open.id, done: false });
    expect(fakeDb.rows("BuildListItem").find((row) => row.id === me.open.id)).toMatchObject({
      done: false,
      doneReason: null,
    });
    expectScopedToUser(fakeDb.calls, me.user.id);
  });

  it.each([
    ["tick", () => setBuildListItemDoneAction({ itemId: victim.open.id, done: true })],
    [
      "refine",
      () =>
        setBuildListItemRefinementAction({ itemId: victim.open.id, refinement: { speeds: "12" } }),
    ],
    ["clear", () => clearDoneBuildListItemsAction({ buildListId: victim.list.id })],
    ["read", () => loadBuildListItemAction({ bikeId: victim.bike.id, itemId: victim.open.id })],
  ])("answers NOT_FOUND to a foreign %s and changes nothing", async (_label, call) => {
    const before = victimRows();

    expect(await call()).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(victimRows()).toEqual(before);
    expectScopedToUser(fakeDb.calls, me.user.id);
  });

  it("clears my done lines with the owner in the delete itself", async () => {
    expect(await clearDoneBuildListItemsAction({ buildListId: me.list.id })).toEqual({
      ok: true,
      data: { removed: 1 },
    });
    const deletes = fakeDb.calls.filter((call) => call.op === "deleteMany");
    expect(deletes).toHaveLength(1);
    // Every call, the delete included — not only the lookup before it.
    expectScopedToUser(deletes, me.user.id);
    expect(victimRows()).toHaveLength(2);
  });

  it("reads my own line for the buying guide, and only through its own bike", async () => {
    expect(await loadBuildListItemAction({ bikeId: me.bike.id, itemId: me.open.id })).toEqual({
      ok: true,
      data: { partId: "chain", refinement: { speeds: "11" } },
    });

    const secondBike = (await fakeDb.seed("Bike", {
      userId: me.user.id,
      name: "Ville",
      answers: {},
      spec: {},
      parts: [],
    })) as { id: string };
    expect(await loadBuildListItemAction({ bikeId: secondBike.id, itemId: me.open.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expectScopedToUser(fakeDb.calls, me.user.id);
  });
});

describe("the item read answers what the list's loader hands the page — a `Json` column is not trusted", () => {
  const CAP = MAX_REFINEMENT_VALUE_LENGTH;

  /** A line of my list whose column holds `refinement`, written past every guard. */
  async function lineHolding(refinement: unknown): Promise<string> {
    const line = (await fakeDb.seed("BuildListItem", {
      buildListId: me.list.id,
      partId: "brake-pads-rear",
      action: "REPLACE",
      reasonKey: "pad-worn",
      sortOrder: 2,
      refinement,
    })) as { id: string };
    return line.id;
  }

  it.each([
    [
      "an answer over the cap, and answers that are not strings",
      { speeds: "11", "pad-model": "r".repeat(CAP + 1), clutch: 7, nested: { a: "b" }, none: null },
      { speeds: "11" },
    ],
    [
      "an answer of exactly the cap",
      { speeds: "11", "pad-model": "r".repeat(CAP) },
      { speeds: "11", "pad-model": "r".repeat(CAP) },
    ],
    ["5 000 characters", { speeds: "11", "pad-model": "r".repeat(5000) }, { speeds: "11" }],
    [
      // `JSON.parse`, so the two names are OWN keys, as a `jsonb` column holds them.
      "keys the action itself refuses on a write",
      JSON.parse(
        '{"constructor":"x","prototype":"y","Speeds":"12","speeds.nested":"13","speeds":"11"}',
      ) as unknown,
      { speeds: "11" },
    ],
    ["a string", "speeds=11", {}],
    ["an array", ["speeds", "11"], {}],
    ["nothing but an over-long answer", { "pad-model": "r".repeat(CAP + 1) }, {}],
  ])("a row holding %s", async (_what, stored, expected) => {
    const itemId = await lineHolding(stored);

    const result = await loadBuildListItemAction({ bikeId: me.bike.id, itemId });
    expect(result).toEqual({ ok: true, data: { partId: "brake-pads-rear", refinement: expected } });
    if (!result.ok) return;
    expect(Object.keys(result.data.refinement).sort()).toEqual(Object.keys(expected).sort());
    // Every key it answers is one the refinement action would take back.
    expect(Object.keys(result.data.refinement).every(isRefinementKey)).toBe(true);

    // The two readers of the same column agree.
    const viaLoader = (await loadBuildList(me.bike.id, me.user.id)).items.find(
      (line) => line.id === itemId,
    );
    expect(viaLoader?.refinement ?? {}).toEqual(result.data.refinement);
  });

  it("answers with at most the 24 answers a line may hold", async () => {
    const thirty = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`attr-${String(index).padStart(2, "0")}`, "x"]),
    );
    const itemId = await lineHolding(thirty);

    const result = await loadBuildListItemAction({ bikeId: me.bike.id, itemId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data.refinement)).toHaveLength(24);
    expect(thirty).toMatchObject(result.data.refinement);
    // The same 24 the list's loader hands the page: the page sends back what
    // it was handed, and the refinement action refuses a 25th.
    const viaLoader = (await loadBuildList(me.bike.id, me.user.id)).items.find(
      (line) => line.id === itemId,
    );
    expect(viaLoader?.refinement).toEqual(result.data.refinement);
  });
});

describe(".strict() — a key that is not the form's is refused", () => {
  it.each([
    [
      "doneReason on a tick",
      () =>
        setBuildListItemDoneAction({ itemId: me.open.id, done: true, doneReason: "recheck-ok" }),
    ],
    [
      "a list id on a tick",
      () =>
        setBuildListItemDoneAction({ itemId: me.open.id, done: true, buildListId: victim.list.id }),
    ],
    [
      "done on a refinement",
      () => setBuildListItemRefinementAction({ itemId: me.open.id, refinement: {}, done: true }),
    ],
    [
      "a userId on a clear",
      () => clearDoneBuildListItemsAction({ buildListId: me.list.id, userId: me.user.id }),
    ],
    [
      "a userId on a read",
      () =>
        loadBuildListItemAction({ bikeId: me.bike.id, itemId: me.open.id, userId: victim.user.id }),
    ],
    [
      "a prototype key in a refinement",
      () =>
        setBuildListItemRefinementAction({ itemId: me.open.id, refinement: { constructor: "x" } }),
    ],
    ["a non-uuid id", () => setBuildListItemDoneAction({ itemId: "../../etc", done: true })],
  ])("%s", async (_label, call) => {
    expect(await call()).toEqual({ ok: false, code: "VALIDATION" });
    expect(fakeDb.calls).toEqual([]);
  });
});

describe("cross-origin", () => {
  it.each([
    ["tick", () => setBuildListItemDoneAction({ itemId: me.open.id, done: true })],
    ["refine", () => setBuildListItemRefinementAction({ itemId: me.open.id, refinement: {} })],
    ["clear", () => clearDoneBuildListItemsAction({ buildListId: me.list.id })],
    ["read", () => loadBuildListItemAction({ bikeId: me.bike.id, itemId: me.open.id })],
  ])("refuses a forged %s before any query", async (_label, call) => {
    setRequestHeaders({ origin: "https://evil.test", host: "localhost:3100" });
    expect(await call()).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toEqual([]);
  });
});
