/**
 * The guest-import payload (§4.4): what `/import` reads out of THIS browser and
 * hands to `importGuestStateAction` — and what the browser may forget once the
 * server has answered.
 *
 * ## Why a payload and not "the storage keys, forwarded"
 *
 * `localStorage` holds three different shapes, each owned by a different module
 * — `va:bike:local` (`lib/bike/local-bike.ts`), `va:checkup:local`
 * (`lib/checkup/storage.ts`, W3-T1) and `va:buildlist:local` (W3-T2) — and each
 * of them keeps things the database has no column for (a locale, the tools the
 * visitor said they lack, a content version). Forwarding them verbatim would
 * make the server action's schema a copy of three other modules' internals,
 * drifting the day any of them gains a field.
 *
 * So the browser PROJECTS what it has onto one small contract owned here, and
 * the server validates only that. {@link collectGuestState} is the projection,
 * {@link GuestStateSchema} is the contract, and the two live in the same file
 * precisely so they cannot disagree.
 *
 * ## A checkup travels as ANSWERS, never as steps
 *
 * What the wizard stores is `toStored(state)` — the verdicts, the symptoms and
 * the notes, keyed by step key, with no plan and no cursor
 * (`lib/checkup/storage.ts`). The payload carries exactly that, plus the scope:
 * no step, no part id per item, no guide slug. The server recomputes the plan
 * from the bike it derives and keeps the answers whose key is in it (§5.4), the
 * way it does for a saved bike's checkup. A visitor who edits storage — or a
 * script — can therefore not invent a question, a part or a guide.
 *
 * Until 2026-10-07 this file read the key with a private schema that still
 * REQUIRED the `steps` the wizard stopped writing in W3: a checkup the wizard
 * had stored could not parse, the import went through without it, and the
 * browser's copy was then cleared (`.debug/017` §5.6). Hence the three rules
 * below.
 *
 *   1. **One definition of the stored shape.** The key is read through
 *      `peekStoredCheckup`, i.e. `StoredCheckupSchema` — the wizard's own.
 *   2. **Reading never removes.** A checkup this build cannot read is one it
 *      did not import; {@link collectGuestState} says so (`unreadable`) and
 *      leaves the key where it is.
 *   3. **Clearing follows the server's answer.** {@link settleGuestImport}
 *      names the keys to forget: `va:checkup:local` only when the server
 *      confirmed the checkup is in the account, or when there was provably
 *      nothing to import.
 *
 * ## `zod/mini`, not classic zod
 *
 * This module is imported by the `/import` page, which is a client component
 * (§6.2), so it must not put classic zod in a bundle (§1.2) — nor the generated
 * step-key and reason-key enums, which is why ids are matched by PATTERN here
 * and by the re-planned plan on the server. `z.strictObject` refuses unknown
 * keys exactly like `.strict()` does on the server — verified against the
 * installed zod 4.5.4, see `schema.test.ts`.
 *
 * ## Caps
 *
 * §4.4 names four: 10 bikes, 80 parts, 20 checkups, 10 lists — plus 256 KB for
 * the whole payload. The others ({@link GUEST_CAPS}) are not new policy: they
 * are what the corpus, the wizard's own guard and `QUOTAS.itemsPerList` already
 * allow, stated on every array and on each of a checkup's three RECORDS — a
 * `maxLength` says nothing about a map — so that a refusal is a `VALIDATION`
 * and not a 256 KB payload walked entry by entry.
 *
 * The payload is an ARRAY of bikes even though exactly one local bike can exist
 * (§1.2): forward-compatibility is cheaper to keep than to add.
 */
import * as z from "zod/mini";

import { readLocalBike, type KeyValueStorage } from "@/lib/bike/local-bike";
import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { QUOTAS } from "@/lib/bike/rules";
import { MAX_NOTE_LENGTH, MAX_SYMPTOMS } from "@/lib/checkup/reducer";
import { answeredCount, peekStoredCheckup } from "@/lib/checkup/storage";
import { CHECKUP_ANSWERS, type CheckupAnswer } from "@/lib/checkup/types";
import { QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import { KO_ACTIONS, type KoAction } from "@/lib/domain/schema/procedure";
import { MAX_BUILD_PARTS } from "@/lib/domain/engine/validate-build";
import { isAllowedProductUrl, isPlainHttpsUrl } from "@/lib/shop/chosen-product";

/**
 * Bumped only when a shape change makes an older payload unreadable.
 *
 * **2** (2026-10-07): a checkup is its answers, no longer a list of items the
 * browser had already resolved to a part and a guide. The bump is not
 * bookkeeping. The collector of before that date read no real checkup at all,
 * sent `checkups: []` — a payload both shapes accept — and then cleared
 * `va:checkup:local`. Refusing version 1 outright is what makes a payload from
 * it a `VALIDATION` that writes nothing and keeps every key, until a reload
 * brings the collector that can read the checkup. (Whether a tab loaded before
 * a deploy can still reach the new action was not observed; this is the wall
 * for the case where it can.)
 */
export const GUEST_STATE_VERSION = 2;

/**
 * Everything one import may carry. `partsPerBike` is `MAX_BUILD_PARTS`, so a
 * build the domain would accept is never refused by the envelope instead.
 */
export const GUEST_CAPS = {
  bikes: 10,
  partsPerBike: MAX_BUILD_PARTS,
  checkupsPerBike: 20,
  listsPerBike: 10,
  /**
   * Entries in each of a checkup's three records (answers, symptoms, notes).
   * The whole corpus is 222 check steps today; no single checkup can answer
   * more of them than exist.
   */
  answersPerCheckup: 250,
  /** The wizard's own bound (`MAX_SYMPTOMS`): a step's `ko[]` is the real one. */
  symptomsPerStep: MAX_SYMPTOMS,
  /** A partial checkup cannot name more parts than a build can hold. */
  scopeParts: MAX_BUILD_PARTS,
  itemsPerList: QUOTAS.itemsPerList,
} as const;

/**
 * The action body ceiling for an import. `next.config.ts` allows 512 KB of
 * server-action body — head-room for the framing around this payload, not
 * permission to send more than this.
 */
export const MAX_GUEST_PAYLOAD_BYTES = 256 * 1024;

// ── the contract ─────────────────────────────────────────────────────────────

/** Which questions a guest checkup was about: the whole bike, or the parts the visitor picked. */
export type GuestCheckupScope = { kind: "full" } | { kind: "parts"; partIds: string[] };

/**
 * One guest checkup, as the visitor ANSWERED it — `toStored(state)` minus what
 * the database has no column for.
 *
 * Every record is keyed by step key (`${guideSlug}#${stepId}`). There is no
 * step, no part and no guide in here on purpose: the server re-plans from the
 * bike and the scope, and a key that is not in that plan is simply dropped.
 */
export interface GuestCheckup {
  /** `CheckupState.id`; becomes the user-scoped `Checkup.guestKey`. */
  guestKey: string;
  scope: GuestCheckupScope;
  answers: Record<string, CheckupAnswer>;
  /** The symptoms ticked on a KO: reason keys, per step. */
  symptoms: Record<string, string[]>;
  notes: Record<string, string>;
  /** ISO 8601, clamped to "now" on import (§4.7 clock skew). */
  startedAt: string;
  completedAt?: string;
}

/** What the visitor settled on buying (`BuildListItem.chosenProduct`, §4.2). */
export interface GuestChosenProduct {
  brand: string;
  model: string;
  size: string;
  /** A `RetailerId`, or `"other"` for a link the visitor pasted. */
  vendor: string;
  url: string;
}

/** One line of a guest build list — a `BuildListItem` row. */
export interface GuestBuildListItem {
  partId: string;
  action: KoAction;
  reasonKey: string;
  guideSlug?: string;
  done: boolean;
  sortOrder: number;
  refinement?: Record<string, string>;
  chosenProduct?: GuestChosenProduct;
}

/** One guest build list — a `BuildList` row plus its items. */
export interface GuestBuildList {
  name: string;
  items: GuestBuildListItem[];
}

/** One guest bike and everything hanging off it. */
export interface GuestBike {
  /** `va:bike:local`'s own id; becomes `Bike.guestLocalId` and dedupes re-imports. */
  localId: string;
  /** The guest bike has no name (§1.2): `/import` supplies one in the visitor's locale. */
  name: string;
  answers: Record<string, string>;
  /** The owner's attribute edits; kept only if `validateBuild` accepts them. */
  parts: unknown[];
  /** Remembered measurements; `coerceFit` drops whatever it does not recognise. */
  fit?: unknown;
  /** ISO 8601, clamped to "now" on import. */
  updatedAt: string;
  checkups: GuestCheckup[];
  lists: GuestBuildList[];
}

export interface GuestState {
  version: typeof GUEST_STATE_VERSION;
  bikes: GuestBike[];
}

// ── the answer ───────────────────────────────────────────────────────────────

/**
 * Why the server wrote no row for a checkup the payload carried.
 *
 *   `nothing-kept`           none of its answers is about a question this
 *                            bike's plan asks — there is no row to write;
 *   `bike-already-imported`  the bike was already in the account, so NOTHING
 *                            was written (§6.8 AC8), and the account does not
 *                            hold this checkup.
 */
export type GuestCheckupSkipReason = "nothing-kept" | "bike-already-imported";

/** What became of one checkup of the payload, by its `guestKey`. */
export type GuestCheckupImport =
  /** Written now, or (`already-imported`) found in the account under its user-scoped key. */
  | { guestKey: string; status: "imported" | "already-imported" }
  | { guestKey: string; status: "skipped"; reason: GuestCheckupSkipReason };

export interface GuestBikeImport {
  /** `va:bike:local`'s id — what the browser knows this bike as. */
  localId: string;
  /** The row's uuid, whether it was created now or by an earlier import. */
  bikeId: string;
  /** Present when the bike was already in the account: nothing was written. */
  skipped?: "already-imported";
  /** One entry per distinct checkup the payload carried for this bike. */
  checkups: GuestCheckupImport[];
}

export interface GuestImportSummary {
  /** Where `/import` sends the visitor — the first bike of the payload. */
  bikeId: string | null;
  bikes: GuestBikeImport[];
  imported: number;
  skipped: number;
}

// ── schemas ──────────────────────────────────────────────────────────────────

/**
 * Ids are matched by pattern, never against a catalogue, and this is the
 * `path-traversal` control (§4.7): a slug reaches a content lookup only after
 * it has been proven to be `[a-z0-9-]`, so `../` can never get that far.
 *
 * Lengths are the database's (`VarChar(64)` for a part, `VarChar(160)` for a
 * slug, `VarChar(80)` for a reason key), so a payload Postgres would refuse is
 * refused here first, as a `VALIDATION` rather than a 500.
 */
const PartIdPattern = z.string().check(z.regex(/^[a-z0-9-]{1,64}$/));
const GuideSlugPattern = z.string().check(z.regex(/^[a-z0-9-]{1,160}$/));
const ReasonKeyPattern = z.string().check(z.regex(/^[a-z0-9-]{1,80}$/));
/**
 * `${guideSlug}#${stepId}`: 95 + 1 + 64, so `VarChar(160)` in total — and a
 * superset of what the wizard's own guard lets into storage (64 + 1 + 64), so
 * a key the browser can hold is never a key the contract refuses.
 */
const StepKeyPattern = z.string().check(z.regex(/^[a-z0-9-]{1,95}#[a-z0-9-]{1,64}$/));
const IsoDate = z.iso.datetime({ offset: true });
/** `CheckupItem.notes` / `BikePartState.notes` are `VarChar(2000)`. */
const Notes = z.string().check(z.maxLength(MAX_NOTE_LENGTH));
const Name = z.string().check(z.minLength(1), z.maxLength(80));

/**
 * The decision tree's answers, as `createBikeAction` accepts them: a partial map
 * from a KNOWN question id to an option id. An answer to a question this site
 * never asked is refused rather than dropped — it is a payload somebody wrote
 * by hand.
 */
const AnswersSchema = z.partialRecord(
  z.enum(QUESTION_IDS),
  z.string().check(z.regex(/^[a-z0-9-]{1,32}$/)),
);

/*
 * §4.4: the link must be https AND on the named retailer's own hosts, unless
 * the visitor pasted their own (`vendor: 'other'`); any other vendor is refused.
 * The rule is `lib/shop/chosen-product.ts`'s, the one every READER of a stored
 * product applies too, so the way in and the way out cannot disagree. The host
 * set is derived from `RETAILERS` itself (`retailerHosts`), so adding a
 * retailer or changing a template moves this guard with it.
 */
const ChosenProductSchema = z
  .strictObject({
    brand: z.string().check(z.maxLength(80)),
    model: z.string().check(z.maxLength(120)),
    size: z.string().check(z.maxLength(40)),
    vendor: z.string().check(z.regex(/^[a-z0-9-]{1,40}$/)),
    url: z.string().check(z.maxLength(1000), z.refine(isPlainHttpsUrl)),
  })
  .check(z.refine(isAllowedProductUrl));

/** A record with at most `max` entries: a cap on an array says nothing about a map. */
function maxEntries<T extends Record<string, unknown>>(max: number) {
  return z.refine<T>((record) => Object.keys(record).length <= max);
}

const CheckupScopeSchema = z.union([
  z.strictObject({ kind: z.literal("full") }),
  z.strictObject({
    kind: z.literal("parts"),
    partIds: z.array(PartIdPattern).check(z.maxLength(GUEST_CAPS.scopeParts)),
  }),
]);

/*
 * No `items`, no `partId`, no `guideSlug`: those are the server's to compute
 * from the plan (§5.4). What is left is three maps keyed by step key, and a
 * step key is matched by pattern only — whether it NAMES a question of this
 * bike is decided by the re-planned plan, which is the only thing that can.
 */
const CheckupSchema = z.strictObject({
  guestKey: z.uuid(),
  scope: CheckupScopeSchema,
  answers: z
    .record(StepKeyPattern, z.enum(CHECKUP_ANSWERS))
    .check(maxEntries(GUEST_CAPS.answersPerCheckup)),
  symptoms: z
    .record(
      StepKeyPattern,
      z.array(ReasonKeyPattern).check(z.maxLength(GUEST_CAPS.symptomsPerStep)),
    )
    .check(maxEntries(GUEST_CAPS.answersPerCheckup)),
  notes: z.record(StepKeyPattern, Notes).check(maxEntries(GUEST_CAPS.answersPerCheckup)),
  startedAt: IsoDate,
  completedAt: z.optional(IsoDate),
});

const BuildListItemSchema = z.strictObject({
  partId: PartIdPattern,
  action: z.enum(KO_ACTIONS),
  reasonKey: ReasonKeyPattern,
  guideSlug: z.optional(GuideSlugPattern),
  done: z.boolean(),
  sortOrder: z.int().check(z.gte(0), z.lte(10_000)),
  refinement: z.optional(
    z.record(z.string().check(z.regex(/^[a-z0-9-]{1,40}$/)), z.string().check(z.maxLength(120))),
  ),
  chosenProduct: z.optional(ChosenProductSchema),
});

const BuildListSchema = z.strictObject({
  name: Name,
  items: z.array(BuildListItemSchema).check(z.maxLength(GUEST_CAPS.itemsPerList)),
});

const BikeSchema = z.strictObject({
  localId: z.uuid(),
  name: Name,
  answers: AnswersSchema,
  parts: z.array(z.unknown()).check(z.maxLength(GUEST_CAPS.partsPerBike)),
  fit: z.optional(z.nullable(z.unknown())),
  updatedAt: IsoDate,
  checkups: z.array(CheckupSchema).check(z.maxLength(GUEST_CAPS.checkupsPerBike)),
  lists: z.array(BuildListSchema).check(z.maxLength(GUEST_CAPS.listsPerBike)),
});

/** The one schema `importGuestStateAction` parses its input with. */
export const GuestStateSchema = z.strictObject({
  version: z.literal(GUEST_STATE_VERSION),
  bikes: z.array(BikeSchema).check(z.maxLength(GUEST_CAPS.bikes)),
});

export type ParseGuestStateResult =
  | { ok: true; state: GuestState }
  | { ok: false; issues: readonly { path: readonly PropertyKey[]; message: string }[] };

/**
 * Parse an untrusted payload. Never throws: an import is a form submission like
 * any other, and a failure is a `VALIDATION` the page can render.
 */
export function parseGuestState(input: unknown): ParseGuestStateResult {
  const parsed = GuestStateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, state: parsed.data as GuestState };
}

// ── size ─────────────────────────────────────────────────────────────────────

/** UTF-8 bytes of the JSON encoding — `TextEncoder`, not `Buffer` (this runs in a browser too). */
export function guestStateBytes(state: unknown): number {
  return new TextEncoder().encode(JSON.stringify(state) ?? "").length;
}

export function withinGuestPayloadBudget(state: unknown, max = MAX_GUEST_PAYLOAD_BYTES): boolean {
  return guestStateBytes(state) <= max;
}

/** Nothing to import — `/import` sends the visitor to `/mes-velos` instead (§6.2). */
export function isEmptyGuestState(state: GuestState): boolean {
  return state.bikes.length === 0;
}

// ── reading this browser ─────────────────────────────────────────────────────

/**
 * What a stored build list has to have.
 *
 * The ITEM shape is pinned — `BuildListItem` in `lib/checkup/types.ts` is the
 * W3 contract — and so now is the envelope: `writeGuestBuildList`
 * (`lib/checkup/storage.ts`, W3-T1) is the only writer of `va:buildlist:<ref>`
 * and it writes `{ version, updatedAt, items }`. This was a union of two
 * plausible shapes while that producer was being written on a sibling branch;
 * narrowed at the W3 integration to the one that exists. `z.object` rather than
 * `strictObject`, so `version` and `updatedAt` are dropped rather than refused
 * — the database keeps neither.
 */
const StoredBuildListItemSchema = z.object({
  partId: z.string(),
  action: z.enum(KO_ACTIONS),
  reasonKey: z.string(),
  guideSlug: z.optional(z.string()),
  done: z.optional(z.boolean()),
  sortOrder: z.optional(z.number()),
  refinement: z.optional(z.record(z.string(), z.string())),
  chosenProduct: z.optional(
    z.object({
      brand: z.string(),
      model: z.string(),
      size: z.string(),
      vendor: z.string(),
      url: z.string(),
    }),
  ),
});

const StoredBuildListSchema = z.object({
  name: z.optional(z.string()),
  items: z.array(StoredBuildListItemSchema),
});

/** `window.localStorage`, or `null` where it cannot be reached (Safari private mode). */
function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: KeyValueStorage, key: string): unknown {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * What {@link collectGuestState} found under `va:checkup:local`.
 *
 *   `absent`      no value — nothing to import, and nothing to clear;
 *   `empty`       a wizard the visitor opened and left: no answer at all, so
 *                 nothing to remember, and an empty `Checkup` row would show as
 *                 a history entry. Not sent;
 *   `unreadable`  a value this build cannot read, or cannot fit into the
 *                 contract. Not sent, and NOT removed;
 *   `collected`   in the payload, as the bike's one checkup.
 */
export type GuestCheckupRead = "absent" | "empty" | "unreadable" | "collected";

/** The checkup stored for the guest bike, projected onto {@link GuestCheckup}. */
function collectCheckup(
  storage: KeyValueStorage,
): { read: Exclude<GuestCheckupRead, "collected"> } | { read: "collected"; checkup: GuestCheckup } {
  // The wizard's own schema, and a read that removes nothing (see the header).
  const peek = peekStoredCheckup("local", storage);
  if (peek.status !== "stored") return { read: peek.status };
  const stored = peek.stored;
  if (answeredCount(stored) === 0) return { read: "empty" };

  const checkup: GuestCheckup = {
    guestKey: stored.id,
    scope:
      stored.scope.kind === "full"
        ? { kind: "full" }
        : { kind: "parts", partIds: [...stored.scope.partIds] },
    answers: { ...stored.answers },
    symptoms: Object.fromEntries(
      Object.entries(stored.symptoms).map(([key, reasons]) => [key, [...reasons]]),
    ),
    notes: { ...stored.notes },
    startedAt: stored.startedAt,
    ...(stored.completedAt === undefined ? {} : { completedAt: stored.completedAt }),
  };
  // The contract and the storage guard are two schemas, and the server refuses
  // a payload WHOLE: a checkup it would not accept must not take the bike down
  // with it, import after import. It is reported unreadable instead — kept in
  // the browser, and said to the visitor.
  if (!CheckupSchema.safeParse(checkup).success) return { read: "unreadable" };
  return { read: "collected", checkup };
}

/** The build list stored for the guest bike, projected onto {@link GuestBuildList}. */
function collectBuildLists(storage: KeyValueStorage, listName: string): GuestBuildList[] {
  const parsed = StoredBuildListSchema.safeParse(readJson(storage, buildListKey("local")));
  if (!parsed.success) return [];
  const stored = parsed.data;
  const rawItems = stored.items;
  const name = stored.name ?? listName;
  if (rawItems.length === 0) return [];

  const items: GuestBuildListItem[] = rawItems
    .slice(0, GUEST_CAPS.itemsPerList)
    .map((item, index) => ({
      partId: item.partId,
      action: item.action,
      reasonKey: item.reasonKey,
      ...(item.guideSlug === undefined ? {} : { guideSlug: item.guideSlug }),
      done: item.done ?? false,
      sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
      ...(item.refinement === undefined ? {} : { refinement: item.refinement }),
      ...(item.chosenProduct === undefined ? {} : { chosenProduct: item.chosenProduct }),
    }));

  return [{ name: name.trim().slice(0, 80) || listName, items }];
}

export interface CollectGuestStateOptions {
  /** `window.localStorage` by default; a fake in tests. */
  storage?: KeyValueStorage | null;
  /** `Bike.name` for the imported bike — the guest bike has none (§1.2). */
  bikeName: string;
  /** `BuildList.name` for a stored list that carries none. */
  listName: string;
}

/** What this browser offers: the payload, and what was found on the way to it. */
export interface GuestCollection {
  /** The payload `importGuestStateAction` takes. */
  state: GuestState;
  /**
   * What `va:checkup:local` held. `absent` when there is no guest bike at all:
   * nothing is imported then, so nothing is asked of the key.
   */
  checkup: GuestCheckupRead;
}

/**
 * Everything this browser holds for a guest, as one payload.
 *
 * Only the `local` keys are read. `va:checkup:demo` and `va:buildlist:demo`
 * belong to the demo bike, which is a read-only preset every visitor shares
 * (§1.2) — there is no row to attach them to, and clearing them would throw
 * away work the visitor can still see on `/velo/demo`.
 *
 * Reading the checkup removes nothing, whatever it finds.
 */
export function collectGuestState({
  storage = defaultStorage(),
  bikeName,
  listName,
}: CollectGuestStateOptions): GuestCollection {
  const empty: GuestCollection = {
    state: { version: GUEST_STATE_VERSION, bikes: [] },
    checkup: "absent",
  };
  if (storage === null) return empty;

  const bike = readLocalBike(storage);
  if (bike === null) return empty;

  const collected = collectCheckup(storage);
  return {
    state: {
      version: GUEST_STATE_VERSION,
      bikes: [
        {
          localId: bike.id,
          name: bikeName,
          answers: bike.answers as Record<string, string>,
          parts: bike.parts,
          fit: bike.fit,
          updatedAt: bike.updatedAt,
          checkups: collected.read === "collected" ? [collected.checkup] : [],
          lists: collectBuildLists(storage, listName),
        },
      ],
    },
    checkup: collected.read,
  };
}

// ── after the server answered ────────────────────────────────────────────────

/**
 * What became of this browser's checkup, as the visitor has to be told it.
 *
 * `unreadable` is the browser's own finding; `unconfirmed` is an answer that
 * does not name the checkup at all — nothing proves it is in the account, so it
 * is treated as not imported. The other reasons are the server's.
 */
export type GuestCheckupOutcome =
  /** There was nothing to import. */
  | { status: "none" }
  /** In the account: written by this import, or already there. */
  | { status: "imported" | "already-imported" }
  | { status: "skipped"; reason: GuestCheckupSkipReason | "unreadable" | "unconfirmed" };

export interface GuestImportSettlement {
  checkup: GuestCheckupOutcome;
  /** The storage keys this browser may now forget — and no other. */
  clear: string[];
}

function checkupOutcome(collection: GuestCollection, entry: GuestBikeImport): GuestCheckupOutcome {
  if (collection.checkup === "unreadable") return { status: "skipped", reason: "unreadable" };
  if (collection.checkup !== "collected") return { status: "none" };

  const guestKey = collection.state.bikes[0]?.checkups[0]?.guestKey;
  const report = entry.checkups.find((candidate) => candidate.guestKey === guestKey);
  if (report === undefined) return { status: "skipped", reason: "unconfirmed" };
  return report.status === "skipped"
    ? { status: "skipped", reason: report.reason }
    : { status: report.status };
}

/**
 * Which keys a SUCCESSFUL import lets this browser forget.
 *
 *   the bike and the list   once the bike is in the account — imported now or
 *                           already there. A browser that keeps a bike its
 *                           account holds would offer the import for ever;
 *   the checkup             ONLY when the server confirmed it is in the account
 *                           (`imported`, `already-imported`), or when there was
 *                           provably nothing to import (`empty`). Never when it
 *                           could not be read, and never when the server kept
 *                           nothing of it: this function is the reason an
 *                           import can no longer delete a checkup it skipped.
 *
 * `absent` clears nothing either — there is nothing there, and a key written by
 * another tab since the read is not this import's to remove.
 *
 * A REFUSED import never reaches this function: the caller keeps every key.
 */
export function settleGuestImport(
  collection: GuestCollection,
  summary: GuestImportSummary,
): GuestImportSettlement {
  const [bike] = collection.state.bikes;
  const entry =
    bike === undefined
      ? undefined
      : summary.bikes.find((candidate) => candidate.localId === bike.localId);
  // The answer does not name this browser's bike: its copy is the only one.
  if (entry === undefined) return { checkup: { status: "none" }, clear: [] };

  const checkup = checkupOutcome(collection, entry);
  const inAccount = checkup.status === "imported" || checkup.status === "already-imported";
  return {
    checkup,
    clear: [
      LOCAL_BIKE_KEY,
      buildListKey("local"),
      ...(inAccount || collection.checkup === "empty" ? [checkupKey("local")] : []),
    ],
  };
}

/** Every key {@link collectGuestState} reads — the only ones an import may ever clear. */
export function guestImportKeys(): string[] {
  return [LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")];
}

/**
 * Forget `keys` — the ones {@link settleGuestImport} named.
 *
 * There is deliberately no "clear everything" here any more: that is what
 * deleted the checkups the importer had skipped. A key that is not one of
 * {@link guestImportKeys} is ignored, so a caller's mistake cannot reach the
 * demo bike's work or a UI preference.
 */
export function clearGuestKeys(
  keys: readonly string[],
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  const allowed = new Set(guestImportKeys());
  for (const key of keys) {
    if (!allowed.has(key)) continue;
    try {
      storage.removeItem(key);
    } catch {
      // Storage that cannot be written cannot hold a stale bike either.
    }
  }
}
