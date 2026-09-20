/**
 * Where a checkup is kept (§5.4) — one interface, two destinations.
 *
 *   guest   `va:checkup:demo` / `va:checkup:local` in `localStorage`, guarded
 *           by `zod/mini` on the way out and dropped when it does not parse;
 *   saved   the `Checkup` + `CheckupItem` rows, reached through injected server
 *           actions so this module never imports one (and a unit test passes a
 *           fake instead of a database).
 *
 * ## The plan is not stored
 *
 * What is written is {@link StoredCheckup}: the answers, the symptoms, the
 * notes, the missing tools — never the questions and never the cursor. The plan
 * is recomputed from `(spec, scope)` on every load and married to the stored
 * answers by `reconcile()` (§5.4). Three things follow, and all three are the
 * point: the payload stays small, a corpus that grew a step is picked up for
 * free, and a visitor who edits storage cannot invent a question.
 *
 * ## Autosave
 *
 * `createAutosave` debounces 500 ms and exposes `flush()`, which the wizard
 * calls on `pagehide` — the one event that still fires when a phone browser
 * discards the tab. A save that throws is reported, never swallowed silently:
 * the wizard shows the "Sauvegardé" chip only for a save that happened.
 */
import * as z from "zod/mini";

import {
  buildListKey,
  checkupKey,
  GUEST_BIKE_REFS,
  type GuestBikeRef,
} from "@/lib/bike/storage-keys";
import { TOOL_IDS } from "@/lib/domain/data/tools";
import { routing } from "@/lib/i18n/routing";

import {
  CHECKUP_ANSWERS,
  CHECKUP_STATE_VERSION,
  type BuildListItem,
  type CheckStepRef,
  type CheckupState,
} from "./types";
import { reconcile } from "./reconcile";
import { createCheckupState } from "./reducer";

/** The storage a caller passes — `window.localStorage` by default, a fake in tests. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * What a checkup looks like at rest. Deliberately NOT `CheckupState`: no
 * `steps` (the plan is recomputed) and no `cursor` (a position in a plan that
 * no longer exists means nothing).
 */
export interface StoredCheckup {
  version: typeof CHECKUP_STATE_VERSION;
  id: string;
  bikeRef: CheckupState["bikeRef"];
  scope: CheckupState["scope"];
  locale: CheckupState["locale"];
  answers: CheckupState["answers"];
  symptoms: CheckupState["symptoms"];
  notes: CheckupState["notes"];
  toolsMissing: CheckupState["toolsMissing"];
  startedAt: string;
  completedAt?: string;
  contentVersion: string;
}

/** What "you left a checkup unfinished" needs, without loading the whole thing. */
export interface StoredCheckupSummary {
  id: string;
  bikeRef: CheckupState["bikeRef"];
  scope: CheckupState["scope"];
  startedAt: string;
  completedAt?: string;
  answered: number;
}

export interface CheckupStore {
  load(): Promise<StoredCheckup | null>;
  save(state: CheckupState): Promise<void>;
  list(): Promise<StoredCheckupSummary[]>;
}

// ── Guards ───────────────────────────────────────────────────────────────────

const StepKey = z.string().check(z.regex(/^[a-z0-9-]{1,64}#[a-z0-9-]{1,64}$/));
const ReasonKey = z.string().check(z.regex(/^[a-z0-9-]{1,80}$/));

const BikeRefSchema = z.union([
  z.object({ kind: z.literal("demo") }),
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("db"), id: z.uuid() }),
]);

const ScopeSchema = z.union([
  z.object({ kind: z.literal("full") }),
  z.object({
    kind: z.literal("parts"),
    partIds: z.array(z.string().check(z.regex(/^[a-z0-9-]{1,48}$/))).check(z.maxLength(64)),
  }),
]);

/** Exported for the guest import (W3-T3), which reads the same key. */
export const StoredCheckupSchema = z.object({
  version: z.literal(CHECKUP_STATE_VERSION),
  id: z.uuid(),
  bikeRef: BikeRefSchema,
  scope: ScopeSchema,
  locale: z.enum(routing.locales),
  answers: z.record(StepKey, z.enum(CHECKUP_ANSWERS)),
  symptoms: z.record(StepKey, z.array(ReasonKey).check(z.maxLength(12))),
  notes: z.record(StepKey, z.string().check(z.maxLength(2000))),
  toolsMissing: z.array(z.enum(TOOL_IDS)).check(z.maxLength(TOOL_IDS.length)),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.optional(z.iso.datetime({ offset: true })),
  contentVersion: z.string().check(z.maxLength(64)),
});

const StoredBuildListSchema = z.object({
  version: z.literal(CHECKUP_STATE_VERSION),
  updatedAt: z.iso.datetime({ offset: true }),
  // Optional so a list written before the field existed still reads: without
  // it the merge treats the previous list as a LATER checkup's, which keeps
  // the visitor's findings rather than pruning them.
  checkupId: z.optional(z.string().check(z.maxLength(64))),
  items: z.array(z.unknown()).check(z.maxLength(200)),
});

// ── State ↔ stored ───────────────────────────────────────────────────────────

/** The part of a state that is written. */
export function toStored(state: CheckupState): StoredCheckup {
  return {
    version: CHECKUP_STATE_VERSION,
    id: state.id,
    bikeRef: state.bikeRef,
    scope: state.scope,
    locale: state.locale,
    answers: state.answers,
    symptoms: state.symptoms,
    notes: state.notes,
    toolsMissing: state.toolsMissing,
    startedAt: state.startedAt,
    ...(state.completedAt === undefined ? {} : { completedAt: state.completedAt }),
    contentVersion: state.contentVersion,
  };
}

/**
 * A stored checkup against a freshly computed plan: the answers are kept, the
 * questions are today's, and the cursor lands on the first one still open.
 */
export function fromStored(
  stored: StoredCheckup,
  plan: readonly CheckStepRef[],
  contentVersion: string,
): CheckupState {
  const empty = createCheckupState({
    id: stored.id,
    bikeRef: stored.bikeRef,
    scope: stored.scope,
    locale: stored.locale,
    steps: plan,
    contentVersion: stored.contentVersion,
    startedAt: stored.startedAt,
  });
  return reconcile(
    {
      ...empty,
      answers: stored.answers,
      symptoms: stored.symptoms,
      notes: stored.notes,
      toolsMissing: stored.toolsMissing,
      completedAt: stored.completedAt,
    },
    plan,
    contentVersion,
  );
}

/** How many questions a stored checkup already has a verdict for. */
export function answeredCount(stored: StoredCheckup): number {
  return Object.keys(stored.answers).length;
}

function summaryOf(stored: StoredCheckup): StoredCheckupSummary {
  return {
    id: stored.id,
    bikeRef: stored.bikeRef,
    scope: stored.scope,
    startedAt: stored.startedAt,
    ...(stored.completedAt === undefined ? {} : { completedAt: stored.completedAt }),
    answered: answeredCount(stored),
  };
}

// ── localStorage ─────────────────────────────────────────────────────────────

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode, blocked site data: behave as if nothing is stored.
    return null;
  }
}

function readRaw(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(storage: KeyValueStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The checkup stored for `ref`, or `null`. An unreadable value is removed. */
export function readStoredCheckup(
  ref: GuestBikeRef,
  storage: KeyValueStorage | null = defaultStorage(),
): StoredCheckup | null {
  if (storage === null) return null;
  const key = checkupKey(ref);
  const raw = readRaw(storage, key);
  if (raw === null) return null;
  const parsed = StoredCheckupSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage that cannot be written cannot hold a stale checkup either.
    }
    return null;
  }
  return parsed.data as StoredCheckup;
}

/** Write the checkup for `ref`; `false` when storage refused it (quota, private mode). */
export function writeStoredCheckup(
  ref: GuestBikeRef,
  stored: StoredCheckup,
  storage: KeyValueStorage | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  return writeRaw(storage, checkupKey(ref), JSON.stringify(stored));
}

/** The guest bike a ref names, for the two bikes that live in the browser. */
export function guestRefOf(bikeRef: CheckupState["bikeRef"]): GuestBikeRef | null {
  return bikeRef.kind === "db" ? null : bikeRef.kind;
}

/** `va:checkup:<ref>` — the store the wizard uses for `demo` and `local`. */
export function localStorageStore(
  ref: GuestBikeRef,
  storage: KeyValueStorage | null = defaultStorage(),
): CheckupStore {
  return {
    load: async () => readStoredCheckup(ref, storage),
    save: async (state) => {
      if (!writeStoredCheckup(ref, toStored(state), storage)) {
        throw new Error(`va:checkup:${ref} could not be written`);
      }
    },
    list: async () =>
      GUEST_BIKE_REFS.flatMap((candidate) => {
        const stored = readStoredCheckup(candidate, storage);
        return stored === null ? [] : [summaryOf(stored)];
      }),
  };
}

// ── Server ───────────────────────────────────────────────────────────────────

/** The three calls a saved bike's store needs, injected so nothing here imports an action. */
export interface CheckupStoreActions {
  load(): Promise<StoredCheckup | null>;
  save(stored: StoredCheckup): Promise<void>;
  list(): Promise<StoredCheckupSummary[]>;
}

/** A store backed by server actions (`/velo/[id]/controle/actions.ts`). */
export function createServerStore(actions: CheckupStoreActions): CheckupStore {
  return {
    load: () => actions.load(),
    save: (state) => actions.save(toStored(state)),
    list: () => actions.list(),
  };
}

// ── Autosave ─────────────────────────────────────────────────────────────────

/** Debounce for the guest store (§5.4). The server store uses 2 s (§6.5). */
export const AUTOSAVE_DELAY_MS = 500;

export interface Autosave {
  /** Remember this state and write it after the delay. */
  schedule(state: CheckupState): void;
  /** Write it now — `pagehide`, or a navigation the wizard controls. */
  flush(): Promise<void>;
  /** Drop a pending write (unmount). */
  cancel(): void;
}

export interface AutosaveOptions {
  delay?: number;
  onSaved?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Debounced writes with a flush.
 *
 * `setTimeout` rather than a `requestIdleCallback`: a save that never happens
 * because the phone stayed busy is a lost checkup, and 500 ms of typing is not
 * worth an idle callback's unpredictability.
 */
export function createAutosave(store: CheckupStore, options: AutosaveOptions = {}): Autosave {
  const delay = options.delay ?? AUTOSAVE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CheckupState | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const write = async (): Promise<void> => {
    clear();
    const state = pending;
    pending = null;
    if (state === null) return;
    try {
      await store.save(state);
      options.onSaved?.();
    } catch (error) {
      options.onError?.(error);
    }
  };

  return {
    schedule(state) {
      pending = state;
      clear();
      timer = setTimeout(() => void write(), delay);
    },
    flush: write,
    cancel() {
      clear();
      pending = null;
    },
  };
}

// ── The guest to-fix list ────────────────────────────────────────────────────
//
// `deriveBuildList` is this task's; the list PAGE is W3-T2's. For a guest bike
// there is no row to hand over, so the derived list is written under
// `va:buildlist:<ref>` in this envelope and read back there. The items are
// stored as they were derived and re-validated by the page, not here: this
// module's job is the envelope and the key.

export interface StoredBuildList {
  version: typeof CHECKUP_STATE_VERSION;
  updatedAt: string;
  /**
   * The checkup that wrote it. A guest has ONE list key per bike where an
   * account has one `BuildList` row per `Checkup`, so this is what lets
   * `mergeGuestBuildList` tell a re-run of the same checkup (the visitor
   * corrected a verdict: prune the line) from a later one (the bike answered
   * differently: close the line, §6.7).
   */
  checkupId: string;
  items: BuildListItem[];
}

/** The derived list stored for `ref`, or `null`. */
export function readGuestBuildList(
  ref: GuestBikeRef,
  storage: KeyValueStorage | null = defaultStorage(),
): StoredBuildList | null {
  if (storage === null) return null;
  const raw = readRaw(storage, buildListKey(ref));
  if (raw === null) return null;
  const parsed = StoredBuildListSchema.safeParse(parseJson(raw));
  return parsed.success ? (parsed.data as StoredBuildList) : null;
}

/** Write the derived list for `ref`; `false` when storage refused it. */
export function writeGuestBuildList(
  ref: GuestBikeRef,
  items: readonly BuildListItem[],
  checkupId: string,
  storage: KeyValueStorage | null = defaultStorage(),
  now: () => Date = () => new Date(),
): boolean {
  if (storage === null) return false;
  const payload: StoredBuildList = {
    version: CHECKUP_STATE_VERSION,
    updatedAt: now().toISOString(),
    checkupId,
    items: [...items],
  };
  return writeRaw(storage, buildListKey(ref), JSON.stringify(payload));
}
