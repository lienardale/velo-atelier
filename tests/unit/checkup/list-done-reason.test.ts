/**
 * Why a saved line is done, on the way OUT of Postgres (§5.4, §6.7; W3
 * follow-up (b): "wire it through … `toItem`").
 *
 * `app/[locale]/velo/[id]/liste/load.ts` turns each `BuildListItem` row into
 * the line the list page renders, and the page says "Marqué fait par un
 * contrôle" (`shop.list.done.auto`) exactly when that line carries
 * `doneReason: 'recheck-ok'`. The writes are pinned where they happen —
 * `closeRecheckedItems` on Postgres (`tests/integration/checkups.test.ts`), the
 * tick in `tests/security/build-list-actions.test.ts` — and the render in
 * `tests/e2e/build-list-refine.spec.ts`. This is the read between them: until
 * this file no Vitest tier read a done line back, so the loader could drop the
 * reason, or invent one, with only an e2e job to notice.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { loadBuildList } from "@/app/[locale]/velo/[id]/liste/load";
import { fakeDb } from "@/tests/_fakes/prisma";

const OWNER = "11111111-1111-4111-8111-111111111111";

interface Row {
  partId: string;
  done: boolean;
  doneReason: string | null;
}

/** One list of the owner's bike holding `rows`, read back the way the page reads it. */
async function readBack(rows: readonly Row[]) {
  await fakeDb.seed("User", { id: OWNER, email: "camille@velo-atelier.test", locale: "fr" });
  const bike = (await fakeDb.seed("Bike", {
    userId: OWNER,
    name: "Gravel",
    answers: {},
    spec: {},
    parts: [],
  })) as { id: string };
  const list = (await fakeDb.seed("BuildList", { bikeId: bike.id, name: "" })) as { id: string };
  for (const [sortOrder, row] of rows.entries()) {
    await fakeDb.seed("BuildListItem", {
      buildListId: list.id,
      action: "REPLACE",
      reasonKey: "worn",
      sortOrder,
      ...row,
    });
  }
  return (await loadBuildList(bike.id, OWNER)).items;
}

beforeEach(() => {
  fakeDb.reset();
});

describe("a saved line's doneReason, as the list page receives it", () => {
  it("is the reason a later checkup or the visitor's tick wrote", async () => {
    const [rechecked, ticked] = await readBack([
      { partId: "chain", done: true, doneReason: "recheck-ok" },
      { partId: "cassette", done: true, doneReason: "manual" },
    ]);
    expect(rechecked).toMatchObject({ partId: "chain", done: true, doneReason: "recheck-ok" });
    expect(ticked).toMatchObject({ partId: "cassette", done: true, doneReason: "manual" });
  });

  it("is absent on an open line, on a tick with no reason, and for a reason this release never writes", async () => {
    const items = await readBack([
      // Unticked since a checkup closed it: open, and not "closed by a checkup".
      { partId: "chain", done: false, doneReason: "recheck-ok" },
      // A tick stored before the column existed.
      { partId: "cassette", done: true, doneReason: null },
      // Not one of the two values `doneReason` is written with.
      { partId: "brake-pads-rear", done: true, doneReason: "auto" },
    ]);
    expect(items.map((item) => [item.partId, item.done])).toEqual([
      ["chain", false],
      ["cassette", true],
      ["brake-pads-rear", true],
    ]);
    for (const item of items) expect(Object.hasOwn(item, "doneReason"), item.partId).toBe(false);
  });
});
