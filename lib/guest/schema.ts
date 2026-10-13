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
 * That sentence was false until 2026-10-09: `KO_ACTIONS` was imported as a
 * VALUE from `lib/domain/schema/procedure.ts`, which is classic zod, and the
 * chunk `/import` loads carried a copy of it — 43 classic zod class names in a
 * 43 054-byte chunk, against none in 26 186 bytes once the value came from
 * `data/conventions.ts` (both builds measured). Nothing noticed: ESLint's
 * client-bundle block does not list this folder, and the bundle budget
 * measures first-load JS while this module is a dynamic import — the build
 * with classic zod in it ended in "Bundle budget respected".
 * `tests/unit/guest/module-graph.test.ts` now walks the runtime import graph
 * from this file and fails on classic zod, on a generated enum, and on
 * anything server-side.
 *
 * ## Caps
 *
 * §4.4 names four: 10 bikes, 80 parts, 20 checkups, 10 lists — plus 256 KB for
 * the whole payload. The others ({@link GUEST_CAPS}) are not new policy: they
 * are what the corpus, the wizard's own guard and `QUOTAS.itemsPerList` already
 * allow, stated on every array and on every RECORD — a checkup's three, and a
 * list line's `refinement` — because a `maxLength` says nothing about a map,
 * and so that a refusal is a `VALIDATION` rather than rows nobody bounded.
 *
 * What a cap bounds is what is WRITTEN, not how much of a payload is read:
 * zod runs a check on a value it has already parsed, so an array or a record
 * over its cap has had every entry walked by the time it is refused. The
 * 256 KB wall is what bounds the walk, which is why the action measures the
 * payload before it calls the parser. Removing the byte budget because "the
 * caps cover it" would remove the only bound there is.
 *
 * ## What PostgreSQL is known not to store is refused here
 *
 * A refusal further down is a transaction that throws, i.e. a 500 and a page
 * left on its spinner, so the contract refuses first. What it refuses is a
 * LIST — each entry measured on PostgreSQL 16, none deduced — and not a proof
 * that the list is complete (it was one entry short until 2026-10-09, under a
 * heading that said otherwise):
 *
 *   - a string longer than its column — lengths are the columns' own;
 *   - **U+0000, in every string**: `text` rejects it with 22021 and `jsonb`
 *     with 22P05 — a note, a name, a part's free-text attribute;
 *   - **a lone surrogate, in every string** — half of a pair, which is what
 *     cutting a text in the middle of an emoji leaves. `jsonb` refuses it
 *     (`invalid input syntax for type json`: a refinement value, a chosen
 *     product's field, a part's free-text attribute — the half travels there
 *     as a JSON escape, and PostgreSQL refuses the escape). A `text` column
 *     never receives it: UTF-8 has no encoding for half a pair, and
 *     node-postgres writes U+FFFD (the bytes EF BF BD) in its place BEFORE
 *     PostgreSQL sees anything. PostgreSQL stores what it was sent, so the
 *     row no longer says what the payload said — and the account could then
 *     never be found to hold that copy ({@link storable}). Given the
 *     surrogate's own bytes (ED A0 BD) PostgreSQL does not store them either:
 *     22021, `invalid byte sequence for encoding "UTF8"`;
 *   - a date before year 1: zod's `iso.datetime` accepts year 0000, Postgres
 *     answers 22008.
 *
 * `tests/integration/guest-import.test.ts` sends each of them past this
 * contract to the real database, and through it.
 *
 * The COLLECTOR does not hand over a lone surrogate in the first place: it
 * replaces each with U+FFFD ({@link wellFormed}), which is the character the
 * driver was found to send for one anyway. So a note or a product name cut in
 * the middle of an emoji is imported, and the refusal above is for a payload
 * that did not come from {@link collectGuestState}.
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
// The VALUE comes from the zod-free vocabulary; `schema/procedure.ts` is
// classic zod and may only be imported for its types here (see the header).
import { KO_ACTIONS } from "@/lib/domain/data/conventions";
import { QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import { MAX_BUILD_PARTS } from "@/lib/domain/engine/validate-build";
import type { KoAction } from "@/lib/domain/schema/procedure";
import { chosenProductOf, isAllowedProductUrl, isPlainHttpsUrl } from "@/lib/shop/chosen-product";
import { isRefinementKey, MAX_REFINEMENT_VALUE_LENGTH, refinementOf } from "@/lib/shop/refinement";

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
   * A checkup asks the steps of CHECK guides only (`planCheckup`), and the
   * corpus has 64 of those today, in 13 guides — counted on 2026-10-09 in the
   * generated `GUIDE_STEP_KEYS`, whose 222 entries are the step keys of every
   * guide kind. No single checkup can answer more questions than exist, so
   * the cap is roomy, not tight: do not size anything from the 222.
   */
  answersPerCheckup: 250,
  /** The wizard's own bound (`MAX_SYMPTOMS`): a step's `ko[]` is the real one. */
  symptomsPerStep: MAX_SYMPTOMS,
  /** A partial checkup cannot name more parts than a build can hold. */
  scopeParts: MAX_BUILD_PARTS,
  itemsPerList: QUOTAS.itemsPerList,
  /**
   * Answers on one list line's `refinement` — the account's own bound
   * (`MAX_REFINEMENT_KEYS` in `liste/actions.ts`): a part has a handful of
   * attributes. With 40-character keys and values of at most
   * `MAX_REFINEMENT_VALUE_LENGTH` (64) characters that is under 6 KB of JSON
   * at three bytes a character, well inside the 32 KB every JSON column is
   * held to.
   */
  refinementEntries: 24,
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
 *                            bike is asked, whatever the scope — there is no
 *                            row to write;
 *   `bike-already-imported`  the bike was already in the account, so NOTHING
 *                            was written (§6.8 AC8), and the account does not
 *                            hold what this copy of the checkup says: no row
 *                            under its key on that bike, or a row that lacks
 *                            an answer, or the completion, this copy has;
 *   `other-bike`             the bike is new and was imported, but the account
 *                            already holds a checkup under this key on ANOTHER
 *                            bike. The key is unique, so no second row is
 *                            written — and what this copy says is not in the
 *                            account for this bike.
 */
export type GuestCheckupSkipReason = "nothing-kept" | "bike-already-imported" | "other-bike";

/** What became of one checkup of the payload, by its `guestKey`. */
export type GuestCheckupImport =
  /**
   * Written now — or (`already-imported`) already in the account ON THIS BIKE,
   * with every answer this copy carries, and finished if this copy is. Never
   * said of a row that merely shares the key: the browser forgets its checkup
   * on this word (`settleGuestImport`).
   */
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
 * slug, `VarChar(80)` for a reason key). A pattern is also why none of these
 * can hold a U+0000 or half a surrogate pair; the strings that are NOT matched
 * by a pattern are held to that explicitly, below ({@link storable}).
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

/**
 * The first instant PostgreSQL has a year for. zod's `iso.datetime` accepts
 * `0000-01-01T…`; Postgres answers `22008 date/time field value out of range`,
 * the transaction throws and the action is a 500 (measured, 2026-10-09). The
 * bound is on the INSTANT, so an offset cannot walk a year-1 date back into
 * year 0. It is deliberately not "a plausible date": a phone whose clock was
 * reset writes 1970, and that checkup is still the visitor's. The future is
 * `clamp()`'s business, on the server.
 */
const EARLIEST_STORABLE_INSTANT = Date.parse("0001-01-01T00:00:00.000Z");
const IsoDate = z.iso
  .datetime({ offset: true })
  .check(z.refine((value: string) => Date.parse(value) >= EARLIEST_STORABLE_INSTANT));

/**
 * U+0000. PostgreSQL stores it in neither `text` (`22021 invalid byte sequence
 * for encoding "UTF8": 0x00`) nor `jsonb` (`22P05 unsupported Unicode escape
 * sequence`, as a value and as a key), so a payload carrying one passed every
 * wall and then threw in the transaction — measured on 2026-10-09. Built with
 * `fromCharCode` so that this file never contains the character, nor an escape
 * a tool might decode into it.
 */
const NUL = String.fromCharCode(0);

/**
 * A surrogate code unit that is NOT half of a pair — the first half of an
 * emoji with nothing after it, or the second with nothing before. With the `u`
 * flag a well-formed pair is read as one code point, which is not a surrogate,
 * so the class (`Cs`, general category Surrogate) matches the lone ones and
 * only them: `String.prototype.isWellFormed`, for the browsers that do not
 * have it yet. Written as a property escape so that this file holds no
 * surrogate, nor an escape a tool might decode into one.
 *
 * Measured on 2026-10-09 (PostgreSQL 16, Prisma 7.10.0): in a `jsonb` column —
 * a refinement value, a chosen product's field, a part's free-text attribute —
 * the insert is refused (`invalid input syntax for type json`, P2007) and the
 * transaction throws, high half or low half alike. For a `text` column the
 * row ends up holding U+FFFD: the import went through, and the same copy sent
 * again was answered `skipped: 'bike-already-imported'`, because the row's
 * note was no longer the copy's.
 *
 * WHO writes that U+FFFD was measured separately, the same day, with
 * node-postgres 8.23.0 against PostgreSQL 16.15 and its socket recorded: the
 * driver. The bytes it wrote for `a`, the high half, `b` were
 * `61 ef bf bd 62` — the half already replaced — and PostgreSQL stored the
 * five octets it was sent. Handed the surrogate's own bytes (`ED A0 BD`)
 * PostgreSQL refuses them in `text` (22021, invalid byte sequence), and it
 * refuses the escaped half in `jsonb` (22P02). So PostgreSQL never turns a
 * half pair into another character; nothing it is sent through this driver
 * still holds one. The outcome for the visitor, and the rule, are the same.
 */
const LONE_SURROGATE = /\p{Cs}/u;

/** Is `value` a string a row ends up holding as it is — in a `text` column and in a `jsonb` one? */
function storable(value: string): boolean {
  return !value.includes(NUL) && !LONE_SURROGATE.test(value);
}
const storableText = z.refine<string>(storable);

/** A free-text field of at most `max` characters that PostgreSQL will store. */
function text(max: number) {
  return z.string().check(z.maxLength(max), storableText);
}

/**
 * Does any string inside `value` — a key or a value, at any depth — fail
 * {@link storable}? For the two fields this contract does not type (`parts`,
 * `fit`): `validateBuild` accepts a part's free-text attribute by length
 * alone, and the build is written to a `jsonb` column.
 *
 * Iterative on purpose: the nesting of an untrusted value is not a depth to
 * recurse to.
 */
function holdsUnstorable(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === "string") {
      if (!storable(next)) return true;
    } else if (typeof next === "object" && next !== null) {
      for (const [key, child] of Object.entries(next)) {
        if (!storable(key)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}
const nothingUnstorable = z.refine<unknown>((value) => !holdsUnstorable(value));

/** `CheckupItem.notes` / `BikePartState.notes` are `VarChar(2000)`. */
const Notes = text(MAX_NOTE_LENGTH);
const Name = text(80).check(z.minLength(1));

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
    brand: text(80),
    model: text(120),
    size: text(40),
    vendor: z.string().check(z.regex(/^[a-z0-9-]{1,40}$/)),
    url: text(1000).check(z.refine(isPlainHttpsUrl)),
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

/**
 * One answer of a list line's `refinement`, as the contract takes it: an
 * attribute key, and a value of at most the cap EVERY reader of a refinement
 * holds an entry to (`lib/shop/refinement.ts`).
 *
 * The value was `text(120)` until 2026-10-13, against 64 on the list page, in
 * the saved bike's action and in its loader. So a guest's answer of 65 to 120
 * characters was imported into a column whose only reader drops it: stored,
 * shown nowhere, and replaced with the rest of the column by the line's next
 * edit (measured on a copy of `origin/main`; `.debug/017` §5.9). One cap now,
 * and nothing the list page would not show can land in the column — whoever
 * built the payload.
 *
 * The collector never sends such an entry ({@link collectRefinement}), so this
 * refusal is for a payload {@link collectGuestState} did not build: a hand-made
 * one, or — the case worth naming — a tab loaded BEFORE that date, whose
 * collector forwards the stored value as it is. Its 65-to-120-character answer
 * used to pass; it is now a `VALIDATION` that writes nothing and keeps every
 * key, as an answer over 120 always was, until a reload brings the collector
 * that drops the entry. That is `GUEST_STATE_VERSION` 2's reasoning again, and
 * the same caveat: whether a tab loaded before a deploy can still reach the
 * new action was not observed.
 *
 * The KEY is the one definition of a refinement key (`isRefinementKey`, in
 * that module too): the catalogue's id shape and none of the names that mean
 * something to an object — held here to 40 characters, where the account's
 * action takes 64. Until 2026-10-13 this was the pattern alone, `[a-z0-9-]{1,40}`, which
 * `constructor` and `prototype` pass: the account's own action refuses both
 * by name, so a line imported with one could never be edited again — the
 * list's form hands back the whole refinement it was given, and the action
 * answered `VALIDATION` to every edit of that line (measured on PostgreSQL
 * through the real import and the real action, in review). Hand-written
 * storage only: no attribute of the catalogue has such a key.
 *
 * Module-level because the collector holds each stored entry to exactly these
 * two schemas: what it sends is, by construction, what the contract accepts.
 */
const RefinementKey = z.string().check(z.maxLength(40), z.refine(isRefinementKey));
const RefinementValue = text(MAX_REFINEMENT_VALUE_LENGTH);

const BuildListItemSchema = z.strictObject({
  partId: PartIdPattern,
  action: z.enum(KO_ACTIONS),
  reasonKey: ReasonKeyPattern,
  guideSlug: z.optional(GuideSlugPattern),
  done: z.boolean(),
  sortOrder: z.int().check(z.gte(0), z.lte(10_000)),
  // A record, so capped like one: until 2026-10-09 only the 256 KB budget
  // bounded it, and one line could carry 1 400 entries — 230 KB of JSON in a
  // column every other writer holds to 32 KB.
  refinement: z.optional(
    z.record(RefinementKey, RefinementValue).check(maxEntries(GUEST_CAPS.refinementEntries)),
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
  // Untyped here — `validateBuild` and `coerceFit` are their readers — but not
  // unbounded: nothing in them may hold a string the database does not store.
  parts: z.array(z.unknown()).check(z.maxLength(GUEST_CAPS.partsPerBike), nothingUnstorable),
  fit: z.optional(z.nullable(z.unknown().check(nothingUnstorable))),
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

/**
 * UTF-8 bytes of the JSON encoding — `TextEncoder`, not `Buffer` (this runs in
 * a browser too).
 *
 * `Infinity` for a value JSON cannot encode: it has no size, so it is within
 * no budget. `JSON.stringify` THROWS on a `BigInt`, which made this measure —
 * the first thing the action does with its input — an unhandled `TypeError`
 * instead of an answer. The decoder of a server action's arguments does build
 * a `BigInt` for an argument spelled as one (`parseModelString`, read in the
 * installed `react-server-dom-turbopack`; not sent over HTTP here). A value
 * that contains itself throws the same way, and one nested too deeply to walk
 * throws a `RangeError`: the same answer for all three.
 */
export function guestStateBytes(state: unknown): number {
  let json: string | undefined;
  try {
    json = JSON.stringify(state);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  return new TextEncoder().encode(json ?? "").length;
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
  // Whatever is there: `collectRefinement` reads it entry by entry. As a
  // `record` of strings here, one entry that was not a string failed the
  // parse of the whole stored list — the bike was then imported WITHOUT its
  // list, and the list's key cleared.
  refinement: z.optional(z.unknown()),
  // Whatever is there, for the same reason: `collectChosenProduct` reads it.
  // As an object of five strings here, a stored product that was not one —
  // `null`, a string, a field missing — failed the parse of the whole stored
  // list in the same way, while the list page went on showing every line
  // (measured in review of the refinement's fix, 2026-10-13).
  chosenProduct: z.optional(z.unknown()),
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

/** U+FFFD, the replacement character — by its code, like `NUL` above. */
const REPLACEMENT = String.fromCharCode(0xfffd);
/** {@link LONE_SURROGATE}, every one of them. */
const LONE_SURROGATES = /\p{Cs}/gu;

/**
 * `value` with every lone surrogate replaced by U+FFFD — in every string, at
 * any depth, keys included (`String.prototype.toWellFormed`, for the browsers
 * that do not have it yet).
 *
 * Half a surrogate pair is not a character: it is what a cut at a fixed length
 * leaves of an emoji (the wizard caps a note with `slice(0, 2000)`), UTF-8
 * has no encoding for it, so node-postgres sends U+FFFD in its place to a
 * `text` column — the driver, before PostgreSQL sees anything — while a
 * `jsonb` column, which gets the half as a JSON escape, refuses the row. The
 * projection makes the same replacement itself, once, so that what is sent is
 * what will be stored — a note cut that way is imported instead of making its checkup
 * `unreadable`, and a product name cut that way does not make the server
 * refuse the bike. Nothing a person typed is lost by it, and storage is not
 * written to.
 *
 * Recursive, unlike {@link holdsUnstorable}: it is only ever handed what the
 * three storage guards have already given a shape to — a few levels, never an
 * untrusted depth.
 */
function wellFormed<T>(value: T): T {
  if (typeof value === "string") return value.replace(LONE_SURROGATES, REPLACEMENT) as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => wellFormed(entry)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [wellFormed(key), wellFormed(child)]),
    ) as T;
  }
  return value;
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

  // Well-formed BEFORE the contract is asked: a note cut in the middle of an
  // emoji is a note, not a reason to leave the whole checkup behind.
  const checkup: GuestCheckup = wellFormed({
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
  });
  // The contract and the storage guard are two schemas, and the server refuses
  // a payload WHOLE: a checkup it would not accept must not take the bike down
  // with it, import after import. It is reported unreadable instead — kept in
  // the browser, and said to the visitor.
  if (!CheckupSchema.safeParse(checkup).success) return { read: "unreadable" };
  return { read: "collected", checkup };
}

/**
 * A stored line's refinement, as the payload carries it — or `undefined` when
 * nothing of it can be sent.
 *
 * Until 2026-10-13 the stored value was forwarded as it was, and the list
 * form had no limit on what a visitor could type into it. One answer over 120
 * characters — a product URL pasted into "Référence des plaquettes" — made
 * the server refuse the WHOLE payload, on every retry, with every key kept:
 * that guest bike could not be imported at all, and the list page, which
 * could not open such a list either, offered no way to shorten the value
 * (measured on a copy of `origin/main`: `VALIDATION` five times out of five;
 * `.debug/017` §5.9). A line's answer must never cost the bike.
 *
 * Two filters, entry by entry:
 *
 *   1. the list page's own reader ({@link refinementOf}). An answer the page
 *      drops — longer than the cap, not a string, under a key that is not an
 *      attribute key (`constructor` and `prototype` among them) — is not
 *      sent, so the import carries the list the visitor SEES;
 *   2. the contract's own two schemas ({@link RefinementKey},
 *      {@link RefinementValue}) and its cap on entries. Whatever is left that
 *      the server would refuse — a key over its 40 characters, a U+0000 — is
 *      not sent either: nothing in a line's refinement can sink the payload.
 *
 * Lone surrogates are replaced BEFORE the second filter (it would refuse
 * them), as everywhere in the projection: half an emoji is imported as
 * U+FFFD, not dropped. `refinementOf` goes first because {@link wellFormed}
 * recurses, and after it the value is one flat record of strings.
 *
 * The dropped answer is LOST to the account: it is not sent, and the key it
 * was under is cleared with the list once the bike is in. It was shown
 * nowhere before either.
 */
function collectRefinement(stored: unknown): Record<string, string> | undefined {
  const read = wellFormed(refinementOf(stored));
  if (read === undefined) return undefined;
  const entries = Object.entries(read)
    .filter(
      ([key, value]) =>
        RefinementKey.safeParse(key).success && RefinementValue.safeParse(value).success,
    )
    .slice(0, GUEST_CAPS.refinementEntries);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/**
 * A stored line's chosen product, as the payload carries it — or `undefined`
 * when there is none to send.
 *
 * The refinement's rule, for the line's other lenient field: the list page's
 * own reader first ({@link chosenProductOf} — five short strings and a link
 * §4.4 allows, or no product), then the contract's own schema, so that
 * nothing in a line's product can sink the payload either (a U+0000 in a
 * name: the page shows it, PostgreSQL stores it in no column). A product that
 * fails costs the PRODUCT: the line is sent without it, as the page shows the
 * line without it.
 *
 * Until 2026-10-13 a stored product was forwarded when it was five strings —
 * so one whose link the contract refuses was a payload refused whole, on
 * every retry — and failed the guard on the stored list when it was not: the
 * bike was then sent with NO list, and the list's key cleared with the
 * bike's (both measured in review). No control of the site writes a guest's
 * `chosenProduct` today (`docs/backlog.md`, "The §4.4 actions no UI calls"):
 * these are values DevTools made, or a later release will.
 *
 * Lone surrogates are replaced before the contract is asked, as everywhere in
 * the projection: a product name cut in the middle of an emoji is sent with
 * U+FFFD in its place, not dropped.
 */
function collectChosenProduct(stored: unknown): GuestChosenProduct | undefined {
  const read = wellFormed(chosenProductOf(stored));
  if (read === undefined) return undefined;
  return ChosenProductSchema.safeParse(read).success ? { ...read } : undefined;
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
    .map((item, index) => {
      const refinement = collectRefinement(item.refinement);
      const chosenProduct = collectChosenProduct(item.chosenProduct);
      return {
        partId: item.partId,
        action: item.action,
        reasonKey: item.reasonKey,
        ...(item.guideSlug === undefined ? {} : { guideSlug: item.guideSlug }),
        done: item.done ?? false,
        sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
        ...(refinement === undefined ? {} : { refinement }),
        ...(chosenProduct === undefined ? {} : { chosenProduct }),
      };
    });

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
        // Every string of the projection, whichever key it was read from: the
        // bike's free-text attributes and the list's lines are checked by no
        // contract on this side — a line's `refinement` and `chosenProduct`
        // excepted, since 2026-10-13 (`collectRefinement`,
        // `collectChosenProduct`) — and the server refuses a payload WHOLE.
        wellFormed({
          localId: bike.id,
          name: bikeName,
          answers: bike.answers as Record<string, string>,
          parts: bike.parts,
          fit: bike.fit,
          updatedAt: bike.updatedAt,
          checkups: collected.read === "collected" ? [collected.checkup] : [],
          lists: collectBuildLists(storage, listName),
        }),
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
