/**
 * The guest-import payload: what this browser offers, what the server will
 * take, and what the browser may forget afterwards.
 *
 * Three halves, and the seams between them are the point:
 *
 *   `collectGuestState` reads three storage keys written by three other modules
 *   and projects them onto one contract;
 *   `GuestStateSchema` is the only thing the server trusts;
 *   `settleGuestImport` turns the server's answer into the keys to clear.
 *
 * So the load-bearing test here is the ROUND TRIP — everything the collector
 * can produce must parse, and what it collects must be what the WIZARD wrote.
 * That second half is the one this file did not have until 2026-10-07: its
 * checkup fixture was a hand-written `CheckupState` with `steps`, a shape
 * nothing has stored since W3, so the collector could drop every real checkup
 * with every test green (`.debug/017` §5.6). Every fixture below is now made
 * by `tests/_helpers/guest-work.ts`: the real plan, the real reducer,
 * `toStored`, `writeStoredCheckup`, `writeGuestBuildList`.
 */
/* eslint-disable security/detect-object-injection -- step keys and record names the test spells out, into its own fresh clones */
import { describe, expect, it } from "vitest";

import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { deriveBuildList } from "@/lib/checkup/build-list";
import { MAX_NOTE_LENGTH, MAX_SYMPTOMS } from "@/lib/checkup/reducer";
import { readStoredCheckup, toStored, writeStoredCheckup } from "@/lib/checkup/storage";
import { CHECKUP_STATE_VERSION } from "@/lib/checkup/types";
import { withinJsonBudget } from "@/lib/bike/rules";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { KO_ACTIONS } from "@/lib/domain/schema/procedure";
import { isRefinementKey, MAX_REFINEMENT_VALUE_LENGTH, refinementOf } from "@/lib/shop/refinement";
import {
  GUEST_NAMES,
  guestRun,
  guestWork,
  listPageEdit,
  memoryStorage,
  partsScope,
  planFromDisk,
  storedListLines,
} from "@/tests/_helpers/guest-work";
import {
  CHAIN as CHAIN_LINE,
  FRONT_PADS,
  PRODUCT_TITLE,
  PRODUCT_URL,
  REAR_PADS,
  wornPadsAndChain,
} from "@/tests/_helpers/long-answers";

import {
  clearGuestKeys,
  collectGuestState,
  GUEST_CAPS,
  GUEST_STATE_VERSION,
  guestImportKeys,
  guestStateBytes,
  isEmptyGuestState,
  MAX_GUEST_PAYLOAD_BYTES,
  parseGuestState,
  settleGuestImport,
  withinGuestPayloadBudget,
  type GuestBikeImport,
  type GuestCollection,
  type GuestImportSummary,
  type GuestState,
} from "./schema";

// ── fixtures (module scope: the part catalogue and the corpus are not cheap,
// and the unit tier's testTimeout is 5 s on a CI runner ~3x slower than this
// laptop) ────────────────────────────────────────────────────────────────────

const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";
const STARTED_AT = "2026-09-10T08:00:00.000Z";
const COMPLETED_AT = "2026-09-10T08:12:00.000Z";

/** A finished partial checkup: the chain is worn (with a note), the cassette is fine. */
const work = guestWork({
  answers: BIKE_PRESETS["gravel-1x11"],
  fit: { saddleHeightMm: 742 },
  checkup: (build) =>
    guestRun({
      id: CHECKUP_ID,
      build,
      scope: partsScope("chain", "cassette"),
      verdicts: {
        [CHAIN]: { ko: ["chain-elongation"], notes: "élongation 0,8 %" },
        [CASSETTE]: "ok",
      },
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    }),
});
const LOCAL_BIKE_RAW = work.storage.map.get(LOCAL_BIKE_KEY) as string;
const CHECKUP_RAW = work.storage.map.get(checkupKey("local")) as string;
const LIST_RAW = work.storage.map.get(buildListKey("local")) as string;

const collection = work.collect();
const collected = collection.state;

/** The payload, as it arrives: a JSON round trip away from the collector's objects. */
function payload(): GuestState {
  return JSON.parse(JSON.stringify(collected)) as GuestState;
}

/** A storage holding the bike and whatever the test puts under the checkup key. */
function storageWithCheckup(raw: string | null) {
  return memoryStorage({
    [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
    ...(raw === null ? {} : { [checkupKey("local")]: raw }),
  });
}

const collect = (storage: ReturnType<typeof memoryStorage> | null): GuestCollection =>
  collectGuestState({ storage, ...GUEST_NAMES });

/**
 * The two halves of one emoji and the character that replaces a half left
 * alone — by their codes, so that no tool reads this file as holding one.
 * `HIGH + LOW` is U+1F600, a well-formed pair.
 */
const HIGH = String.fromCharCode(0xd83d);
const LOW = String.fromCharCode(0xde00);
const EMOJI = HIGH + LOW;
const REPLACEMENT = String.fromCharCode(0xfffd);

/** Every string inside `value` — keys and values, at any depth. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...stringsOf(child)]);
}

// ── the collector ────────────────────────────────────────────────────────────

describe("collectGuestState", () => {
  it("returns an empty state when this browser holds nothing", () => {
    const { state, checkup } = collect(memoryStorage());
    expect(state).toEqual({ version: GUEST_STATE_VERSION, bikes: [] });
    expect(checkup).toBe("absent");
    expect(isEmptyGuestState(state)).toBe(true);
  });

  it("returns an empty state where storage cannot be reached at all", () => {
    expect(collect(null).state.bikes).toEqual([]);
  });

  it("carries the guest bike's own id, so the import can recognise it later", () => {
    expect(collected.bikes).toHaveLength(1);
    expect(collected.bikes[0].localId).toBe(work.bike.id);
    expect(collected.bikes[0].updatedAt).toBe(work.bike.updatedAt);
    expect(collected.bikes[0].fit).toEqual({ saddleHeightMm: 742 });
    expect(isEmptyGuestState(collected)).toBe(false);
  });

  it("names the bike in the visitor's language — the guest bike has no name", () => {
    expect(collected.bikes[0].name).toBe(GUEST_NAMES.bikeName);
  });

  it("reads the checkup the wizard really stores — toStored, under the real key", () => {
    // THE test that was missing. What is under the key has no `steps` and no
    // `cursor`, because that is what `toStored` writes…
    const stored = JSON.parse(CHECKUP_RAW) as Record<string, unknown>;
    expect(stored).toEqual(JSON.parse(JSON.stringify(toStored(work.checkup!))));
    expect(stored).not.toHaveProperty("steps");
    expect(stored).not.toHaveProperty("cursor");

    // …and the collector reads it: the checkup is IN the payload, as answers.
    expect(collection.checkup).toBe("collected");
    expect(collected.bikes[0].checkups).toEqual([
      {
        guestKey: CHECKUP_ID,
        scope: { kind: "parts", partIds: ["chain", "cassette"] },
        answers: { [CHAIN]: "ko", [CASSETTE]: "ok" },
        symptoms: { [CHAIN]: ["chain-elongation"] },
        notes: { [CHAIN]: "élongation 0,8 %" },
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
    ]);
    // …which the server's schema accepts, with the checkup still there.
    const parsed = parseGuestState(payload());
    expect(parsed.ok && parsed.state.bikes[0].checkups).toHaveLength(1);
  });

  it("carries no step, no part and no guide for an answer — the server plans (§5.4)", () => {
    const [checkup] = collected.bikes[0].checkups;
    expect(Object.keys(checkup).sort()).toEqual(
      ["answers", "completedAt", "guestKey", "notes", "scope", "startedAt", "symptoms"].sort(),
    );
    expect(JSON.stringify(checkup)).not.toContain("guideSlug");
    expect(JSON.stringify(checkup)).not.toContain('partId"');
  });

  it("carries a full checkup's scope as full, and an unfinished one without an end", () => {
    const running = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: { kind: "full" },
          verdicts: { [CHAIN]: "ok" },
          startedAt: STARTED_AT,
        }),
    }).collect();
    const [checkup] = running.state.bikes[0].checkups;
    expect(checkup.scope).toEqual({ kind: "full" });
    expect(checkup).not.toHaveProperty("completedAt");
    expect(parseGuestState(JSON.parse(JSON.stringify(running.state))).ok).toBe(true);
  });

  it("ignores the demo bike's checkup — there is no row to attach it to", () => {
    const storage = memoryStorage({ [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW });
    expect(writeStoredCheckup("demo", toStored(work.checkup!), storage)).toBe(true);
    const { state, checkup } = collect(storage);
    expect(state.bikes[0].checkups).toEqual([]);
    expect(checkup).toBe("absent");
    expect(guestImportKeys()).toEqual([LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")]);
  });

  it("reports a checkup it cannot read, and does NOT remove it", () => {
    // Not JSON; JSON the wizard's schema refuses; a version this build does not
    // know; and the pre-W3 shape, which is not what the wizard writes either.
    const unreadable = [
      "{not json",
      JSON.stringify({ version: 1, id: "not-a-uuid" }),
      JSON.stringify({ ...toStored(work.checkup!), version: CHECKUP_STATE_VERSION + 1 }),
      JSON.stringify({ id: CHECKUP_ID, steps: [], cursor: 0, answers: {} }),
    ];
    for (const raw of unreadable) {
      const storage = storageWithCheckup(raw);
      const { state, checkup } = collect(storage);
      expect(checkup, raw).toBe("unreadable");
      // Not half-read: nothing of it is in the payload…
      expect(state.bikes[0].checkups).toEqual([]);
      // …and the key is exactly as it was. The wizard's own read
      // (`readStoredCheckup`) removes such a value; the import must not.
      expect(storage.map.get(checkupKey("local"))).toBe(raw);
    }
  });

  it("is the read that differs from the wizard's: readStoredCheckup removes the same value", () => {
    const storage = storageWithCheckup("{not json");
    expect(readStoredCheckup("local", storage)).toBeNull();
    expect(storage.map.has(checkupKey("local"))).toBe(false);
  });

  it("does not send a checkup nobody answered — an empty row would show as history", () => {
    const storage = storageWithCheckup(
      JSON.stringify({ ...toStored(work.checkup!), answers: {}, symptoms: {}, notes: {} }),
    );
    const { state, checkup } = collect(storage);
    expect(checkup).toBe("empty");
    expect(state.bikes[0].checkups).toEqual([]);
  });

  it("reports unreadable a checkup the contract would refuse, instead of sinking the bike", () => {
    // The wizard's guard puts no ceiling on the number of answers; the contract
    // does. Sent as is, this checkup would make the server refuse the WHOLE
    // payload — the bike with it, import after import.
    const answers = Object.fromEntries(
      Array.from({ length: GUEST_CAPS.answersPerCheckup + 1 }, (_, index) => [
        `check-drivetrain#step-${index}`,
        "ok",
      ]),
    );
    const raw = JSON.stringify({ ...toStored(work.checkup!), answers });
    const storage = storageWithCheckup(raw);
    const { state, checkup } = collect(storage);
    expect(checkup).toBe("unreadable");
    expect(state.bikes[0].checkups).toEqual([]);
    expect(storage.map.get(checkupKey("local"))).toBe(raw);
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it("reports unreadable a checkup holding what PostgreSQL would refuse — a U+0000, a date in year 0", () => {
    // Both pass the wizard's own guard (a note is a length, a date is ISO
    // 8601). Sent as is, the server would refuse the whole payload — and
    // before 2026-10-09 it did not even do that: it threw in the transaction.
    const stored = toStored(work.checkup!);
    const cases = {
      "a U+0000 in a note": {
        ...stored,
        notes: { [CHAIN]: `usure${String.fromCharCode(0)}0,8 %` },
      },
      "startedAt in year 0000": { ...stored, startedAt: "0000-01-01T00:00:00.000Z" },
    };
    for (const [name, value] of Object.entries(cases)) {
      const raw = JSON.stringify(value);
      const storage = storageWithCheckup(raw);
      // The wizard's guard does take it: the import's read is where it stops.
      expect(readStoredCheckup("local", storageWithCheckup(raw)), name).not.toBeNull();
      const { state, checkup } = collect(storage);
      expect(checkup, name).toBe("unreadable");
      expect(state.bikes[0].checkups, name).toEqual([]);
      expect(storage.map.get(checkupKey("local")), name).toBe(raw);
      // The bike still goes: the payload without the checkup is one the server takes.
      expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok, name).toBe(true);
    }
  });

  it("collects a note the wizard's own cap cut in the middle of an emoji — with U+FFFD, not half a pair", () => {
    // Not a hand-made value: the reducer caps a note with `slice(0, 2000)`,
    // and a slice counts code units. An emoji astride the cap leaves its first
    // half. zod, JSON and the wizard's guard all carry it; no row ever holds it.
    const cut = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: partsScope("chain", "cassette"),
          verdicts: {
            [CHAIN]: {
              ko: ["chain-elongation"],
              notes: `${EMOJI} ${"x".repeat(MAX_NOTE_LENGTH - 4)}${EMOJI}`,
            },
            [CASSETTE]: "ok",
          },
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
        }),
    });
    const raw = cut.storage.map.get(checkupKey("local")) as string;
    const storedNote = (JSON.parse(raw) as { notes: Record<string, string> }).notes[CHAIN];
    expect(storedNote).toHaveLength(MAX_NOTE_LENGTH);
    expect(storedNote.endsWith(HIGH)).toBe(true);
    expect(storedNote.isWellFormed()).toBe(false);

    const { state, checkup } = cut.collect();
    // Collected — a cut note is a note, not a reason to leave the checkup behind.
    expect(checkup).toBe("collected");
    const note = state.bikes[0].checkups[0].notes[CHAIN];
    // The half is replaced, where it was; the WHOLE emoji before it is untouched.
    expect(note).toBe(`${storedNote.slice(0, -1)}${REPLACEMENT}`);
    expect(note.startsWith(`${EMOJI} x`)).toBe(true);
    expect(note).toHaveLength(MAX_NOTE_LENGTH);
    // What is sent is a payload the server takes…
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
    // …and reading wrote nothing: the key is as the wizard left it.
    expect(cut.storage.map.get(checkupKey("local"))).toBe(raw);
  });

  it("hands over no lone surrogate from ANY key — a part's attribute, the fit, a line's refinement and product", () => {
    // None of these three values is checked against the contract on this side
    // (only the checkup is), and the server refuses a payload WHOLE: one half
    // emoji in a product name would be an import that fails for ever.
    const bikeRaw = JSON.parse(LOCAL_BIKE_RAW) as {
      parts: { partId: string; attributes: Record<string, unknown> }[];
      fit: Record<string, unknown>;
    };
    const pads = bikeRaw.parts.find((part) => part.partId === "brake-pads-front");
    if (pads === undefined) throw new Error("the gravel preset has front brake pads");
    pads.attributes["pad-model"] = `B05S${HIGH}`;
    bikeRaw.fit = { saddleHeightMm: 742, [`note${LOW}`]: `${LOW}${HIGH}` };

    const listRaw = JSON.parse(LIST_RAW) as { name?: string; items: Record<string, unknown>[] };
    // A name the collector itself cuts at 80 code units — through an emoji.
    listRaw.name = `${"n".repeat(79)}${EMOJI}`;
    listRaw.items[0].refinement = { speeds: `11${LOW}`, model: EMOJI };
    listRaw.items[0].chosenProduct = {
      brand: `${HIGH}Shimano`,
      model: `CN${HIGH}HG601`,
      size: `11v${LOW}`,
      vendor: "other",
      url: "https://example.com/chaine",
    };

    const raws = {
      [LOCAL_BIKE_KEY]: JSON.stringify(bikeRaw),
      [checkupKey("local")]: CHECKUP_RAW,
      [buildListKey("local")]: JSON.stringify(listRaw),
    };
    const storage = memoryStorage(raws);
    const { state, checkup } = collect(storage);
    expect(checkup).toBe("collected");
    const [bike] = state.bikes;

    const collectedPads = (
      bike.parts as { partId: string; attributes: Record<string, unknown> }[]
    ).find((part) => part.partId === "brake-pads-front");
    expect(collectedPads?.attributes["pad-model"]).toBe(`B05S${REPLACEMENT}`);
    // A key too: the contract walks the keys of `fit`, and would refuse this one.
    expect(bike.fit).toEqual({
      saddleHeightMm: 742,
      [`note${REPLACEMENT}`]: `${REPLACEMENT}${REPLACEMENT}`,
    });
    // The collector's own cut (`slice(0, 80)`) left a half; it does not send it.
    expect(bike.lists[0].name).toBe(`${"n".repeat(79)}${REPLACEMENT}`);
    const [line] = bike.lists[0].items;
    // A whole emoji is a character like any other, and stays one.
    expect(line.refinement).toEqual({ speeds: `11${REPLACEMENT}`, model: EMOJI });
    expect(line.chosenProduct).toEqual({
      brand: `${REPLACEMENT}Shimano`,
      model: `CN${REPLACEMENT}HG601`,
      size: `11v${REPLACEMENT}`,
      vendor: "other",
      url: "https://example.com/chaine",
    });

    // Not one string of the payload is ill-formed, and the server takes it…
    const strings = stringsOf(state);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter((value) => !value.isWellFormed())).toEqual([]);
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
    // …while the very same values, sent as they are stored, are refused: the
    // replacement is what lets this bike in, not a contract that looks away.
    const asStored = JSON.parse(JSON.stringify(state)) as GuestState;
    asStored.bikes[0].lists[0].items[0].refinement = { speeds: `11${LOW}` };
    expect(parseGuestState(asStored).ok).toBe(false);
    // Storage is read, never repaired: all three keys byte for byte.
    for (const [key, raw] of Object.entries(raws)) expect(storage.map.get(key), key).toBe(raw);
  });

  it("changes nothing in a payload that holds no lone surrogate", () => {
    // The projection of the module-scope fixture, which has accents, a comma
    // and no half pair: the same values the three keys hold.
    const [bike] = collected.bikes;
    expect(bike.parts).toEqual(work.bike.parts);
    expect(bike.answers).toEqual(work.bike.answers);
    expect(bike.checkups[0].notes).toEqual({ [CHAIN]: "élongation 0,8 %" });
  });

  it("reads what writeGuestBuildList actually writes, named in the visitor's language", () => {
    // The producer, not a hand-built shape: `guestWork` wrote the list the way
    // "Créer ma liste" does, so this fails if the envelope moves.
    const envelope = JSON.parse(LIST_RAW) as { checkupId: string; items: unknown[] };
    expect(envelope.checkupId).toBe(CHECKUP_ID);
    expect(envelope.items).toEqual(deriveBuildList(work.checkup!));

    expect(collected.bikes[0].lists).toEqual([
      {
        // The envelope carries no name, so the list takes the caller's.
        name: GUEST_NAMES.listName,
        items: [
          {
            partId: "chain",
            action: "replace",
            reasonKey: "chain-elongation",
            guideSlug: "replace-chain",
            done: false,
            sortOrder: 0,
          },
        ],
      },
    ]);
  });

  it("survives a storage that throws on every read", () => {
    const throwing = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(collect(throwing).state.bikes).toEqual([]);
  });

  it("keeps the bike when only the checkup and list keys are unreadable", () => {
    // A quota error part-way through a read is one key failing, not all three.
    const partly = {
      ...memoryStorage(),
      getItem: (key: string) => {
        if (key === LOCAL_BIKE_KEY) return LOCAL_BIKE_RAW;
        throw new Error("blocked");
      },
    };
    const { state, checkup } = collect(partly);
    expect(state.bikes[0].localId).toBe(work.bike.id);
    expect(state.bikes[0].checkups).toEqual([]);
    expect(state.bikes[0].lists).toEqual([]);
    // A read that threw proves nothing about the key: it is not "absent".
    expect(checkup).toBe("unreadable");
  });

  it("has nothing to read on a server, where there is no window", () => {
    // `collectGuestState` is called from a client component, but the module is
    // imported by the action too: the default storage must not throw in Node.
    expect(collectGuestState({ ...GUEST_NAMES }).state.bikes).toEqual([]);
  });

  it("names an unnamed (or blank-named) list in the visitor's language", () => {
    const items = (JSON.parse(LIST_RAW) as { items: unknown[] }).items;
    for (const stored of [{ items }, { name: "   ", items }, { name: "Révision", items }]) {
      const storage = memoryStorage({
        [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
        [buildListKey("local")]: JSON.stringify(stored),
      });
      const [list] = collect(storage).state.bikes[0].lists;
      expect(list.name).toBe(stored.name === "Révision" ? "Révision" : GUEST_NAMES.listName);
    }
  });

  it("drops an empty list, and defaults the item fields the envelope may omit", () => {
    const empty = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [buildListKey("local")]: JSON.stringify({ name: "Vide", items: [] }),
    });
    expect(collect(empty).state.bikes[0].lists).toEqual([]);

    // `done` and `sortOrder` are optional in the stored item: a list written by
    // an older build, or hand-edited, still imports with the defaults.
    const sparse = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [buildListKey("local")]: JSON.stringify({
        items: [{ partId: "chain", action: "replace", reasonKey: "chain-elongation" }],
      }),
    });
    const [list] = collect(sparse).state.bikes[0].lists;
    expect(list.items[0]).toEqual({
      partId: "chain",
      action: "replace",
      reasonKey: "chain-elongation",
      done: false,
      sortOrder: 0,
    });
  });
});

// ── the collector, and a list line's refinement ──────────────────────────────

describe("collectGuestState — a list line's refinement is collected entry by entry", () => {
  /**
   * Until 2026-10-13 the stored refinement was forwarded as it was, and the
   * list's form let a visitor type an answer of any length. One answer over
   * 120 characters — a product address pasted into "Référence des plaquettes"
   * — made the server refuse the WHOLE payload, on every retry: that guest
   * bike could not be imported at all (`.debug/017` §5.9). The storage below
   * is the wizard's, and the long answer is put there by the list page's own
   * write (`listPageEdit`), as the page of before that date did.
   */
  const CAP = MAX_REFINEMENT_VALUE_LENGTH;

  /** A guest bike, a finished checkup, and its three lines: front pads, rear pads, chain. */
  function guestWithThreeLines() {
    return guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      checkup: (build) => wornPadsAndChain(build, CHECKUP_ID),
    });
  }

  /** The same, the rear pads' line holding `refinement` — written by the list page. */
  function holding(refinement: unknown) {
    const guest = guestWithThreeLines();
    // What the visitor did on the two other lines must come through untouched.
    listPageEdit(guest.storage, "local", CHAIN_LINE, (line) => ({
      ...line,
      done: true,
      doneReason: "manual",
      refinement: { "e-rated": "non" },
    }));
    listPageEdit(guest.storage, "local", REAR_PADS, (line) => ({ ...line, refinement }));
    // The PRECONDITION of every case of this block: the storage holds, on that
    // line, exactly what the case says it holds. A helper that wrote what the
    // FIXED page writes — the over-long answer already dropped — left all of
    // them green over a storage with nothing to drop (measured in review).
    expect(
      JSON.stringify(
        storedListLines(guest.storage, "local").find((line) => line.partId === REAR_PADS.partId)
          ?.refinement,
      ),
    ).toBe(JSON.stringify(refinement));
    const raws = new Map(guest.storage.map);
    const { state, checkup } = guest.collect();
    const [list] = state.bikes[0].lists;
    return {
      state,
      checkup,
      list,
      rear: list?.items.find((line) => line.partId === REAR_PADS.partId),
      /** Reading wrote nothing: every key byte for byte. */
      untouched: () => [...raws].every(([key, raw]) => guest.storage.map.get(key) === raw),
    };
  }

  it.each([
    ["exactly at the cap", CAP, true],
    ["one character over it", CAP + 1, false],
    ["a 99-character product title", PRODUCT_TITLE.length, false],
    ["at the contract's old cap", 120, false],
    ["one over that — what blocked the import", 121, false],
    ["a 138-character product address", PRODUCT_URL.length, false],
    ["5 000 characters", 5000, false],
  ])(
    "an answer %s (%i) — sent: %s; the bike, the checkup and all three lines always are",
    (_what, length, sent) => {
      const long = "r".repeat(length);
      const { state, checkup, list, rear, untouched } = holding({
        "pad-thickness": "2",
        "pad-model": long,
      });

      // The payload is one the server takes — whatever the length.
      expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
      expect(checkup).toBe("collected");
      expect(state.bikes[0].checkups).toHaveLength(1);
      expect(list.items.map((line) => line.partId)).toEqual([
        FRONT_PADS.partId,
        REAR_PADS.partId,
        CHAIN_LINE.partId,
      ]);
      // The entry is sent when the list page shows it, and only then…
      expect(rear?.refinement).toEqual(
        sent ? { "pad-thickness": "2", "pad-model": long } : { "pad-thickness": "2" },
      );
      // …and nothing longer than the cap is anywhere in a line of the payload.
      expect(JSON.stringify(list).includes("r".repeat(CAP + 1))).toBe(false);
      // The other lines' work is untouched: the tick, and the chain's own answer.
      expect(list.items.find((line) => line.partId === CHAIN_LINE.partId)).toMatchObject({
        done: true,
        refinement: { "e-rated": "non" },
      });
      expect(untouched()).toBe(true);
    },
  );

  it("sends, for every line, exactly what the list page reads", () => {
    const stored = {
      "pad-thickness": "2",
      "brand-tier": "mid",
      "pad-model": PRODUCT_TITLE,
    };
    const { rear } = holding(stored);
    expect(rear?.refinement).toEqual(refinementOf(stored));
    expect(rear?.refinement).toEqual({ "pad-thickness": "2", "brand-tier": "mid" });
  });

  it("sends no `refinement` at all for a line whose only answer was the long one", () => {
    const { state, rear } = holding({ "pad-model": PRODUCT_URL });
    expect(rear).toBeDefined();
    expect(Object.hasOwn(rear as object, "refinement")).toBe(false);
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it.each([
    ["a number", { "pad-model": 11, "pad-thickness": "2" }],
    ["null", { "pad-model": null, "pad-thickness": "2" }],
    ["an object", { "pad-model": { ref: "J04C" }, "pad-thickness": "2" }],
  ])(
    "an answer that is %s costs that answer — not the list, which used to be imported as NOTHING",
    (_what, refinement) => {
      // The stored-list guard read `refinement` as a record of strings: one
      // entry that was not one failed the parse of the whole stored list, the
      // bike was sent with `lists: []`, and the list's key was then cleared.
      const { list, rear } = holding(refinement);
      expect(list.items).toHaveLength(3);
      expect(rear?.refinement).toEqual({ "pad-thickness": "2" });
    },
  );

  it.each([
    ["a string", "pad-model=J04C"],
    ["an array", ["pad-model", "J04C"]],
    ["null", null],
    // Read by the list page (64 characters at most), refused by the contract
    // (40): nothing is left to send.
    ["nothing but a key the contract does not take", { ["k".repeat(41)]: "11" }],
    // Not an attribute key: no reader takes it, the list page's included.
    ["nothing but a key that is not an attribute key", { Speeds: "11" }],
  ])(
    "a refinement that is %s costs that line's refinement, never the line or the list",
    (_what, refinement) => {
      const { state, list, rear } = holding(refinement);
      expect(list.items).toHaveLength(3);
      expect(Object.hasOwn(rear as object, "refinement")).toBe(false);
      expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
    },
  );

  it("drops what the CONTRACT would refuse too — a key it does not take, a U+0000 — so no entry can sink the payload", () => {
    const NUL = String.fromCharCode(0);
    const { state, rear } = holding({
      // A key the list page reads (64 characters at most) and the contract
      // does not (40)…
      ["k".repeat(41)]: "x",
      // …and two that are not attribute keys: no reader takes those.
      Speeds: "11",
      __proto__x: "x",
      // The one character PostgreSQL stores in no column.
      "pad-model": `J04C${NUL}`,
      "pad-thickness": "2",
    });
    expect(rear?.refinement).toEqual({ "pad-thickness": "2" });
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it("never sends an answer under `constructor` or `prototype` — the account's action would refuse every later edit of that line", () => {
    // The contract's key was the catalogue's SHAPE alone, which both names
    // pass; the saved bike's action refuses both by name. A line imported
    // with one was handed to the list page with it, and the page sends back
    // the whole refinement it was given: "Modification non enregistrée" for
    // every answer on that line from then on (measured in review, on
    // PostgreSQL). `JSON.parse`, so the names are OWN keys, as storage has them.
    const stored = JSON.parse(
      '{"constructor":"x","prototype":"y","__proto__":"z","pad-thickness":"2","brand-tier":"mid"}',
    ) as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual([
      "constructor",
      "prototype",
      "__proto__",
      "pad-thickness",
      "brand-tier",
    ]);
    const { state, list, rear, untouched } = holding(stored);

    expect(list.items).toHaveLength(3);
    expect(Object.keys(rear?.refinement ?? {})).toEqual(["pad-thickness", "brand-tier"]);
    // Every key the payload carries is one the account's action takes…
    for (const line of list.items) {
      expect(Object.keys(line.refinement ?? {}).every(isRefinementKey), line.partId).toBe(true);
    }
    // …and the payload is one the server takes.
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
    expect(untouched()).toBe(true);
  });

  it("sends at most the contract's number of answers for one line", () => {
    const many = Object.fromEntries(
      Array.from({ length: GUEST_CAPS.refinementEntries + 6 }, (_, index) => [
        `attr-${String(index).padStart(2, "0")}`,
        "x",
      ]),
    );
    const { state, rear } = holding(many);
    expect(Object.keys(rear?.refinement ?? {})).toEqual(
      Object.keys(many).slice(0, GUEST_CAPS.refinementEntries),
    );
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it("is not stopped by how deeply a stored refinement is nested", () => {
    // Storage is untrusted: 20 000 levels under one entry. The reader keeps
    // strings only, so nothing here walks that depth.
    const depth = 20_000;
    const deep = `{"pad-thickness":"2","pad-model":${"[".repeat(depth)}${"]".repeat(depth)}}`;
    const guest = guestWithThreeLines();
    const stored = JSON.parse(guest.storage.map.get(buildListKey("local")) as string) as {
      items: { partId: string }[];
    };
    const raw = JSON.stringify(stored).replace(
      `"partId":"${REAR_PADS.partId}"`,
      `"partId":"${REAR_PADS.partId}","refinement":${deep}`,
    );
    expect(raw).not.toBe(JSON.stringify(stored));
    guest.storage.map.set(buildListKey("local"), raw);

    const [list] = guest.collect().state.bikes[0].lists;
    expect(list.items).toHaveLength(3);
    expect(list.items.find((line) => line.partId === REAR_PADS.partId)?.refinement).toEqual({
      "pad-thickness": "2",
    });
  });
});

// ── the collector, and a list line's chosen product ──────────────────────────

describe("collectGuestState — a list line's chosen product is collected as the list page reads it", () => {
  /**
   * The same flaw as the refinement's, one field down the same guard, found
   * in review of that fix (2026-10-13) and measured there. The collector's
   * guard on the stored list typed `chosenProduct` as an object of five
   * strings: a stored product that was not one — `null`, a string, a field
   * missing — failed the parse of the WHOLE stored list. The list page, which
   * reads a product leniently (`chosenProductOf`: the product is dropped, the
   * line kept), went on showing every line; the import carried none of them;
   * and the list's key was then cleared with the bike's. And a product the
   * guard let through but the contract refuses — a link §4.4 forbids, a field
   * longer than its column — was a payload refused whole, on every retry.
   *
   * No control of the site writes a guest's `chosenProduct` today: these are
   * values DevTools made, or a later release. The storage below is the
   * wizard's, the product put on the front pads' line by the list page's own
   * write.
   */
  const CHOSEN = {
    brand: "Shimano",
    model: "J04C",
    size: "paire",
    vendor: "alltricks",
    url: "https://www.alltricks.fr/C-40598-toutes-les-plaquettes",
  };

  function holdingProduct(chosenProduct: unknown) {
    const guest = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      checkup: (build) => wornPadsAndChain(build, CHECKUP_ID),
    });
    // What the visitor did on the two other lines must come through untouched.
    listPageEdit(guest.storage, "local", CHAIN_LINE, (line) => ({
      ...line,
      done: true,
      doneReason: "manual",
    }));
    listPageEdit(guest.storage, "local", REAR_PADS, (line) => ({
      ...line,
      refinement: { "pad-thickness": "2" },
    }));
    listPageEdit(guest.storage, "local", FRONT_PADS, (line) => ({ ...line, chosenProduct }));
    // The precondition: the storage holds, on that line, what the case says.
    expect(
      JSON.stringify(
        storedListLines(guest.storage, "local").find((line) => line.partId === FRONT_PADS.partId)
          ?.chosenProduct,
      ),
    ).toBe(JSON.stringify(chosenProduct));
    const raws = new Map(guest.storage.map);
    const collection = guest.collect();
    const [list] = collection.state.bikes[0].lists;
    return {
      collection,
      state: collection.state,
      list,
      front: list?.items.find((line) => line.partId === FRONT_PADS.partId),
      untouched: () => [...raws].every(([key, raw]) => guest.storage.map.get(key) === raw),
    };
  }

  it("sends a product the list page shows, as stored (the control)", () => {
    const { state, list, front } = holdingProduct(CHOSEN);
    expect(list.items).toHaveLength(3);
    expect(front?.chosenProduct).toEqual(CHOSEN);
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it("sends a product as the list page READS it — its five fields, and not a sixth the contract would refuse", () => {
    // The page's reader goes first, and it is not redundant with the
    // contract: it keeps the five fields of a product and leaves the rest,
    // where the contract — a strict object — would refuse the product for
    // one field more. Read by the contract alone, this product would be
    // dropped although the list page shows it.
    const { state, front } = holdingProduct({ ...CHOSEN, note: "vu en boutique", price: 24.9 });
    expect(front?.chosenProduct).toEqual(CHOSEN);
    expect(Object.keys(front?.chosenProduct ?? {}).sort()).toEqual(Object.keys(CHOSEN).sort());
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "Shimano J04C"],
    ["an array", ["Shimano", "J04C"]],
    ["a number", 7],
    ["not five strings — a field missing", { brand: "Shimano" }],
    ["not five strings — a number where one is due", { ...CHOSEN, size: 2 }],
    [
      "a link that is not on its vendor's site (§4.4)",
      { ...CHOSEN, url: "https://evil.example/x" },
    ],
    ["a link that is not https", { ...CHOSEN, url: "http://www.alltricks.fr/C-40598" }],
    ["a vendor this site does not know", { ...CHOSEN, vendor: "amazon" }],
    ["a model longer than its column", { ...CHOSEN, model: "m".repeat(121) }],
    ["a U+0000 in its model", { ...CHOSEN, model: `J04C${String.fromCharCode(0)}` }],
  ])(
    "a stored product that is %s costs that PRODUCT — not the line, not the list, not the import",
    (_what, stored) => {
      const { collection, state, list, front, untouched } = holdingProduct(stored);

      // Every line is sent — the one that held the product included, without it.
      expect(list?.items.map((line) => line.partId)).toEqual([
        FRONT_PADS.partId,
        REAR_PADS.partId,
        CHAIN_LINE.partId,
      ]);
      expect(front).toBeDefined();
      expect(Object.hasOwn(front as object, "chosenProduct")).toBe(false);
      // The other lines' work is untouched.
      expect(list.items.find((line) => line.partId === REAR_PADS.partId)?.refinement).toEqual({
        "pad-thickness": "2",
      });
      expect(list.items.find((line) => line.partId === CHAIN_LINE.partId)?.done).toBe(true);
      // The payload is one the server takes…
      expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
      // …so when the browser then forgets the list's key, the account has the list.
      const settled = settleGuestImport(collection, {
        bikeId: "00000000-0000-4000-8000-000000000001",
        bikes: [
          {
            localId: state.bikes[0].localId,
            bikeId: "00000000-0000-4000-8000-000000000001",
            checkups: [{ guestKey: CHECKUP_ID, status: "imported" }],
          },
        ],
        imported: 1,
        skipped: 0,
      });
      expect(settled.clear).toContain(buildListKey("local"));
      expect(state.bikes[0].lists[0].items).toHaveLength(3);
      // Reading wrote nothing.
      expect(untouched()).toBe(true);
    },
  );
});

// ── the collector, and the REST of a line ────────────────────────────────────

describe("collectGuestState — every line the wizard can derive is a line the contract takes", () => {
  /**
   * The collector holds a line's `refinement` and `chosenProduct` to the
   * contract and forwards the rest of the line — `partId`, `action`,
   * `reasonKey`, `guideSlug`, `sortOrder`: the checkup's own output — as it
   * is stored. One of those the contract refuses is still a payload refused
   * whole (`docs/backlog.md`), so "the application only ever writes what the
   * contract takes" has to be held against everything the application can
   * write there: the FULL plan of each of the seven presets, every question
   * answered "ça ne marche pas" with no symptom picked — which lands every
   * consequence of every step (§5.4) — stored by the wizard's own writers,
   * collected, and handed to the contract.
   *
   * `BuildList.long-answer.test.tsx` holds the same derivations against the
   * list PAGE's parser; this is the import's side, which that file cannot
   * speak for (cited as if it did until the review of 2026-10-13).
   */
  it.each(Object.keys(BIKE_PRESETS) as PresetId[])(
    "%s: a full checkup with everything broken is collected whole, and accepted",
    (preset) => {
      const everythingBroken = guestWork({
        answers: BIKE_PRESETS[preset],
        checkup: (build) =>
          guestRun({
            id: CHECKUP_ID,
            build,
            scope: { kind: "full" },
            verdicts: Object.fromEntries(
              planFromDisk(build, { kind: "full" }).map((step) => [step.key, "ko" as const]),
            ),
            startedAt: STARTED_AT,
            completedAt: COMPLETED_AT,
          }),
      });
      if (everythingBroken.checkup === null) throw new Error("no checkup was stored");
      const derived = deriveBuildList(everythingBroken.checkup);
      expect(derived.length).toBeGreaterThan(20);
      // The contract's cap on a list's lines is not what decides here.
      expect(derived.length).toBeLessThanOrEqual(GUEST_CAPS.itemsPerList);

      const { state, checkup } = everythingBroken.collect();
      expect(checkup).toBe("collected");
      // Every derived line is in the payload, in order…
      expect(state.bikes[0].lists[0]?.items.map((line) => `${line.action} ${line.partId}`)).toEqual(
        derived.map((line) => `${line.action} ${line.partId}`),
      );
      // …and the contract takes the payload: no line of it, no field of a line.
      const verdict = parseGuestState(JSON.parse(JSON.stringify(state)));
      expect(verdict.ok ? [] : verdict.issues.map((issue) => issue.path.join("."))).toEqual([]);
    },
  );
});

// ── the contract ─────────────────────────────────────────────────────────────

describe("GuestStateSchema", () => {
  it("accepts everything the collector can produce", () => {
    expect(parseGuestState(payload()).ok).toBe(true);
  });

  it("refuses a key the contract does not name (mass assignment)", () => {
    for (const extra of ["id", "userId", "spec", "createdAt", "specVersion"]) {
      const tampered = payload() as unknown as { bikes: Record<string, unknown>[] };
      tampered.bikes[0][extra] = "x";
      expect(parseGuestState(tampered).ok, extra).toBe(false);
    }
  });

  it("refuses an extra key at every level of a checkup", () => {
    const breakers: ((checkup: Record<string, unknown>) => void)[] = [
      (checkup) => (checkup.bikeId = "x"),
      (checkup) => (checkup.status = "COMPLETED"),
      (checkup) => (checkup.steps = []),
      (checkup) => (checkup.items = []),
      (checkup) => ((checkup.scope as Record<string, unknown>).userId = "x"),
      (checkup) => (checkup.scope = { kind: "full", partIds: ["chain"] }),
    ];
    for (const [index, tamper] of breakers.entries()) {
      const tampered = payload();
      tamper(tampered.bikes[0].checkups[0] as unknown as Record<string, unknown>);
      expect(parseGuestState(tampered).ok, `breaker ${index}`).toBe(false);
    }
  });

  it("refuses a version it was not written for — version 1 included", () => {
    expect(GUEST_STATE_VERSION).toBe(2);
    expect(parseGuestState({ version: 3, bikes: [] }).ok).toBe(false);
    expect(parseGuestState({ bikes: [] }).ok).toBe(false);
    expect(parseGuestState(null).ok).toBe(false);
    expect(parseGuestState("{}").ok).toBe(false);
    // What a tab loaded before 2026-10-07 sends: version 1, and — because its
    // collector read no real checkup — `checkups: []`, which is otherwise a
    // perfectly valid bike. Accepting it would import the bike and let that
    // old tab clear the checkup it never sent.
    expect(parseGuestState({ ...payload(), version: 1 }).ok).toBe(false);
    const old = payload();
    old.bikes[0].checkups = [];
    expect(parseGuestState({ ...old, version: 1 }).ok).toBe(false);
    expect(parseGuestState(old).ok).toBe(true);
  });

  it("refuses the old shape of a checkup, whatever version it claims", () => {
    const old = payload() as unknown as { bikes: { checkups: unknown[] }[] };
    old.bikes[0].checkups = [
      {
        guestKey: CHECKUP_ID,
        scope: "parts",
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        items: [{ stepKey: CHAIN, partId: "chain", guideSlug: "check-drivetrain", result: "ko" }],
      },
    ];
    expect(parseGuestState(old).ok).toBe(false);
  });

  it("refuses an answer to a question this site never asked", () => {
    const tampered = payload();
    (tampered.bikes[0].answers as Record<string, string>)["not-a-question"] = "x";
    expect(parseGuestState(tampered).ok).toBe(false);
  });

  it("refuses a step key, a part id or a reason key that is not an id", () => {
    const bad = ["../../etc/passwd", "check/../x#y", "Check-Drivetrain#chain-wear", "no-hash"];
    for (const key of bad) {
      for (const record of ["answers", "symptoms", "notes"] as const) {
        const tampered = payload();
        const value = record === "answers" ? "ok" : record === "symptoms" ? [] : "x";
        (tampered.bikes[0].checkups[0][record] as Record<string, unknown>)[key] = value;
        expect(parseGuestState(tampered).ok, `${record}: ${key}`).toBe(false);
      }
    }
    for (const reason of ["<script>", "Chain-Elongation", "a/../b"]) {
      const tampered = payload();
      tampered.bikes[0].checkups[0].symptoms[CHAIN] = [reason];
      expect(parseGuestState(tampered).ok, reason).toBe(false);
    }
    for (const partId of ["../chain", "Chain", ""]) {
      const tampered = payload();
      tampered.bikes[0].checkups[0].scope = { kind: "parts", partIds: [partId] };
      expect(parseGuestState(tampered).ok, partId).toBe(false);
    }
  });

  it("holds every id to the database's length", () => {
    const accepts = (mutate: (state: GuestState) => void): boolean => {
      const tampered = payload();
      mutate(tampered);
      return parseGuestState(tampered).ok;
    };
    // `CheckupItem.stepKey` is VarChar(160): 95 + "#" + 64.
    const longest = `${"a".repeat(95)}#${"b".repeat(64)}`;
    expect(longest).toHaveLength(160);
    expect(accepts((s) => (s.bikes[0].checkups[0].answers[longest] = "ok"))).toBe(true);
    expect(accepts((s) => (s.bikes[0].checkups[0].answers[`a${longest}`] = "ok"))).toBe(false);
    expect(accepts((s) => (s.bikes[0].checkups[0].answers[`${longest}b`] = "ok"))).toBe(false);
    // `CheckupItem.reasonKeys` is VarChar(80)[].
    expect(accepts((s) => (s.bikes[0].checkups[0].symptoms[CHAIN] = ["r".repeat(80)]))).toBe(true);
    expect(accepts((s) => (s.bikes[0].checkups[0].symptoms[CHAIN] = ["r".repeat(81)]))).toBe(false);
    // `BikePartState.partId` is VarChar(64).
    const scope = (partId: string) => (s: GuestState) =>
      (s.bikes[0].checkups[0].scope = { kind: "parts", partIds: [partId] });
    expect(accepts(scope("p".repeat(64)))).toBe(true);
    expect(accepts(scope("p".repeat(65)))).toBe(false);
    // `CheckupItem.notes` is VarChar(2000).
    expect(MAX_NOTE_LENGTH).toBe(2000);
    expect(accepts((s) => (s.bikes[0].checkups[0].notes[CHAIN] = "n".repeat(2000)))).toBe(true);
    expect(accepts((s) => (s.bikes[0].checkups[0].notes[CHAIN] = "n".repeat(2001)))).toBe(false);
  });

  it("refuses a date that is not ISO 8601 with an offset — on a checkup's two ends and on the bike", () => {
    const accepts = (mutate: (state: GuestState) => void): boolean => {
      const tampered = payload();
      mutate(tampered);
      return parseGuestState(tampered).ok;
    };
    const fields: Record<string, (value: unknown) => (state: GuestState) => void> = {
      startedAt: (value) => (s) => (s.bikes[0].checkups[0].startedAt = value as string),
      completedAt: (value) => (s) => (s.bikes[0].checkups[0].completedAt = value as string),
      updatedAt: (value) => (s) => (s.bikes[0].updatedAt = value as string),
    };
    const refused = [
      "bientôt",
      "2026-09-14",
      "2026-09-14T08:00:00.000", // no offset: whose midnight?
      "2026-13-45T99:99:99Z",
      "",
      1_726_300_800_000,
      null,
      // ISO 8601, and a year PostgreSQL does not have.
      "0000-01-01T00:00:00.000Z",
      "0000-12-31T23:59:59.999Z",
      // Year 1 as written, year 0 as an instant.
      "0001-01-01T00:00:00.000+14:00",
    ];
    for (const [field, set] of Object.entries(fields)) {
      for (const value of refused) {
        expect(accepts(set(value)), `${field}: ${String(value)}`).toBe(false);
      }
      // The first instant the database stores; a clock that was reset; an
      // offset; and a clock a century ahead, which is `clamp()`'s to bring back.
      for (const value of [
        "0001-01-01T00:00:00.000Z",
        "1970-01-01T00:00:00.000Z",
        "2026-09-14T10:00:00.000+02:00",
        "2126-01-01T00:00:00.000Z",
      ]) {
        expect(accepts(set(value)), `${field}: ${value}`).toBe(true);
      }
    }
    // `completedAt` may be absent — and only absent, never another kind of empty.
    expect(accepts((s) => delete s.bikes[0].checkups[0].completedAt)).toBe(true);
  });

  // ── the strings no pattern matches ─────────────────────────────────────────

  const TYPED_PRODUCT = {
    brand: "Shimano",
    model: "CN-HG601",
    size: "11v",
    vendor: "other",
    url: "https://example.com/chaine",
  };
  /** The payload with a refinement and a product on its one line, then `mutate`d. */
  const acceptsTyped = (mutate: (state: GuestState) => void): boolean => {
    const tampered = payload();
    Object.assign(tampered.bikes[0].lists[0].items[0], {
      refinement: { speeds: "11" },
      chosenProduct: { ...TYPED_PRODUCT },
    });
    mutate(tampered);
    return parseGuestState(tampered).ok;
  };
  const typedLine = (s: GuestState) => s.bikes[0].lists[0].items[0];
  /**
   * Every place of the payload where a string is free text — held by `text()`
   * or by the walk over the two untyped values, keys included — and how to put
   * `poison` there.
   */
  const FREE_STRINGS: Record<string, (state: GuestState, poison: string) => void> = {
    "the bike's name": (s, poison) => (s.bikes[0].name = `Mon${poison}vélo`),
    "a note": (s, poison) => (s.bikes[0].checkups[0].notes[CHAIN] = `usure${poison}`),
    "the list's name": (s, poison) => (s.bikes[0].lists[0].name = `Ma${poison}liste`),
    "a refinement value": (s, poison) => (typedLine(s).refinement = { speeds: `11${poison}` }),
    "the product's brand": (s, poison) =>
      (typedLine(s).chosenProduct = { ...TYPED_PRODUCT, brand: `Shi${poison}mano` }),
    "the product's model": (s, poison) =>
      (typedLine(s).chosenProduct = { ...TYPED_PRODUCT, model: `CN${poison}HG601` }),
    "the product's size": (s, poison) =>
      (typedLine(s).chosenProduct = { ...TYPED_PRODUCT, size: `11${poison}v` }),
    "the product's link": (s, poison) =>
      (typedLine(s).chosenProduct = {
        ...TYPED_PRODUCT,
        url: `https://example.com/cha${poison}ine`,
      }),
    "a value inside a part": (s, poison) =>
      (s.bikes[0].parts = [{ partId: "brake-pads-front", attributes: { "pad-model": poison } }]),
    "a key inside a part": (s, poison) => (s.bikes[0].parts = [{ [`part${poison}Id`]: "chain" }]),
    "a value nested in the fit": (s, poison) => (s.bikes[0].fit = { a: [[{ b: `x${poison}` }]] }),
    "a key of the fit": (s, poison) => (s.bikes[0].fit = { [`saddle${poison}`]: 742 }),
  };

  it("refuses U+0000 in every string — the one character PostgreSQL stores in no column", () => {
    const NUL = String.fromCharCode(0);
    expect(Object.keys(FREE_STRINGS)).toHaveLength(12);
    for (const [name, poison] of Object.entries(FREE_STRINGS)) {
      expect(
        acceptsTyped((s) => poison(s, NUL)),
        name,
      ).toBe(false);
      // The control: the same edit with an ordinary character in the same
      // place is accepted, so it is the character that is refused.
      expect(
        acceptsTyped((s) => poison(s, "-")),
        `${name} (control)`,
      ).toBe(true);
    }
    // Other control characters are stored like any text: a note keeps its line breaks.
    expect(acceptsTyped((s) => (s.bikes[0].checkups[0].notes[CHAIN] = "ligne 1\nligne 2\t."))).toBe(
      true,
    );
    expect(acceptsTyped((s) => (s.bikes[0].fit = null))).toBe(true);
  });

  it("refuses a lone surrogate in every string — half an emoji, which jsonb refuses and text does not keep", () => {
    // Found in review on 2026-10-09: a refinement value, a chosen product's
    // field or a part's free-text attribute holding half a pair passed every
    // wall and aborted the transaction (`invalid input syntax for type json`).
    // A `text` column ends up holding U+FFFD in its place — the driver's
    // encoding of the half, written before PostgreSQL sees anything; not what
    // was sent — so the rule is the same in every string.
    const halves = {
      "the first half alone": HIGH,
      "the second half alone": LOW,
      "the two halves the wrong way round": LOW + HIGH,
      "a half before a whole emoji": HIGH + EMOJI,
      "a half after a whole emoji": EMOJI + LOW,
    };
    for (const [name, poison] of Object.entries(FREE_STRINGS)) {
      for (const [which, half] of Object.entries(halves)) {
        expect(
          acceptsTyped((s) => poison(s, half)),
          `${name}: ${which}`,
        ).toBe(false);
      }
      // The control: a WHOLE emoji in the same place is a character like any
      // other. What is refused is the half, not the emoji and not the field.
      expect(
        acceptsTyped((s) => poison(s, EMOJI)),
        `${name} (a whole emoji)`,
      ).toBe(true);
      expect(
        acceptsTyped((s) => poison(s, EMOJI + EMOJI)),
        `${name} (two whole emoji)`,
      ).toBe(true);
    }
    // The character the collector puts in a half's place is an ordinary one.
    expect(acceptsTyped((s) => FREE_STRINGS["a note"](s, REPLACEMENT))).toBe(true);
  });

  it("is not stopped by how deeply an untyped value is nested", () => {
    // `parts` and `fit` are walked for an unstorable string with a stack of
    // their own, not the call stack: a value nested a few thousand levels is
    // still a value.
    const nest = (leaf: string): unknown => {
      let nested: unknown = leaf;
      for (let depth = 0; depth < 5000; depth += 1) nested = [nested];
      return nested;
    };
    const deep = payload();
    deep.bikes[0].fit = nest("leaf");
    expect(parseGuestState(deep).ok).toBe(true);
    deep.bikes[0].fit = nest(String.fromCharCode(0));
    expect(parseGuestState(deep).ok).toBe(false);
    deep.bikes[0].fit = nest(HIGH);
    expect(parseGuestState(deep).ok).toBe(false);
    deep.bikes[0].fit = nest(EMOJI);
    expect(parseGuestState(deep).ok).toBe(true);
  });

  it("caps a line's refinement — a record like the checkup's three, and written to a JSON column", () => {
    const accepts = (refinement: Record<string, string>): boolean => {
      const tampered = payload();
      tampered.bikes[0].lists[0].items[0].refinement = refinement;
      return parseGuestState(tampered).ok;
    };
    // Every value at the cap on ONE answer: `MAX_REFINEMENT_VALUE_LENGTH`, the
    // list page's, the saved bike's action's and its loader's. It was 120
    // here until 2026-10-13, and the entries below were 120 characters long.
    const entries = (count: number, value = "v") =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `k-${String(index).padStart(38, "0")}`,
          value.repeat(MAX_REFINEMENT_VALUE_LENGTH),
        ]),
      );
    const cap = GUEST_CAPS.refinementEntries;
    expect(cap).toBe(24);
    expect(accepts(entries(cap))).toBe(true);
    expect(accepts(entries(cap + 1))).toBe(false);
    // 1 400 entries were accepted until 2026-10-09: 154 KB in one column at
    // this length, 232 KB at the 120 characters a value could then have.
    // Counted, not estimated — this comment said "123 KB" for the first.
    expect(guestStateBytes(entries(1400))).toBe(154_001);
    expect(
      guestStateBytes(
        Object.fromEntries(Object.keys(entries(1400)).map((key) => [key, "v".repeat(120)])),
      ),
    ).toBe(232_401);
    expect(withinGuestPayloadBudget(entries(1400))).toBe(true);
    expect(accepts(entries(1400))).toBe(false);
    // The heaviest refinement the contract allows — 40-character keys, a full
    // value of three-byte characters — is inside the 32 KB of a JSON column.
    const heaviest = entries(cap, "€");
    expect(accepts(heaviest)).toBe(true);
    expect(withinJsonBudget(heaviest)).toBe(true);
    // The two per-entry bounds it rests on.
    expect(accepts({ ["k".repeat(41)]: "v" })).toBe(false);
    expect(accepts({ k: "v".repeat(MAX_REFINEMENT_VALUE_LENGTH) })).toBe(true);
    expect(accepts({ k: "v".repeat(MAX_REFINEMENT_VALUE_LENGTH + 1) })).toBe(false);
  });

  it("holds a refinement key to the one definition of a key, and to 40 characters", () => {
    const accepts = (refinement: Record<string, string>): boolean => {
      const tampered = payload();
      tampered.bikes[0].lists[0].items[0].refinement = refinement;
      return parseGuestState(tampered).ok;
    };
    const own = (json: string) => JSON.parse(json) as Record<string, string>;

    expect(accepts({ "pad-model": "J04C", "brand-tier": "mid", speeds: "11" })).toBe(true);
    expect(accepts({ ["k".repeat(40)]: "v" })).toBe(true);
    expect(accepts({ ["k".repeat(41)]: "v" })).toBe(false);
    for (const key of ["Speeds", "pad_model", "pad model", "speeds.nested", ""]) {
      expect(accepts({ [key]: "v" }), JSON.stringify(key)).toBe(false);
      expect(isRefinementKey(key), JSON.stringify(key)).toBe(false);
    }
    // The two names the shape lets through, refused by name — as the saved
    // bike's action always refused them. Until 2026-10-13 both were accepted
    // here, and the line they were imported on could never be edited again.
    for (const name of ["constructor", "prototype"]) {
      const refinement = own(`{"${name}":"v","speeds":"11"}`);
      expect(Object.hasOwn(refinement, name)).toBe(true);
      expect(accepts(refinement), name).toBe(false);
      expect(isRefinementKey(name), name).toBe(false);
    }
    // A key that merely contains one of them is an attribute key like another.
    expect(accepts({ "constructor-type": "v" })).toBe(true);
  });

  it("holds one refinement answer to the cap the list page reads by — nothing it would hide can be imported", () => {
    // 65 to 120 characters used to be ACCEPTED: the row held the answer, the
    // list's loader dropped it, and the line's next edit replaced the column.
    // Over 120 was always refused. One number now, and it is the reader's.
    const accepts = (value: string): boolean => {
      const tampered = payload();
      tampered.bikes[0].lists[0].items[0].refinement = { "pad-model": value, speeds: "11" };
      return parseGuestState(tampered).ok;
    };
    expect(MAX_REFINEMENT_VALUE_LENGTH).toBe(64);
    for (const [length, accepted] of [
      [MAX_REFINEMENT_VALUE_LENGTH, true],
      [MAX_REFINEMENT_VALUE_LENGTH + 1, false],
      [PRODUCT_TITLE.length, false],
      [120, false],
      [121, false],
      [PRODUCT_URL.length, false],
    ] as const) {
      const value = "r".repeat(length);
      expect(accepts(value), String(length)).toBe(accepted);
      // What the contract takes is exactly what the list page would show.
      expect(refinementOf({ "pad-model": value }) !== undefined, String(length)).toBe(accepted);
    }
  });

  it("accepts exactly the domain's five actions on a line", () => {
    // The VALUES come from the zod-free vocabulary (`data/conventions.ts`), not
    // from `schema/procedure.ts`, which is classic zod and must stay out of the
    // chunk `/import` loads. Same array, by reference: they cannot drift.
    const accepts = (action: string): boolean => {
      const tampered = payload() as unknown as {
        bikes: { lists: { items: { action: string }[] }[] }[];
      };
      tampered.bikes[0].lists[0].items[0].action = action;
      return parseGuestState(tampered).ok;
    };
    expect([...KO_ACTIONS]).toEqual(["replace", "fix", "clean", "adjust", "inspect-shop"]);
    for (const action of KO_ACTIONS) expect(accepts(action), action).toBe(true);
    for (const action of ["REPLACE", "buy", "", "inspect_shop"]) {
      expect(accepts(action), action).toBe(false);
    }
  });

  it("refuses a verdict that is not one of the three", () => {
    const tampered = payload() as unknown as {
      bikes: { checkups: { answers: Record<string, string> }[] }[];
    };
    tampered.bikes[0].checkups[0].answers[CHAIN] = "BROKEN";
    expect(parseGuestState(tampered).ok).toBe(false);
  });

  it("refuses a chosen product whose link is not plain https", () => {
    const product = { brand: "Shimano", model: "CN-HG601", size: "11v", vendor: "alltricks" };
    for (const url of [
      "javascript:alert(1)",
      "http://alltricks.fr/x",
      "data:text/html,x",
      "https://user:pass@alltricks.fr/x",
      "not a url",
    ]) {
      const tampered = payload();
      tampered.bikes[0].lists[0].items[0].chosenProduct = { ...product, url };
      expect(parseGuestState(tampered).ok, url).toBe(false);
    }

    const good = payload();
    good.bikes[0].lists[0].items[0].chosenProduct = {
      ...product,
      url: "https://www.alltricks.fr/chaine",
    };
    expect(parseGuestState(good).ok).toBe(true);
  });

  it("refuses more than the caps §4.4 names", () => {
    const one = collected.bikes[0];
    const version = GUEST_STATE_VERSION;
    expect(parseGuestState({ version, bikes: Array(GUEST_CAPS.bikes).fill(one) }).ok).toBe(true);
    expect(parseGuestState({ version, bikes: Array(GUEST_CAPS.bikes + 1).fill(one) }).ok).toBe(
      false,
    );

    const over = (patch: Partial<typeof one>) =>
      parseGuestState({ version, bikes: [{ ...one, ...patch }] }).ok;
    expect(over({ parts: Array(GUEST_CAPS.partsPerBike + 1).fill({}) })).toBe(false);
    expect(over({ checkups: Array(GUEST_CAPS.checkupsPerBike).fill(one.checkups[0]) })).toBe(true);
    expect(over({ checkups: Array(GUEST_CAPS.checkupsPerBike + 1).fill(one.checkups[0]) })).toBe(
      false,
    );
    expect(over({ lists: Array(GUEST_CAPS.listsPerBike + 1).fill(one.lists[0]) })).toBe(false);
  });

  it("caps every record and every array of a checkup, not only the arrays", () => {
    const [checkup] = collected.bikes[0].checkups;
    const accepts = (patch: Partial<typeof checkup>) =>
      parseGuestState({
        version: GUEST_STATE_VERSION,
        bikes: [{ ...collected.bikes[0], checkups: [{ ...checkup, ...patch }] }],
      }).ok;
    const keyed = <T>(count: number, value: T): Record<string, T> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`check-drivetrain#step-${index}`, value]),
      );
    const cap = GUEST_CAPS.answersPerCheckup;
    expect(cap).toBe(250);

    expect(accepts({ answers: keyed(cap, "ok" as const) })).toBe(true);
    expect(accepts({ answers: keyed(cap + 1, "ok" as const) })).toBe(false);
    expect(accepts({ symptoms: keyed(cap, ["chain-elongation"]) })).toBe(true);
    expect(accepts({ symptoms: keyed(cap + 1, ["chain-elongation"]) })).toBe(false);
    expect(accepts({ notes: keyed(cap, "x") })).toBe(true);
    expect(accepts({ notes: keyed(cap + 1, "x") })).toBe(false);

    // Symptoms per step: the wizard's own bound.
    expect(GUEST_CAPS.symptomsPerStep).toBe(MAX_SYMPTOMS);
    const reasons = (count: number) => Array.from({ length: count }, (_, i) => `reason-${i}`);
    expect(accepts({ symptoms: { [CHAIN]: reasons(GUEST_CAPS.symptomsPerStep) } })).toBe(true);
    expect(accepts({ symptoms: { [CHAIN]: reasons(GUEST_CAPS.symptomsPerStep + 1) } })).toBe(false);

    // The parts a partial checkup names: no more than a build can hold.
    const parts = (count: number) => ({
      kind: "parts" as const,
      partIds: Array.from({ length: count }, (_, i) => `part-${i}`),
    });
    expect(accepts({ scope: parts(GUEST_CAPS.scopeParts) })).toBe(true);
    expect(accepts({ scope: parts(GUEST_CAPS.scopeParts + 1) })).toBe(false);
  });

  it("is answered by the byte budget when a checkup is filled to every cap at once", () => {
    // Every cap at once, with the longest ids and notes the patterns allow, is
    // far over 256 KB — so the byte budget, not a walk of the payload, is what
    // answers an import built to be as large as the schema permits.
    const key = (index: number) =>
      `${"a".repeat(90)}-${String(index).padStart(4, "0")}#${"b".repeat(64)}`;
    const notes = Object.fromEntries(
      Array.from({ length: GUEST_CAPS.answersPerCheckup }, (_, i) => [key(i), "n".repeat(2000)]),
    );
    const huge = payload();
    huge.bikes[0].checkups[0].notes = notes;
    expect(parseGuestState(huge).ok).toBe(true);
    expect(withinGuestPayloadBudget(huge)).toBe(false);
  });
});

// ── size ─────────────────────────────────────────────────────────────────────

describe("the payload budget", () => {
  it("is 256 KB, counted in UTF-8 bytes", () => {
    expect(MAX_GUEST_PAYLOAD_BYTES).toBe(256 * 1024);
    expect(guestStateBytes({ a: "🚲" })).toBeGreaterThan(guestStateBytes({ a: "b" }));
    expect(withinGuestPayloadBudget(collected)).toBe(true);
    expect(withinGuestPayloadBudget({ a: "x".repeat(MAX_GUEST_PAYLOAD_BYTES) })).toBe(false);
  });

  it("leaves a real guest bike, checkup and list far inside it", () => {
    expect(guestStateBytes(collected)).toBeLessThan(MAX_GUEST_PAYLOAD_BYTES / 4);
  });

  it("never throws: a value JSON cannot encode has no size, and is within no budget", () => {
    // The measure is the first thing the action does with its input, and
    // `JSON.stringify` throws on a BigInt — which a server action can be sent.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      BigInt(10),
      { version: GUEST_STATE_VERSION, bikes: [BigInt(10)] },
      cyclic,
    ]) {
      expect(guestStateBytes(value)).toBe(Number.POSITIVE_INFINITY);
      expect(withinGuestPayloadBudget(value)).toBe(false);
      // Whatever the budget: there is no size to compare.
      expect(withinGuestPayloadBudget(value, Number.MAX_SAFE_INTEGER)).toBe(false);
    }
    // `undefined` encodes to nothing at all, which is no bytes — as before.
    expect(guestStateBytes(undefined)).toBe(0);
  });
});

// ── after the server answered ────────────────────────────────────────────────

describe("settleGuestImport", () => {
  const LOCAL = checkupKey("local");
  const BIKE_AND_LIST = [LOCAL_BIKE_KEY, buildListKey("local")];

  function summary(entry: Partial<GuestBikeImport> = {}): GuestImportSummary {
    const bike: GuestBikeImport = {
      localId: work.bike.id,
      bikeId: "00000000-0000-4000-8000-0000000000b1",
      checkups: [{ guestKey: CHECKUP_ID, status: "imported" }],
      ...entry,
    };
    return {
      bikeId: bike.bikeId,
      bikes: [bike],
      imported: bike.skipped === undefined ? 1 : 0,
      skipped: bike.skipped === undefined ? 0 : 1,
    };
  }

  it("lets the browser forget all three keys once the server imported the checkup", () => {
    expect(settleGuestImport(collection, summary())).toEqual({
      checkup: { status: "imported" },
      clear: [...BIKE_AND_LIST, LOCAL],
    });
  });

  it("treats a checkup the account already held like one it has just imported", () => {
    const settled = settleGuestImport(
      collection,
      summary({
        skipped: "already-imported",
        checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
      }),
    );
    expect(settled.checkup).toEqual({ status: "already-imported" });
    expect(settled.clear).toContain(LOCAL);
  });

  it("KEEPS the checkup key when the server wrote no row for it, and says why", () => {
    for (const reason of ["nothing-kept", "bike-already-imported", "other-bike"] as const) {
      const settled = settleGuestImport(
        collection,
        summary({ checkups: [{ guestKey: CHECKUP_ID, status: "skipped", reason }] }),
      );
      expect(settled.checkup).toEqual({ status: "skipped", reason });
      // The bike and the list are in the account; the checkup is not.
      expect(settled.clear).toEqual(BIKE_AND_LIST);
    }
  });

  it("KEEPS a checkup the browser could not read, whatever the server said", () => {
    const unreadable = collect(storageWithCheckup("{not json"));
    const settled = settleGuestImport(unreadable, summary({ checkups: [] }));
    expect(settled.checkup).toEqual({ status: "skipped", reason: "unreadable" });
    expect(settled.clear).toEqual(BIKE_AND_LIST);
  });

  it("KEEPS a checkup the answer does not name: nothing proves it is in the account", () => {
    const other = "00000000-0000-4000-8000-0000000000c9";
    for (const checkups of [[], [{ guestKey: other, status: "imported" as const }]]) {
      const settled = settleGuestImport(collection, summary({ checkups }));
      expect(settled.checkup).toEqual({ status: "skipped", reason: "unconfirmed" });
      expect(settled.clear).toEqual(BIKE_AND_LIST);
    }
  });

  it("clears a checkup nobody answered — there was provably nothing to import", () => {
    const empty = collect(
      storageWithCheckup(
        JSON.stringify({ ...toStored(work.checkup!), answers: {}, symptoms: {}, notes: {} }),
      ),
    );
    expect(settleGuestImport(empty, summary({ checkups: [] }))).toEqual({
      checkup: { status: "none" },
      clear: [...BIKE_AND_LIST, LOCAL],
    });
  });

  it("does not name a key that was absent when it was read", () => {
    // Nothing was there; a checkup another tab wrote since is not this
    // import's to remove.
    const absent = collect(storageWithCheckup(null));
    expect(settleGuestImport(absent, summary({ checkups: [] }))).toEqual({
      checkup: { status: "none" },
      clear: BIKE_AND_LIST,
    });
  });

  it("clears nothing at all when the answer does not name this browser's bike", () => {
    const elsewhere = summary({ localId: "99999999-2222-4333-8444-555555555555" });
    expect(settleGuestImport(collection, elsewhere).clear).toEqual([]);
    expect(
      settleGuestImport(collect(memoryStorage()), {
        bikeId: null,
        bikes: [],
        imported: 0,
        skipped: 0,
      }).clear,
    ).toEqual([]);
  });
});

// ── clearing ─────────────────────────────────────────────────────────────────

describe("clearGuestKeys", () => {
  const everything = () =>
    memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: CHECKUP_RAW,
      [buildListKey("local")]: LIST_RAW,
      [checkupKey("demo")]: "{}",
      "va:bike3d:quality": "high",
    });

  it("forgets exactly the keys it is given", () => {
    const storage = everything();
    clearGuestKeys([LOCAL_BIKE_KEY, buildListKey("local")], storage);
    expect([...storage.map.keys()].sort()).toEqual(
      ["va:bike3d:quality", checkupKey("demo"), checkupKey("local")].sort(),
    );
    // The checkup it was not told to forget is byte for byte what it was.
    expect(storage.map.get(checkupKey("local"))).toBe(CHECKUP_RAW);
  });

  it("forgets the local bike, its checkup and its list when all three are named", () => {
    const storage = everything();
    clearGuestKeys(guestImportKeys(), storage);
    expect([...storage.map.keys()].sort()).toEqual(["va:bike3d:quality", checkupKey("demo")]);
  });

  it("ignores a key that is not the guest import's to clear", () => {
    const storage = everything();
    clearGuestKeys([checkupKey("demo"), "va:bike3d:quality", "anything"], storage);
    expect(storage.map.size).toBe(5);
  });

  it("does nothing where storage cannot be reached, and swallows a storage that throws", () => {
    expect(() => clearGuestKeys(guestImportKeys(), null)).not.toThrow();
    expect(() =>
      clearGuestKeys(guestImportKeys(), {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
