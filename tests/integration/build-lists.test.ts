/**
 * The build-list actions against the real `_test` database (§5.5, §4.8).
 *
 * The component suite already proves the SHAPES — one action per kind of edit,
 * ownership in the `where`, an `ActionResult` back. What only PostgreSQL can
 * settle is what the schema declares and a fake can only imitate:
 *
 *   - `@@unique([buildListId, partId, action])`: the same part cannot be on one
 *     list twice for the same action, which is what makes a re-derived list
 *     idempotent instead of doubling;
 *   - `onDelete: Cascade` from `BuildList` to its items, and `SetNull` from the
 *     `CheckupItem` a line came from — a list outlives the checkup that made it
 *     (§4.2), and that is a database rule, not application code;
 *   - the `refinement` `Json` round trip: an object written comes back an
 *     object, and `/velo/[id]/liste` can read it;
 *   - ownership across TWO relations (`buildList: { bike: { userId } }`): a
 *     foreign item id finds no row, so the answer is `NOT_FOUND`, never
 *     `FORBIDDEN` (§4.7).
 *
 * The seeded "Révision printemps" list is also checked here, because §4.8 AC1's
 * promise — one build list with 2 items on the gravel bike — is a statement
 * about a real database.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { DEMO_BIKE_GUEST_IDS, DEMO_BUILD_LIST, DEMO_USER } from "@/prisma/seed-data";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const {
  clearDoneBuildListItemsAction,
  setBuildListItemDoneAction,
  setBuildListItemRefinementAction,
} = await import("@/app/[locale]/velo/[id]/liste/actions");

/** The seeded FR demo user, signed in, and their gravel bike's open list. */
async function seededList() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USER.email } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  const list = await prisma.buildList.findFirstOrThrow({
    where: { bike: { userId: user.id, guestLocalId: DEMO_BIKE_GUEST_IDS.gravel } },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  return { user, list };
}

/** A second account, so "someone else's list" is a real row and not a made-up id. */
async function otherUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Autre", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

/**
 * `prisma db seed`, as `tests/integration/bikes.test.ts` runs it.
 *
 * Spawning a whole Node process per test is what that file does, and it costs
 * about a second each — cheap for four tests, not for twenty. So the seed is
 * loaded ONCE here and the state the actions touch is restored between tests by
 * {@link restoreBuildListState}; only the tests that delete seeded rows pay for
 * a full reload.
 */
async function loadSeed(): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "seed"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`seed failed: ${result.stdout}${result.stderr}`);
}

/**
 * Put the seeded list back the way the seed wrote it.
 *
 * The seed upserts, and its update clause does not touch `done` or
 * `refinement` — so a re-seed would NOT undo what these tests write. That is
 * exactly the bug this helper exists to avoid: a test asserting `refinement`
 * is null passing or failing depending on which test ran before it.
 */
async function restoreBuildListState(): Promise<void> {
  await prisma.buildListItem.deleteMany({ where: { action: { not: "REPLACE" } } });
  await prisma.buildListItem.updateMany({
    data: { done: false, refinement: Prisma.DbNull },
  });
}

// `tests/setup.integration.ts` truncates before every FILE, so the seed the
// global setup loaded is gone by the time this one starts.
beforeAll(loadSeed);

beforeEach(async () => {
  setRequestHeaders(sameOriginHeaders());
  await restoreBuildListState();
});

describe("the seeded list (§4.8 AC1)", () => {
  it("is 'Révision printemps' with the two KO parts of the demo checkup", async () => {
    const { list } = await seededList();
    expect(list.name).toBe(DEMO_BUILD_LIST.name);
    expect(list.status).toBe("OPEN");
    expect(list.items.map((item) => item.partId)).toEqual(["chain", "brake-pads-rear"]);
    expect(list.items.every((item) => item.action === "REPLACE")).toBe(true);
    expect(list.items.map((item) => item.reasonKey)).toEqual(["chain-elongation", "pad-worn"]);
  });

  it("carries the chosen chain as an object, not a string", async () => {
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain");
    expect(chain?.chosenProduct).toMatchObject({
      brand: "Shimano",
      model: "CN-HG601",
      vendor: "alltricks",
    });
    expect(String((chain?.chosenProduct as { url: string }).url).startsWith("https://")).toBe(true);
  });

  it("points each line back at the checkup step that produced it", async () => {
    const { list } = await seededList();
    const withStep = await prisma.buildListItem.findMany({
      where: { buildListId: list.id },
      select: { partId: true, checkupItem: { select: { stepKey: true } } },
      orderBy: { sortOrder: "asc" },
    });
    expect(withStep.map((row) => row.checkupItem?.stepKey)).toEqual([
      "check-drivetrain#chain-wear",
      "check-brakes-disc#pad-wear",
    ]);
  });
});

describe("ticking a line off", () => {
  it("writes it, and untickes it again", async () => {
    const { list } = await seededList();
    const item = list.items[0];

    expect(await setBuildListItemDoneAction({ itemId: item.id, done: true })).toEqual({
      ok: true,
      data: null,
    });
    expect((await prisma.buildListItem.findUniqueOrThrow({ where: { id: item.id } })).done).toBe(
      true,
    );

    await setBuildListItemDoneAction({ itemId: item.id, done: false });
    expect((await prisma.buildListItem.findUniqueOrThrow({ where: { id: item.id } })).done).toBe(
      false,
    );
  });

  it("answers NOT_FOUND for another account's line, and changes nothing", async () => {
    const { list } = await seededList();
    const item = list.items[0];
    await otherUser("not-mine@velo-atelier.test");

    expect(await setBuildListItemDoneAction({ itemId: item.id, done: true })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect((await prisma.buildListItem.findUniqueOrThrow({ where: { id: item.id } })).done).toBe(
      false,
    );
  });

  it("refuses an input that is not the shape it declared", async () => {
    await seededList();
    for (const input of [
      {},
      { itemId: "not-a-uuid", done: true },
      { itemId: "00000000-0000-4000-8000-000000000001", done: "yes" },
      { itemId: "00000000-0000-4000-8000-000000000001", done: true, extra: 1 },
    ]) {
      expect(await setBuildListItemDoneAction(input), JSON.stringify(input)).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
  });
});

describe("the refinement", () => {
  it("round-trips through the Json column as an object", async () => {
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain")!;

    expect(
      await setBuildListItemRefinementAction({
        itemId: chain.id,
        refinement: { speeds: "11", "e-rated": "false" },
      }),
    ).toEqual({ ok: true, data: null });

    const stored = await prisma.buildListItem.findUniqueOrThrow({ where: { id: chain.id } });
    expect(stored.refinement).toEqual({ speeds: "11", "e-rated": "false" });
  });

  it("replaces rather than merges: a cleared answer is gone", async () => {
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain")!;
    await setBuildListItemRefinementAction({ itemId: chain.id, refinement: { speeds: "11" } });
    await setBuildListItemRefinementAction({ itemId: chain.id, refinement: {} });

    const stored = await prisma.buildListItem.findUniqueOrThrow({ where: { id: chain.id } });
    expect(stored.refinement).toEqual({});
  });

  it("refuses a key that is not attribute-shaped, and an oversized value", async () => {
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain")!;
    for (const refinement of [
      // All-lowercase, so the id pattern alone would let them through.
      JSON.parse('{"constructor": "x"}') as Record<string, string>,
      JSON.parse('{"prototype": "x"}') as Record<string, string>,
      { Speeds: "11" },
      { "speeds.nested": "11" },
      { speeds: "x".repeat(65) },
    ]) {
      expect(
        await setBuildListItemRefinementAction({ itemId: chain.id, refinement }),
        JSON.stringify(refinement),
      ).toEqual({ ok: false, code: "VALIDATION" });
    }
    expect(
      (await prisma.buildListItem.findUniqueOrThrow({ where: { id: chain.id } })).refinement,
    ).toBeNull();
  });

  it("drops an own `__proto__` key rather than storing it (zod 4 behaviour)", async () => {
    // Verified against the installed zod 4.5.4: `z.record` SKIPS an own
    // `__proto__` key instead of failing the parse, so the payload a browser
    // could send arrives sanitised rather than refused. The end state is what
    // matters — the key never reaches the column, and the stored object is a
    // plain one — so this is asserted rather than forced into a refusal.
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain")!;
    const refinement = JSON.parse('{"__proto__": "x", "speeds": "11"}') as Record<string, string>;

    expect(await setBuildListItemRefinementAction({ itemId: chain.id, refinement })).toEqual({
      ok: true,
      data: null,
    });
    const stored = (await prisma.buildListItem.findUniqueOrThrow({ where: { id: chain.id } }))
      .refinement as Record<string, unknown>;
    expect(stored).toEqual({ speeds: "11" });
    expect(Object.hasOwn(stored, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
  });

  it("refuses more answers than a part has attributes", async () => {
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain")!;
    const refinement = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`attr-${index}`, "x"]),
    );
    expect(await setBuildListItemRefinementAction({ itemId: chain.id, refinement })).toEqual({
      ok: false,
      code: "TOO_MANY",
    });
  });

  it("answers NOT_FOUND for another account's line", async () => {
    const { list } = await seededList();
    const chain = list.items.find((item) => item.partId === "chain")!;
    await otherUser("not-mine-either@velo-atelier.test");
    expect(
      await setBuildListItemRefinementAction({ itemId: chain.id, refinement: { speeds: "11" } }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("clearing what is done", () => {
  // The first test deletes a seeded row for good; the cheap restore cannot put
  // it back, so this block reloads the seed like the schema block below.
  beforeEach(loadSeed);

  it("removes the done lines and keeps the rest", async () => {
    const { list } = await seededList();
    await setBuildListItemDoneAction({ itemId: list.items[0].id, done: true });

    expect(await clearDoneBuildListItemsAction({ buildListId: list.id })).toEqual({
      ok: true,
      data: { removed: 1 },
    });
    const left = await prisma.buildListItem.findMany({ where: { buildListId: list.id } });
    expect(left.map((item) => item.partId)).toEqual(["brake-pads-rear"]);
  });

  it("removes nothing when nothing is done", async () => {
    const { list } = await seededList();
    expect(await clearDoneBuildListItemsAction({ buildListId: list.id })).toEqual({
      ok: true,
      data: { removed: 0 },
    });
    expect(await prisma.buildListItem.count({ where: { buildListId: list.id } })).toBe(2);
  });

  it("answers NOT_FOUND for another account's list, and clears nothing", async () => {
    const { list } = await seededList();
    await setBuildListItemDoneAction({ itemId: list.items[0].id, done: true });
    await otherUser("third@velo-atelier.test");

    expect(await clearDoneBuildListItemsAction({ buildListId: list.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await prisma.buildListItem.count({ where: { buildListId: list.id } })).toBe(2);
  });
});

describe("what the schema itself guarantees", () => {
  // These four delete or add rows the others depend on, so they pay for a
  // full reload rather than the cheap restore above.
  beforeEach(loadSeed);

  it("refuses the same part twice for the same action on one list", async () => {
    const { list } = await seededList();
    await expect(
      prisma.buildListItem.create({
        data: {
          buildListId: list.id,
          partId: "chain",
          action: "REPLACE",
          reasonKey: "chain-elongation",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows the same part for a DIFFERENT action", async () => {
    const { list } = await seededList();
    const created = await prisma.buildListItem.create({
      data: {
        buildListId: list.id,
        partId: "chain",
        action: "CLEAN",
        reasonKey: "chain-dirty",
      },
    });
    expect(created.id).toBeTruthy();
  });

  it("takes its items with it when the list goes", async () => {
    const { list } = await seededList();
    await prisma.buildList.delete({ where: { id: list.id } });
    expect(await prisma.buildListItem.count({ where: { buildListId: list.id } })).toBe(0);
  });

  it("outlives the checkup it came from (§4.2)", async () => {
    const { list } = await seededList();
    const checkup = await prisma.checkup.findFirstOrThrow({
      where: { buildList: { id: list.id } },
    });

    await prisma.checkup.delete({ where: { id: checkup.id } });

    const kept = await prisma.buildList.findUniqueOrThrow({
      where: { id: list.id },
      include: { items: true },
    });
    expect(kept.checkupId).toBeNull();
    expect(kept.items).toHaveLength(2);
    // The line survives; only its pointer back to the step is nulled.
    expect(kept.items.every((item) => item.checkupItemId === null)).toBe(true);
  });
});
