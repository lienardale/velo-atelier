/**
 * The checkup actions against the real `_test` database (§4.8, §5.4).
 *
 * The recording fake already proves the shapes — the ownership predicate in the
 * `where`, `.strict()` inputs, the generated enums. What only PostgreSQL can
 * settle is everything the schema declares and the fake only imitates:
 *
 *   - `@@unique([checkupId, stepKey])`: autosaving the same checkup five times
 *     is five updates and one row per question, not five rows;
 *   - `@@unique([buildListId, partId, action])`: the same problem found twice
 *     is one line of the list;
 *   - `onDelete: Cascade` from `Bike` down through `Checkup`, `CheckupItem`,
 *     `BuildList` and `BuildListItem` — a delete that left orphans would pass
 *     every unit test;
 *   - `onDelete: SetNull` on `BuildListItem.checkupItemId`: a list outlives the
 *     checkup item it came from;
 *   - `VarChar(160)` / `VarChar(2000)`, enforced by the schema as well as by
 *     the action;
 *   - and the one that matters to a person: re-running a checkup does NOT throw
 *     away the cassette they had already ticked off the list.
 */
/* eslint-disable security/detect-object-injection -- step keys the test spells out, into its own fixtures */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

// The compiled corpus is a build artefact this tier does not produce; the
// frontmatter on disk carries the same plan (`tests/integration/content/parity`
// makes the same choice, for the same reason).
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
}));

const { saveCheckupAction, finishCheckupAction, loadCheckupAction, listCheckupsAction } =
  await import("@/app/[locale]/velo/[id]/controle/actions");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");

const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";

async function signedInUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Camille", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

async function gravelBike(userId: string) {
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  return prisma.bike.create({
    data: {
      userId,
      name: "Gravel",
      answers: derived.answers,
      spec: derived.spec,
      // The ORM's JSON union does not accept a precise array type; the domain
      // is not weakened to please it (same cast as the actions').
      parts: derived.parts as unknown as Prisma.InputJsonValue,
      partStates: { create: derived.parts.map((part) => ({ partId: part.partId })) },
    },
    select: { id: true },
  });
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    bikeRef: { kind: "demo" },
    scope: { kind: "full" },
    locale: "fr",
    answers: { [CHAIN]: "ko" },
    symptoms: { [CHAIN]: ["chain-elongation"] },
    notes: { [CHAIN]: "elle saute sous la charge" },
    toolsMissing: ["chain-checker"],
    startedAt: "2026-09-19T08:00:00.000Z",
    contentVersion: CONTENT_VERSION,
    ...overrides,
  };
}

beforeEach(() => {
  setRequestHeaders(sameOriginHeaders());
});

describe("autosave", () => {
  it("keeps one checkup and one row per question, however often it is saved", async () => {
    const user = await signedInUser("autosave@velo-atelier.test");
    const bike = await gravelBike(user.id);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await saveCheckupAction({ bikeId: bike.id, checkup: payload() })).toEqual({
        ok: true,
        data: null,
      });
    }
    expect(await prisma.checkup.count({ where: { bikeId: bike.id } })).toBe(1);

    const items = await prisma.checkupItem.findMany({ where: { checkup: { bikeId: bike.id } } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      stepKey: CHAIN,
      partId: "chain",
      guideSlug: "check-drivetrain",
      result: "KO",
      notes: "elle saute sous la charge",
    });
  });

  it("changes a verdict in place, and removes the row of a question that lost one", async () => {
    const user = await signedInUser("verdict@velo-atelier.test");
    const bike = await gravelBike(user.id);

    await saveCheckupAction({
      bikeId: bike.id,
      checkup: payload({ answers: { [CHAIN]: "ko", [CASSETTE]: "skipped" }, symptoms: {} }),
    });
    expect(await prisma.checkupItem.count({ where: { checkup: { bikeId: bike.id } } })).toBe(2);

    await saveCheckupAction({
      bikeId: bike.id,
      checkup: payload({ answers: { [CHAIN]: "ok" }, symptoms: {}, notes: {} }),
    });

    const items = await prisma.checkupItem.findMany({ where: { checkup: { bikeId: bike.id } } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ stepKey: CHAIN, result: "OK", notes: null });
  });

  it("reads the checkup back, and lists it with the number of answers", async () => {
    const user = await signedInUser("resume@velo-atelier.test");
    const bike = await gravelBike(user.id);
    await saveCheckupAction({ bikeId: bike.id, checkup: payload() });

    const loaded = await loadCheckupAction({ bikeId: bike.id });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.data === null) return;
    expect(loaded.data.answers[CHAIN]).toBe("ko");
    expect(loaded.data.notes[CHAIN]).toBe("elle saute sous la charge");
    expect(loaded.data.completedAt).toBeUndefined();

    const listed = await listCheckupsAction({ bikeId: bike.id });
    expect(listed.ok && listed.data).toMatchObject([{ answered: 1, scope: { kind: "full" } }]);
  });
});

describe("finishing", () => {
  it("closes the checkup, writes the derived list and tints the parts", async () => {
    const user = await signedInUser("finish@velo-atelier.test");
    const bike = await gravelBike(user.id);

    const result = await finishCheckupAction({
      bikeId: bike.id,
      checkup: payload({
        answers: { [CHAIN]: "ko", [CASSETTE]: "ok" },
        symptoms: { [CHAIN]: ["chain-elongation"] },
      }),
    });
    expect(result.ok).toBe(true);

    const checkup = await prisma.checkup.findFirstOrThrow({ where: { bikeId: bike.id } });
    expect(checkup.status).toBe("COMPLETED");
    expect(checkup.completedAt).not.toBeNull();

    const items = await prisma.buildListItem.findMany({
      where: { buildList: { bikeId: bike.id } },
      include: { checkupItem: { select: { stepKey: true } } },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      partId: "chain",
      action: "REPLACE",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
      sortOrder: 0,
    });
    // The line knows which question produced it (`onDelete: SetNull`).
    expect(items[0].checkupItem?.stepKey).toBe(CHAIN);

    const states = await prisma.bikePartState.findMany({
      where: { bikeId: bike.id, partId: { in: ["chain", "cassette"] } },
      orderBy: { partId: "asc" },
    });
    expect(states.map((state) => [state.partId, state.status])).toEqual([
      ["cassette", "OK"],
      ["chain", "ATTENTION"],
    ]);
  });

  it("keeps the visitor's own edits when the same checkup is finished again", async () => {
    const user = await signedInUser("recheck@velo-atelier.test");
    const bike = await gravelBike(user.id);
    await finishCheckupAction({ bikeId: bike.id, checkup: payload() });

    // W3-T2's columns: the visitor chose a chain and ticked it off.
    await prisma.buildListItem.updateMany({
      where: { buildList: { bikeId: bike.id }, partId: "chain" },
      data: {
        done: true,
        refinement: { speeds: "11" },
        chosenProduct: {
          brand: "KMC",
          model: "X11",
          size: "118",
          vendor: "rosebikes",
          url: "https://www.rosebikes.fr/x11",
        },
      },
    });

    await finishCheckupAction({ bikeId: bike.id, checkup: payload() });

    const items = await prisma.buildListItem.findMany({
      where: { buildList: { bikeId: bike.id } },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      done: true,
      refinement: { speeds: "11" },
      chosenProduct: expect.objectContaining({ brand: "KMC" }),
    });
  });

  it("drops a line the checkup no longer produces", async () => {
    const user = await signedInUser("drops@velo-atelier.test");
    const bike = await gravelBike(user.id);

    // No symptom: the KO falls back to the step's whole `ko[]` — two lines.
    await finishCheckupAction({ bikeId: bike.id, checkup: payload({ symptoms: {} }) });
    expect(await prisma.buildListItem.count({ where: { buildList: { bikeId: bike.id } } })).toBe(2);

    // Now the visitor says which one it was: one line, and the other is gone.
    await finishCheckupAction({ bikeId: bike.id, checkup: payload() });
    const items = await prisma.buildListItem.findMany({
      where: { buildList: { bikeId: bike.id } },
    });
    expect(items.map((item) => item.reasonKey)).toEqual(["chain-elongation"]);
  });

  it("keeps one line per (part, action) whatever the checkup says twice", async () => {
    const user = await signedInUser("unique@velo-atelier.test");
    const bike = await gravelBike(user.id);
    await finishCheckupAction({ bikeId: bike.id, checkup: payload() });
    await finishCheckupAction({ bikeId: bike.id, checkup: payload() });

    const lists = await prisma.buildList.findMany({ where: { bikeId: bike.id } });
    expect(lists).toHaveLength(1);
    expect(await prisma.buildListItem.count({ where: { buildListId: lists[0].id } })).toBe(1);
  });
});

describe("the schema's own guarantees", () => {
  it("cascades from the bike down to the build-list items", async () => {
    const user = await signedInUser("cascade@velo-atelier.test");
    const bike = await gravelBike(user.id);
    await finishCheckupAction({ bikeId: bike.id, checkup: payload() });

    const mine = { checkup: { bikeId: bike.id } };
    expect(await prisma.checkupItem.count({ where: mine })).toBeGreaterThan(0);
    expect(await prisma.buildListItem.count({ where: { buildList: { bikeId: bike.id } } })).toBe(1);

    await prisma.bike.delete({ where: { id: bike.id } });

    // Scoped to this bike: the file shares one database and does not truncate
    // between tests.
    expect(await prisma.checkup.count({ where: { bikeId: bike.id } })).toBe(0);
    expect(await prisma.checkupItem.count({ where: mine })).toBe(0);
    expect(await prisma.buildList.count({ where: { bikeId: bike.id } })).toBe(0);
    expect(await prisma.buildListItem.count({ where: { buildList: { bikeId: bike.id } } })).toBe(0);
  });

  it("refuses a note longer than the column before the database sees it", async () => {
    const user = await signedInUser("long@velo-atelier.test");
    const bike = await gravelBike(user.id);

    expect(
      await saveCheckupAction({
        bikeId: bike.id,
        checkup: payload({ notes: { [CHAIN]: "x".repeat(2001) } }),
      }),
    ).toEqual({ ok: false, code: "VALIDATION" });
    expect(await prisma.checkup.count({ where: { bikeId: bike.id } })).toBe(0);

    // 2 000 is accepted, which is what makes the cap the column's and not an
    // arbitrary smaller number.
    expect(
      await saveCheckupAction({
        bikeId: bike.id,
        checkup: payload({ notes: { [CHAIN]: "x".repeat(2000) } }),
      }),
    ).toEqual({ ok: true, data: null });
  });

  it("never touches another account's checkup", async () => {
    const victim = await signedInUser("victim@velo-atelier.test");
    const victimBike = await gravelBike(victim.id);
    await finishCheckupAction({ bikeId: victimBike.id, checkup: payload() });

    await signedInUser("attacker@velo-atelier.test");
    expect(await saveCheckupAction({ bikeId: victimBike.id, checkup: payload() })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await loadCheckupAction({ bikeId: victimBike.id })).toEqual({ ok: true, data: null });

    const victimCheckup = await prisma.checkup.findFirstOrThrow({
      where: { bikeId: victimBike.id },
    });
    expect(victimCheckup.status).toBe("COMPLETED");
  });
});
