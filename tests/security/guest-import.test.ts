/**
 * THREAT — `importGuestStateAction` takes a JSON document that a browser
 * assembled from `localStorage`, which is to say: a document the caller wrote.
 * It is the only action in the project whose input is a whole object graph
 * rather than a handful of form fields, and it creates rows in five tables. A
 * `curl` with a valid session cookie is its real input shape.
 *
 * CONTROLS PINNED
 *
 *   1. **Origin, then session, then anything else** (`withUser`). A forged
 *      cross-origin POST is `FORBIDDEN` whatever cookie it carried; an
 *      anonymous one is `UNAUTHORIZED` with an empty Prisma call log.
 *   2. **No mass assignment.** `GuestStateSchema` is a `strictObject` at every
 *      level: `id`, `userId`, `spec`, `createdAt`, `guestLocalId`,
 *      `passwordHash` smuggled into a bike are `VALIDATION`, and nothing is
 *      written. The columns that matter are not taken from the payload at all —
 *      `userId` comes from the session, `spec` and `parts` from `deriveBike`.
 *   3. **No reach into another account.** Every read and write carries
 *      `userId`; a payload naming a guest id another user already imported
 *      creates this caller's own row and leaves the other one untouched
 *      (`expectScopedToUser`).
 *   4. **The caps hold** (§4.4): 10 bikes, 80 parts, 20 checkups, 10 lists,
 *      250 items per checkup, 50 lines per list (`QUOTAS.itemsPerList`) and
 *      256 KB, each refused with nothing written.
 *   5. **Idempotent.** The same guest bike twice is one row; the second answer
 *      is `skipped: 'already-imported'` and not a single write (§6.8 AC8).
 *   6. **Rate limited.** `guest-import:<userId>`, three an hour, counted per
 *      user, with `retryAfterSec` on the refusal.
 *   7. **No hostile string reaches a lookup or a link.** Slugs and part ids are
 *      `[a-z0-9-]` before anything resolves them (path traversal), and a
 *      chosen product's URL is plain `https:` or it is not stored.
 *   8. **The visitor's clock cannot write the future** (§4.7).
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

const { importGuestStateAction } = await import("@/app/[locale]/(protected)/import/actions");
const { GUEST_CAPS, GUEST_STATE_VERSION, MAX_GUEST_PAYLOAD_BYTES } =
  await import("@/lib/guest/schema");
const { RATE_LIMITS } = await import("@/lib/security/rate-limit");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");

type GuestBike = import("@/lib/guest/schema").GuestBike;
type GuestState = import("@/lib/guest/schema").GuestState;

// Module scope: `deriveBike` walks the whole part catalogue, and the unit
// tier's 5 s timeout is measured on a CI runner ~3x slower than this laptop.
const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const ANSWERS = BIKE_PRESETS["gravel-1x11"] as Record<string, string>;
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";

const CHECKUP = {
  guestKey: CHECKUP_ID,
  scope: "full" as const,
  startedAt: "2026-09-14T08:00:00.000Z",
  completedAt: "2026-09-14T08:20:00.000Z",
  items: [
    {
      stepKey: "check-drivetrain#chain-wear",
      partId: "chain",
      guideSlug: "check-drivetrain",
      result: "ko" as const,
    },
  ],
};

const LIST = {
  name: "Révision",
  items: [
    {
      partId: "chain",
      action: "replace" as const,
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
      sortOrder: 0,
    },
  ],
};

function bike(patch: Partial<GuestBike> = {}): GuestBike {
  return {
    localId: LOCAL_ID,
    name: "Mon vélo",
    answers: ANSWERS,
    parts: DERIVED.parts,
    fit: null,
    updatedAt: "2026-09-14T09:00:00.000Z",
    checkups: [CHECKUP],
    lists: [LIST],
    ...patch,
  };
}

function state(...bikes: GuestBike[]): GuestState {
  return { version: GUEST_STATE_VERSION, bikes };
}

/** A deep clone with one field of the first bike replaced — the payload a script would send. */
function tampered(patch: Record<string, unknown>): unknown {
  const payload = JSON.parse(JSON.stringify(state(bike()))) as {
    bikes: Record<string, unknown>[];
  };
  Object.assign(payload.bikes[0], patch);
  return payload;
}

/** Nothing at all was written. */
function expectNoWrites(): void {
  expect(fakeDb.rows("Bike")).toEqual([]);
  expect(fakeDb.rows("Checkup")).toEqual([]);
  expect(fakeDb.rows("BuildList")).toEqual([]);
  expect(fakeDb.calls.filter((call) => call.op === "create")).toEqual([]);
}

interface SeededUser {
  id: string;
  email: string;
  name: string | null;
  locale: "fr" | "en";
}

let me: SeededUser;
let other: SeededUser;

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  me = (await fakeDb.seed("User", {
    email: "camille@velo-atelier.test",
    name: "Camille",
    locale: "fr",
  })) as unknown as SeededUser;
  other = (await fakeDb.seed("User", {
    email: "autre@velo-atelier.test",
    locale: "fr",
  })) as unknown as SeededUser;
  setSession(sessionFor(me));
  fakeDb.resetCalls();
});

describe("who is allowed to call it", () => {
  it("answers UNAUTHORIZED to an anonymous caller, before any query", async () => {
    setSession(null);
    expect(await importGuestStateAction(state(bike()))).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(fakeDb.calls).toEqual([]);
  });

  it("answers FORBIDDEN to a cross-origin POST, session or not", async () => {
    setRequestHeaders({ origin: "https://evil.test", host: "localhost:3100" });
    expect(await importGuestStateAction(state(bike()))).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toEqual([]);

    setSession(null);
    expect(await importGuestStateAction(state(bike()))).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toEqual([]);
  });
});

describe("mass assignment", () => {
  it("refuses a bike carrying a column the payload has no business naming", async () => {
    for (const extra of [
      { id: "00000000-0000-4000-8000-00000000dead" },
      { userId: "00000000-0000-4000-8000-00000000dead" },
      { spec: { version: 1 } },
      { createdAt: "2020-01-01T00:00:00.000Z" },
      { guestLocalId: LOCAL_ID },
      { specVersion: 99 },
      { passwordHash: "$2b$12$x" },
    ]) {
      expect(await importGuestStateAction(tampered(extra)), Object.keys(extra)[0]).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("refuses an extra key on a checkup, an item, a list or the envelope", async () => {
    const payloads = [
      tampered({ checkups: [{ ...CHECKUP, bikeId: "x" }] }),
      tampered({ checkups: [{ ...CHECKUP, items: [{ ...CHECKUP.items[0], checkupId: "x" }] }] }),
      tampered({ lists: [{ ...LIST, checkupId: "x" }] }),
      { ...state(bike()), userId: "x" },
    ];
    for (const payload of payloads) {
      expect(await importGuestStateAction(payload)).toEqual({ ok: false, code: "VALIDATION" });
    }
    expectNoWrites();
  });

  it("takes the owner from the session and the spec from the domain, never from the payload", async () => {
    const result = await importGuestStateAction(state(bike()));
    expect(result.ok).toBe(true);

    const [row] = fakeDb.rows("Bike") as Record<string, unknown>[];
    expect(row.userId).toBe(me.id);
    expect(row.spec).toEqual(DERIVED.spec);
    expect(row.specVersion).toBe(1);
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("another account's rows", () => {
  it("are neither read nor written when the payload names their guest bike", async () => {
    const theirs = (await fakeDb.seed("Bike", {
      userId: other.id,
      name: "Le vélo du voisin",
      answers: DERIVED.answers,
      spec: DERIVED.spec,
      parts: DERIVED.parts,
      guestLocalId: LOCAL_ID,
    })) as { id: string; name: string };
    fakeDb.resetCalls();

    const result = await importGuestStateAction(state(bike()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A row of this caller's own, not a second chance at theirs.
    expect(result.data.imported).toBe(1);
    expect(result.data.bikes[0].bikeId).not.toBe(theirs.id);
    expect(fakeDb.rows("Bike")).toHaveLength(2);
    const untouched = (fakeDb.rows("Bike") as { id: string; name: string }[]).find(
      (row) => row.id === theirs.id,
    );
    expect(untouched?.name).toBe("Le vélo du voisin");
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("the caps §4.4 names", () => {
  it("refuses more than ten bikes, and writes nothing", async () => {
    const eleven = Array.from({ length: GUEST_CAPS.bikes + 1 }, (_, index) =>
      bike({ localId: `1111111${index}-2222-4333-8444-555555555555` }),
    );
    expect(await importGuestStateAction(state(...eleven))).toEqual({
      ok: false,
      code: "VALIDATION",
    });
    expectNoWrites();
  });

  it("refuses more than eighty parts, twenty checkups or ten lists", async () => {
    const payloads = [
      tampered({ parts: Array(GUEST_CAPS.partsPerBike + 1).fill({}) }),
      tampered({ checkups: Array(GUEST_CAPS.checkupsPerBike + 1).fill(CHECKUP) }),
      tampered({ lists: Array(GUEST_CAPS.listsPerBike + 1).fill(LIST) }),
    ];
    for (const payload of payloads) {
      expect(await importGuestStateAction(payload)).toEqual({ ok: false, code: "VALIDATION" });
    }
    expectNoWrites();
  });

  it("refuses a checkup with more items than the corpus has steps, and a list over 50 lines", async () => {
    const item = CHECKUP.items[0];
    const line = LIST.items[0];
    const payloads = [
      tampered({
        checkups: [
          {
            ...CHECKUP,
            items: Array.from({ length: GUEST_CAPS.itemsPerCheckup + 1 }, (_, index) => ({
              ...item,
              stepKey: `check-drivetrain#step-${index}`,
            })),
          },
        ],
      }),
      tampered({
        lists: [
          {
            ...LIST,
            items: Array.from({ length: GUEST_CAPS.itemsPerList + 1 }, (_, index) => ({
              ...line,
              sortOrder: index,
            })),
          },
        ],
      }),
    ];
    for (const payload of payloads) {
      expect(await importGuestStateAction(payload)).toEqual({ ok: false, code: "VALIDATION" });
    }
    expectNoWrites();
  });

  it("keeps the list cap at the account's own quota, so an import cannot bring more", async () => {
    const { QUOTAS } = await import("@/lib/bike/rules");
    expect(GUEST_CAPS.itemsPerList).toBe(QUOTAS.itemsPerList);
    expect(GUEST_CAPS.itemsPerCheckup).toBe(250);
  });

  it("refuses a payload over 256 KB before it parses a field of it", async () => {
    const huge = tampered({ name: "x".repeat(MAX_GUEST_PAYLOAD_BYTES) });
    expect(await importGuestStateAction(huge)).toEqual({ ok: false, code: "TOO_MANY" });
    expectNoWrites();
  });
});

describe("hostile strings", () => {
  it("never lets a slug or a part id out of `[a-z0-9-]`", async () => {
    const payloads = [
      tampered({
        checkups: [
          { ...CHECKUP, items: [{ ...CHECKUP.items[0], guideSlug: "../../../etc/passwd" }] },
        ],
      }),
      tampered({
        checkups: [{ ...CHECKUP, items: [{ ...CHECKUP.items[0], partId: "../chain" }] }],
      }),
      tampered({ lists: [{ ...LIST, items: [{ ...LIST.items[0], guideSlug: "a/../b" }] }] }),
      tampered({ lists: [{ ...LIST, items: [{ ...LIST.items[0], reasonKey: "<script>" }] }] }),
    ];
    for (const payload of payloads) {
      expect(await importGuestStateAction(payload)).toEqual({ ok: false, code: "VALIDATION" });
    }
    expectNoWrites();
  });

  it("stores no chosen product whose link is not plain https", async () => {
    const product = { brand: "Shimano", model: "CN-HG601", size: "11v", vendor: "alltricks" };
    for (const url of [
      "javascript:alert(1)",
      "http://alltricks.fr/x",
      "data:text/html;base64,PHNjcmlwdD4=",
      "https://user:pass@alltricks.fr/x",
    ]) {
      const payload = tampered({
        lists: [{ ...LIST, items: [{ ...LIST.items[0], chosenProduct: { ...product, url } }] }],
      });
      expect(await importGuestStateAction(payload), url).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("stores no chosen product whose link is not on the retailer it names (§4.4)", async () => {
    const base = { brand: "Shimano", model: "CN-HG601", size: "11v" };
    for (const product of [
      // Somewhere else entirely.
      { ...base, vendor: "alltricks", url: "https://evil.example/chain" },
      // A real retailer, but not the one the product claims to come from.
      { ...base, vendor: "alltricks", url: "https://www.rosebikes.fr/search?q=chain" },
      // The host is a SUFFIX of a retailer's, which a substring check would pass.
      { ...base, vendor: "rosebikes", url: "https://www.rosebikes.fr.evil.example/x" },
      // A subdomain nobody declared.
      { ...base, vendor: "decathlon", url: "https://promo.decathlon.fr/x" },
      // A vendor §4.2 does not know (`RetailerId | 'other'`): not an `other`.
      { ...base, vendor: "velo-shop", url: "https://velo-shop.example/x" },
    ]) {
      const payload = tampered({
        lists: [{ ...LIST, items: [{ ...LIST.items[0], chosenProduct: product }] }],
      });
      expect(await importGuestStateAction(payload), product.url).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("keeps a retailer's own link, and a link the visitor pasted (§4.4)", async () => {
    const base = { brand: "Shimano", model: "CN-HG601", size: "11v" };
    for (const product of [
      { ...base, vendor: "alltricks", url: "https://www.alltricks.fr/C-40598-toutes-les-chaines" },
      { ...base, vendor: "rosebikes", url: "https://www.rosebikes.com/search?q=chain" },
      // `other` is the escape hatch the plan names: plain https is the only bar.
      { ...base, vendor: "other", url: "https://mon-velociste-du-coin.fr/chaine-11v" },
    ]) {
      fakeDb.resetCalls();
      const payload = state(
        bike({ lists: [{ ...LIST, items: [{ ...LIST.items[0], chosenProduct: product }] }] }),
      );
      const result = await importGuestStateAction(payload);
      expect(result.ok, product.url).toBe(true);
    }
  });
});

describe("importing the same browser twice", () => {
  it("is one bike, and the second call writes nothing at all (§6.8 AC8)", async () => {
    const first = await importGuestStateAction(state(bike()));
    expect(first.ok && first.data.imported).toBe(1);
    const before = fakeDb.rows("Bike")[0] as Record<string, unknown>;
    const checkupsBefore = fakeDb.rows("Checkup");
    fakeDb.resetCalls();

    // The other device's older copy, with different content under the same id.
    const older = bike({
      name: "Vieille copie",
      updatedAt: "2026-01-01T00:00:00.000Z",
      checkups: [],
      lists: [],
    });
    const second = await importGuestStateAction(state(older));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ imported: 0, skipped: 1, bikeId: before.id });
    expect(second.data.bikes[0].skipped).toBe("already-imported");
    expect(fakeDb.rows("Bike")).toEqual([before]);
    expect(fakeDb.rows("Checkup")).toEqual(checkupsBefore);
    expect(fakeDb.calls.filter((call) => call.op === "create")).toEqual([]);
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("the rate limit", () => {
  it("allows three imports an hour per user and refuses the fourth", async () => {
    expect(RATE_LIMITS.guestImportPerUser).toEqual({ max: 3, windowMs: 60 * 60_000 });

    for (let index = 0; index < RATE_LIMITS.guestImportPerUser.max; index++) {
      const result = await importGuestStateAction(
        state(bike({ localId: `2222222${index}-2222-4333-8444-555555555555` })),
      );
      expect(result.ok, `import ${index + 1}`).toBe(true);
    }

    const refused = await importGuestStateAction(
      state(bike({ localId: "33333333-2222-4333-8444-555555555555" })),
    );
    expect(refused).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(refused.ok === false && refused.retryAfterSec).toBeGreaterThan(0);
    expect(fakeDb.rows("Bike")).toHaveLength(RATE_LIMITS.guestImportPerUser.max);
  });

  it("counts per user: a neighbour who spent their three does not spend mine", async () => {
    setSession(sessionFor(other));
    for (let index = 0; index < RATE_LIMITS.guestImportPerUser.max + 1; index++) {
      await importGuestStateAction(
        state(bike({ localId: `4444444${index}-2222-4333-8444-555555555555` })),
      );
    }

    setSession(sessionFor(me));
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
  });

  it("is not spent by an empty browser, nor by a payload that never validated", async () => {
    for (let index = 0; index < 10; index++) {
      await importGuestStateAction({ version: GUEST_STATE_VERSION, bikes: [] });
      await importGuestStateAction(tampered({ userId: "x" }));
    }
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
  });
});

describe("the visitor's clock", () => {
  it("cannot store a checkup — or a bike — that happens in 2087", async () => {
    const future = {
      ...CHECKUP,
      startedAt: "2087-01-01T00:00:00.000Z",
      completedAt: "2087-01-02T00:00:00.000Z",
    };
    const before = Date.now();
    // The bike's own `updatedAt` is in the future too: with the fixture's
    // 2026-09-14 the assertion on it below could not fail, clamp or no clamp.
    const result = await importGuestStateAction(
      state(bike({ checkups: [future], updatedAt: "2087-01-03T00:00:00.000Z" })),
    );
    expect(result.ok).toBe(true);

    const [checkup] = fakeDb.rows("Checkup") as { startedAt: Date; completedAt: Date }[];
    expect(checkup.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(checkup.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(checkup.completedAt.getTime()).toBeLessThanOrEqual(Date.now());

    const [row] = fakeDb.rows("Bike") as { updatedAt: Date }[];
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
