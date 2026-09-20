/**
 * The guest-import payload (§4.4): what `/import` reads out of THIS browser and
 * hands to `importGuestStateAction`.
 *
 * ## Why a payload and not "the storage keys, forwarded"
 *
 * `localStorage` holds three different shapes, each owned by a different module
 * — `va:bike:local` (`lib/bike/local-bike.ts`), `va:checkup:local`
 * (`lib/checkup/*`, W3-T1) and `va:buildlist:local` (W3-T2) — and each of them
 * keeps things the database has no column for (a plan's steps, a cursor, the
 * tools the visitor said they lack). Forwarding them verbatim would make the
 * server action's schema a copy of three other modules' internals, drifting the
 * day any of them gains a field.
 *
 * So the browser PROJECTS what it has onto one small contract owned here, and
 * the server validates only that. {@link collectGuestState} is the projection,
 * {@link GuestStateSchema} is the contract, and the two live in the same file
 * precisely so they cannot disagree.
 *
 * ## `zod/mini`, not classic zod
 *
 * This module is imported by the `/import` page, which is a client component
 * (§6.2), so it must not put classic zod in a bundle (§1.2). `z.strictObject`
 * refuses unknown keys exactly like `.strict()` does on the server — verified
 * against the installed zod 4.5.4, see `schema.test.ts`.
 *
 * ## Caps
 *
 * §4.4 names four: 10 bikes, 80 parts, 20 checkups, 10 lists — plus 256 KB for
 * the whole payload. The two extra ceilings here ({@link GUEST_CAPS.itemsPerCheckup},
 * `itemsPerList`) are not new policy: they are what the corpus and
 * `QUOTAS.itemsPerList` already allow, stated so that a refusal is a
 * `VALIDATION` with a cap name and not a 256 KB payload walked item by item.
 *
 * The payload is an ARRAY of bikes even though exactly one local bike can exist
 * (§1.2): forward-compatibility is cheaper to keep than to add.
 */
import * as z from "zod/mini";

import { readLocalBike, type KeyValueStorage } from "@/lib/bike/local-bike";
import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { QUOTAS } from "@/lib/bike/rules";
import { CHECKUP_ANSWERS, type CheckupAnswer } from "@/lib/checkup/types";
import { QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import { isRetailerId, isRetailerUrl } from "@/lib/domain/data/retailers";
import { KO_ACTIONS, type KoAction } from "@/lib/domain/schema/procedure";
import { MAX_BUILD_PARTS } from "@/lib/domain/engine/validate-build";

/** Bumped only when a shape change makes an older payload unreadable. */
export const GUEST_STATE_VERSION = 1;

/**
 * Everything one import may carry. `partsPerBike` is `MAX_BUILD_PARTS`, so a
 * build the domain would accept is never refused by the envelope instead.
 */
export const GUEST_CAPS = {
  bikes: 10,
  partsPerBike: MAX_BUILD_PARTS,
  checkupsPerBike: 20,
  listsPerBike: 10,
  /** The whole corpus is 222 check steps today; no single checkup can exceed it. */
  itemsPerCheckup: 250,
  itemsPerList: QUOTAS.itemsPerList,
} as const;

/**
 * The action body ceiling for an import. `next.config.ts` allows 512 KB of
 * server-action body — head-room for the framing around this payload, not
 * permission to send more than this.
 */
export const MAX_GUEST_PAYLOAD_BYTES = 256 * 1024;

// ── the contract ─────────────────────────────────────────────────────────────

/** One answered step of a guest checkup — a `CheckupItem` row, as the browser has it. */
export interface GuestCheckupItem {
  /** `${guideSlug}#${stepId}` (`CheckStepKey`). */
  stepKey: string;
  partId: string;
  guideSlug: string;
  result: CheckupAnswer;
  notes?: string;
}

/** One guest checkup — a `Checkup` row plus its items. */
export interface GuestCheckup {
  /** `CheckupState.id`; becomes the user-scoped `Checkup.guestKey`. */
  guestKey: string;
  scope: "full" | "parts";
  /** ISO 8601, clamped to "now" on import (§4.7 clock skew). */
  startedAt: string;
  completedAt?: string;
  items: GuestCheckupItem[];
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
/** `${guideSlug}#${stepId}`, `VarChar(160)` in total. */
const StepKeyPattern = z.string().check(z.regex(/^[a-z0-9-]{1,100}#[a-z0-9-]{1,59}$/));
const IsoDate = z.iso.datetime({ offset: true });
/** `CheckupItem.notes` / `BikePartState.notes` are `VarChar(2000)`. */
const Notes = z.string().check(z.maxLength(2000));
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

/** `https://…` and nothing else: never `javascript:`, never a credentialed URL. */
function isPlainHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "";
}

/**
 * §4.4: the link must be https AND on the named retailer's own hosts, unless
 * the visitor pasted their own (`vendor: 'other'`).
 *
 * The host set is derived from `RETAILERS` itself (`retailerHosts`), so adding
 * a retailer or changing a template moves this guard with it. Checked as a pair
 * because the two fields only mean anything together: a product claiming
 * `vendor: "rosebikes"` and pointing somewhere that is not Rose is the case
 * worth refusing.
 */
function isAllowedProductUrl(product: { vendor: string; url: string }): boolean {
  if (!isPlainHttpsUrl(product.url)) return false;
  return isRetailerId(product.vendor) ? isRetailerUrl(product.vendor, product.url) : true;
}

const ChosenProductSchema = z
  .strictObject({
    brand: z.string().check(z.maxLength(80)),
    model: z.string().check(z.maxLength(120)),
    size: z.string().check(z.maxLength(40)),
    vendor: z.string().check(z.regex(/^[a-z0-9-]{1,40}$/)),
    url: z.string().check(z.maxLength(1000), z.refine(isPlainHttpsUrl)),
  })
  .check(z.refine(isAllowedProductUrl));

const CheckupItemSchema = z.strictObject({
  stepKey: StepKeyPattern,
  partId: PartIdPattern,
  guideSlug: GuideSlugPattern,
  result: z.enum(CHECKUP_ANSWERS),
  notes: z.optional(Notes),
});

const CheckupSchema = z.strictObject({
  guestKey: z.uuid(),
  scope: z.enum(["full", "parts"]),
  startedAt: IsoDate,
  completedAt: z.optional(IsoDate),
  items: z.array(CheckupItemSchema).check(z.maxLength(GUEST_CAPS.itemsPerCheckup)),
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
 * What a stored `CheckupState` (W3-T1, `lib/checkup/types.ts`) has to have for
 * an import to make sense of it. Deliberately LOOSE: the state carries a cursor,
 * a locale, the tools the visitor lacks and a content version, none of which the
 * database keeps, and `z.object` drops them instead of refusing the checkup.
 *
 * A state that does not parse is skipped, never half-read (§1.2).
 */
const StoredCheckupSchema = z.object({
  id: z.uuid(),
  scope: z.union([
    z.object({ kind: z.literal("full") }),
    z.object({ kind: z.literal("parts"), partIds: z.array(z.string()) }),
  ]),
  steps: z.array(
    z.object({
      key: z.string(),
      guideSlug: z.string(),
      partIds: z.array(z.string()),
    }),
  ),
  answers: z.record(z.string(), z.enum(CHECKUP_ANSWERS)),
  notes: z.optional(z.record(z.string(), z.string())),
  startedAt: z.string(),
  completedAt: z.optional(z.string()),
});

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

/** The checkup stored for the guest bike, projected onto {@link GuestCheckup}. */
function collectCheckups(storage: KeyValueStorage): GuestCheckup[] {
  const parsed = StoredCheckupSchema.safeParse(readJson(storage, checkupKey("local")));
  if (!parsed.success) return [];
  const state = parsed.data;

  const stepByKey = new Map(state.steps.map((step) => [step.key, step]));
  const notes = new Map(Object.entries(state.notes ?? {}));
  const items: GuestCheckupItem[] = [];
  for (const [stepKey, result] of Object.entries(state.answers)) {
    const step = stepByKey.get(stepKey);
    // A key the plan no longer has, or a step that reports on no part, has no
    // `CheckupItem` row to become: `partId` and `guideSlug` are both required.
    if (step === undefined || step.partIds.length === 0) continue;
    const note = notes.get(stepKey);
    items.push({
      stepKey,
      partId: step.partIds[0],
      guideSlug: step.guideSlug,
      result,
      ...(note === undefined || note === "" ? {} : { notes: note.slice(0, 2000) }),
    });
  }
  // A checkup with no answers is a wizard the visitor opened and left: there is
  // nothing to remember, and an empty `Checkup` row would show as a history entry.
  if (items.length === 0) return [];

  return [
    {
      guestKey: state.id,
      scope: state.scope.kind === "full" ? "full" : "parts",
      startedAt: state.startedAt,
      ...(state.completedAt === undefined ? {} : { completedAt: state.completedAt }),
      items: items.slice(0, GUEST_CAPS.itemsPerCheckup),
    },
  ];
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

/**
 * Everything this browser holds for a guest, as one payload.
 *
 * Only the `local` keys are read. `va:checkup:demo` and `va:buildlist:demo`
 * belong to the demo bike, which is a read-only preset every visitor shares
 * (§1.2) — there is no row to attach them to, and clearing them would throw
 * away work the visitor can still see on `/velo/demo`.
 */
export function collectGuestState({
  storage = defaultStorage(),
  bikeName,
  listName,
}: CollectGuestStateOptions): GuestState {
  const empty: GuestState = { version: GUEST_STATE_VERSION, bikes: [] };
  if (storage === null) return empty;

  const bike = readLocalBike(storage);
  if (bike === null) return empty;

  return {
    version: GUEST_STATE_VERSION,
    bikes: [
      {
        localId: bike.id,
        name: bikeName,
        answers: bike.answers as Record<string, string>,
        parts: bike.parts,
        fit: bike.fit,
        updatedAt: bike.updatedAt,
        checkups: collectCheckups(storage),
        lists: collectBuildLists(storage, listName),
      },
    ],
  };
}

/** Every key {@link collectGuestState} reads — and therefore every key an import clears. */
export function guestImportKeys(): string[] {
  return [LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")];
}

/** Forget this browser's guest bike, its checkup and its list. Called after a successful import. */
export function clearGuestState(storage: KeyValueStorage | null = defaultStorage()): void {
  if (storage === null) return;
  for (const key of guestImportKeys()) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage that cannot be written cannot hold a stale bike either.
    }
  }
}
