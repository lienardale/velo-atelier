/**
 * A guest's work, made the way the application makes it.
 *
 * Until 2026-10-07 every guest-import fixture hand-wrote a checkup that carried
 * `steps` — a shape the wizard stopped storing in W3. Every test was green, and
 * on production no checkup was ever imported (`.debug/017` §5.6). The rule this
 * file exists to make cheap: **a guest-import fixture is produced by the code
 * that produces the real thing.**
 *
 *   the bike      `writeLocalBike`                       → `va:bike:local`
 *   the checkup   `planCheckup` over the guides on disk, the reducer's own
 *                 `ANSWER` / `SKIP` / `FINISH` events, then `toStored` and
 *                 `writeStoredCheckup`                   → `va:checkup:local`
 *   the list      `deriveBuildList` + `mergeGuestBuildList`, then
 *                 `writeGuestBuildList` — what "Créer ma liste" does for a
 *                 guest (`components/checkup/Wizard.tsx`) → `va:buildlist:local`
 *   the payload   `collectGuestState`, reading those three keys back
 *
 * …and a run the guest LEFT and came back to through another link is resumed
 * the way the wizard resumes it ({@link resumeGuestRun}): the stored answers
 * against the plan of the NEW link, under the scope the run was first opened
 * with. That stale scope is real — `restore` in `components/checkup/Wizard.tsx`
 * — and a fixture that tidied it up hid the fact that the import dropped 33 of
 * a finished checkup's 34 answers (found in review, 2026-10-09).
 *
 * Nothing here names a step's part or guide: the plan does. A fixture that
 * needs a hostile or malformed payload starts from a real one and breaks
 * exactly one thing.
 *
 * No Vitest import: `tests/e2e/guest-import.spec.ts` uses it from Playwright,
 * where the storage it fills is copied into the page's `localStorage`.
 */
import { writeLocalBike, type KeyValueStorage, type LocalBike } from "@/lib/bike/local-bike";
import { deriveBuildList, mergeGuestBuildList } from "@/lib/checkup/build-list";
import { planCheckup, type PlannableGuide } from "@/lib/checkup/plan";
import { createCheckupState, reduce } from "@/lib/checkup/reducer";
import {
  fromStored,
  readGuestBuildList,
  readStoredCheckup,
  toStored,
  writeGuestBuildList,
  writeStoredCheckup,
} from "@/lib/checkup/storage";
import type { CheckStepRef, CheckupScope, CheckupState } from "@/lib/checkup/types";
import type { PartId } from "@/lib/domain/data/parts";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { collectGuestState, type GuestCollection } from "@/lib/guest/schema";

import { diskGuides } from "./guides";

/** A `localStorage` stand-in: a plain map a test can read, write and corrupt. */
export interface MemoryStorage extends KeyValueStorage {
  map: Map<string, string>;
}

export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** The names `/import` supplies in the visitor's language (`account.import.*`). */
export const GUEST_NAMES = { bikeName: "Mon vélo", listName: "Ma liste" } as const;

let frenchGuides: PlannableGuide[] | null = null;

/**
 * The plan the server computes, over the guides ON DISK.
 *
 * The same function as `planForBuild` (`lib/content/checkup-plan.ts`) with the
 * frontmatter read directly instead of through `content-collections`, whose
 * output only exists after a build. This is what the unit tier injects into
 * `importGuestState`, and what a fixture answers.
 */
export function planFromDisk(build: BikeBuild, scope: CheckupScope): CheckStepRef[] {
  frenchGuides ??= diskGuides().filter(
    (guide) => guide.locale === "fr",
  ) as unknown as PlannableGuide[];
  return planCheckup(build, scope, frenchGuides);
}

/** The scope `?parts=` gives the wizard. */
export function partsScope(...partIds: string[]): CheckupScope {
  return { kind: "parts", partIds: partIds as PartId[] };
}

/** One verdict, as the visitor gives it: a button, or a KO with its symptom and a note. */
export type GuestVerdict =
  "ok" | "skipped" | "ko" | { ko: readonly string[]; notes?: string } | { ok: true; notes: string };

export interface GuestRunOptions {
  /** `CheckupState.id` — a uuid; becomes `Checkup.guestKey` on import. */
  id: string;
  build: BikeBuild;
  scope: CheckupScope;
  /** Step key → verdict. A key the plan does not have is refused here, loudly. */
  verdicts: Readonly<Record<string, GuestVerdict>>;
  startedAt: string;
  /** "Créer ma liste" at this instant; omit for a checkup left in progress. */
  completedAt?: string;
}

/**
 * A checkup as the wizard holds it after these verdicts: the real plan, the
 * real reducer. `completedAt` is `FINISH`, which the reducer accepts only when
 * every question has a verdict — a fixture that claims to be finished and is
 * not throws instead of quietly describing a state no browser can be in.
 */
export function guestRun(options: GuestRunOptions): CheckupState {
  const steps = planFromDisk(options.build, options.scope);
  const state = createCheckupState({
    id: options.id,
    bikeRef: { kind: "local" },
    scope: options.scope,
    locale: "fr",
    steps,
    contentVersion: "fixture",
    startedAt: options.startedAt,
  });

  return finish(answer(state, options.verdicts, "guestRun()"), options.completedAt, "guestRun()");
}

/** The verdicts, given through the reducer's own events — never written into the state. */
function answer(
  from: CheckupState,
  verdicts: Readonly<Record<string, GuestVerdict>>,
  who: string,
): CheckupState {
  let state = from;
  for (const [key, verdict] of Object.entries(verdicts)) {
    if (!state.steps.some((step) => step.key === key)) {
      throw new Error(`${who}: "${key}" is not in this bike's plan for that scope`);
    }
    const before = state;
    if (verdict === "skipped") state = reduce(state, { type: "SKIP", key });
    else if (verdict === "ok" || verdict === "ko") {
      state = reduce(state, { type: "ANSWER", key, result: verdict });
    } else if ("ko" in verdict) {
      state = reduce(state, {
        type: "ANSWER",
        key,
        result: "ko",
        symptoms: verdict.ko,
        ...(verdict.notes === undefined ? {} : { notes: verdict.notes }),
      });
    } else {
      state = reduce(state, { type: "ANSWER", key, result: "ok", notes: verdict.notes });
    }
    if (state === before) throw new Error(`${who}: the reducer refused "${key}"`);
  }
  return state;
}

/** "Créer ma liste" at `completedAt`, or the state as it is when there is none. */
function finish(state: CheckupState, completedAt: string | undefined, who: string): CheckupState {
  if (completedAt === undefined) return state;
  const finished = reduce(state, { type: "FINISH" }, () => new Date(completedAt));
  if (finished.completedAt === undefined) {
    throw new Error(`${who}: FINISH was refused — a question of the plan has no verdict`);
  }
  return finished;
}

/**
 * Write `checkup` under the guest keys the way the wizard does: the checkup
 * always, and — exactly `Wizard.tsx`'s `onCreate` for a guest — the list when
 * the checkup FINISHES, merged into whatever the key already holds.
 */
function storeGuestCheckup(
  storage: MemoryStorage,
  checkup: CheckupState,
  list: boolean,
  who: string,
): void {
  if (!writeStoredCheckup("local", toStored(checkup), storage)) {
    throw new Error(`${who}: writeStoredCheckup refused to write`);
  }
  if (!list) return;
  const stored = readGuestBuildList("local", storage);
  writeGuestBuildList(
    "local",
    mergeGuestBuildList(
      stored?.items ?? [],
      deriveBuildList(checkup),
      checkup,
      stored?.checkupId === checkup.id,
    ),
    checkup.id,
    storage,
  );
}

export interface GuestWorkOptions {
  /** The decision tree's answers — `BIKE_PRESETS[…]`. */
  answers: Answers;
  fit?: Record<string, number> | null;
  /** Keep this guest bike id (the same bike seen from a second device). */
  bikeId?: string;
  /** `va:bike:local`'s `updatedAt`. */
  updatedAt?: string;
  /** The checkup to store, built against {@link LocalBike}'s own build. */
  checkup?: (build: BikeBuild) => CheckupState;
  /** Write the to-fix list a FINISHED checkup produces. Default: when there is one. */
  list?: boolean;
  storage?: MemoryStorage;
}

export interface GuestWork {
  storage: MemoryStorage;
  bike: LocalBike;
  build: BikeBuild;
  /** The checkup as the wizard holds it, when one was stored. */
  checkup: CheckupState | null;
  /** `collectGuestState` over that storage — the payload, and what was read. */
  collect: () => GuestCollection;
}

/**
 * Fill a storage with a guest bike, and optionally the checkup and the list
 * the wizard would have left beside it — each through its real writer.
 */
export function guestWork(options: GuestWorkOptions): GuestWork {
  const storage = options.storage ?? memoryStorage();
  const bike = writeLocalBike(
    {
      answers: options.answers,
      fit: options.fit ?? null,
      ...(options.bikeId === undefined ? {} : { id: options.bikeId }),
    },
    {
      storage,
      ...(options.updatedAt === undefined
        ? {}
        : { now: () => new Date(options.updatedAt as string) }),
    },
  );
  if (bike === null) throw new Error("guestWork(): writeLocalBike refused to write");
  const build: BikeBuild = { spec: bike.spec, parts: bike.parts };

  const checkup = options.checkup?.(build) ?? null;
  if (checkup !== null) {
    storeGuestCheckup(
      storage,
      checkup,
      options.list ?? checkup.completedAt !== undefined,
      "guestWork()",
    );
  }

  return {
    storage,
    bike,
    build,
    checkup,
    collect: () => collectGuestState({ storage, ...GUEST_NAMES }),
  };
}

export interface GuestResumeOptions {
  /** The scope of the link the guest came BACK through: `?parts=`, or the full checkup. */
  scope: CheckupScope;
  /** Step key → verdict, for questions of THAT link's plan. */
  verdicts?: Readonly<Record<string, GuestVerdict>>;
  /** The verdict every question still open then gets — a guest who answers them all. */
  rest?: "ok" | "skipped";
  /** "Créer ma liste" at this instant; omit to leave the run in progress again. */
  completedAt?: string;
}

/**
 * The guest comes back to an UNFINISHED checkup through another link, and
 * carries on — `restore` in `components/checkup/Wizard.tsx`, call for call.
 *
 * The page plans the link's scope; the wizard reads the stored run (its own
 * read, `readStoredCheckup`) and marries it to THAT plan with `fromStored`.
 * Two things follow, and neither is this helper's doing: an answer the new
 * plan does not ask is dropped by `reconcile`, and the state keeps the scope
 * the run was first opened with — `fromStored` takes `stored.scope`, and
 * `toStored` writes it back. So a run opened on the chain and finished through
 * "Contrôle complet" is stored with 34 answers and `scope: parts[chain]`.
 *
 * Returns the same storage with the continued run under the key (and the list,
 * if it finished).
 */
export function resumeGuestRun(work: GuestWork, options: GuestResumeOptions): GuestWork {
  const stored = readStoredCheckup("local", work.storage);
  if (stored === null) throw new Error("resumeGuestRun(): no stored checkup to resume");
  if (stored.completedAt !== undefined) {
    throw new Error("resumeGuestRun(): a finished checkup is never resumed (isFinished)");
  }

  const plan = planFromDisk(work.build, options.scope);
  let state = fromStored(stored, plan, stored.contentVersion);
  state = answer(state, options.verdicts ?? {}, "resumeGuestRun()");
  const rest = options.rest;
  if (rest !== undefined) {
    const open = plan.filter((step) => !Object.hasOwn(state.answers, step.key));
    state = answer(
      state,
      Object.fromEntries(
        // A question that cannot be skipped is answered instead.
        open.map((step) => [step.key, rest === "skipped" && !step.skippable ? "ok" : rest]),
      ),
      "resumeGuestRun()",
    );
  }
  const checkup = finish(state, options.completedAt, "resumeGuestRun()");
  storeGuestCheckup(work.storage, checkup, checkup.completedAt !== undefined, "resumeGuestRun()");
  return { ...work, checkup };
}
