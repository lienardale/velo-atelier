"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import {
  finishCheckupAction,
  listCheckupsAction,
  loadCheckupAction,
  saveCheckupAction,
} from "@/app/[locale]/velo/[id]/controle/actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui-ext/Callout";
import { deriveBuildList, mergeGuestBuildList } from "@/lib/checkup/build-list";
import { createCheckupState, reduce } from "@/lib/checkup/reducer";
import {
  guestResumeTarget,
  knownParts,
  scopeFacts,
  type OtherPlan,
  type ResumeTarget,
  type ScopeFacts,
} from "@/lib/checkup/scope";
import {
  canFinish,
  currentStep,
  isOnSummary,
  noteOf,
  openSteps,
  progressOf,
  stepIndexOf,
  summarySections,
  symptomOptions,
  symptomsOf,
  toolSubstitutions,
  verdictOf,
} from "@/lib/checkup/selectors";
import {
  readGuestBuildList,
  createAutosave,
  createServerStore,
  fromStored,
  guestRefOf,
  localStorageStore,
  toStored,
  writeGuestBuildList,
  type CheckupStore,
  type StoredCheckup,
} from "@/lib/checkup/storage";
import type { CheckStepRef, CheckupScope, CheckupState, ToolRef } from "@/lib/checkup/types";
import type { BikeRef } from "@/lib/bike/resolve-bike-ref";
import type { ToolId } from "@/lib/domain/data/tools";
import { getPathname, useRouter } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

import { CheckupSummary } from "./CheckupSummary";
import { replaceDocument } from "./replace-document";
import { STORED_CHECKUP_PENDING, useStoredCheckup } from "./use-stored-checkup";
import { StepCard } from "./StepCard";
import { SymptomPicker } from "./SymptomPicker";
import { ToolChecklist } from "./ToolChecklist";
import { VerdictBar } from "./VerdictBar";

/** What the wizard needs to know about a guide a symptom can point at. */
export interface WizardGuideRef {
  title: string;
  stub: boolean;
}

export interface WizardProps {
  locale: Locale;
  bikeRef: BikeRef;
  /** `demo`, `local`, or the UUID — the `[id]` of every link out of here. */
  bikeParam: string;
  scope: CheckupScope;
  /** `?parts=` named nothing this bike has, so the scope widened (§6.7). */
  scopeDropped?: boolean;
  /**
   * The page planned the FULL checkup instead of the parts it was asked for,
   * because an unfinished run of this bike is one the parts asked for do not
   * hold (`lib/checkup/scope.ts`): decided on the server for a saved bike,
   * and for a guest by this component, which came back with `?resume=full`.
   */
  resumeWidened?: boolean;
  /**
   * The run is resumed on the parts it was opened on, not on the ones the
   * visitor came for: a guest's, by this component, which came back with
   * `?resume=own`; a saved bike's, by the page, which read them from its rows.
   */
  resumedOwn?: boolean;
  /**
   * A guest's run brought to the full checkup for its own parts (`?parts=` +
   * `?resume=full`): those parts' plan and facts, so that this component
   * checks again that the full checkup takes the run over
   * (`guestResumeTarget`) — the address alone is never taken at its word.
   */
  widenedFrom?: OtherPlan;
  /**
   * What the page knows of its `parts` scope against the bike's FULL plan
   * (`scopeFacts`), handed down with a `parts` scope: the full plan's keys (a
   * question the corpus dropped decides nothing), the questions this scope
   * touches and no longer asks, and the symptoms it withholds. A guest's run
   * is in `localStorage`, so this component decides whether the page holds
   * it, by the rule the server applies to a saved bike's.
   */
  scopeFacts?: ScopeFacts;
  /** The plan, computed on the server from (spec, scope). */
  steps: readonly CheckStepRef[];
  /**
   * One pre-rendered guide tree per planned guide, keyed by slug (§5.2). The
   * wizard shows one step of one of them at a time by changing `StepScope`;
   * no guide code ever reaches the browser.
   */
  guideNodes: Record<string, React.ReactNode>;
  /** Titles and stub flags for every guide a step or a symptom can name. */
  guideRefs: Record<string, WizardGuideRef>;
  tools: readonly ToolRef[];
  /** `CONTENT_VERSION` — the corpus this plan was made from. */
  contentVersion: string;
  /** A fresh uuid, minted on the server so the first render is deterministic. */
  newCheckupId: string;
  /** The saved bike's checkup, read by the page; `null` for a guest bike. */
  initialStored: StoredCheckup | null;
  /** `?step=` — where to resume. */
  initialStepKey: string | null;
  /** `?spec=` for a `local` bike's links out (§5.4). */
  specCode: string | null;
}

/** Guest storage writes immediately; a round trip to the server waits (§6.5). */
const SERVER_AUTOSAVE_MS = 2000;

/** The quota refusals `finishCheckupAction` names (§4.2 c), as `checkup.*` keys. */
const FINISH_REFUSALS = [
  "finish.tooManyLists",
  "finish.tooManyCheckups",
  "finish.tooManyLines",
] as const;

type FinishError = (typeof FINISH_REFUSALS)[number] | "finish.failed";

/**
 * What to tell the visitor when the server refused to finish. The action's
 * `form` key says which limit it was (`checkup.finish.tooManyLists`, …); a
 * refusal it did not name — or one from a future version of the action — is
 * still said out loud, just less precisely.
 */
function finishErrorOf(failure: { fieldErrors?: Readonly<Record<string, string>> }): FinishError {
  const key = failure.fieldErrors?.form?.replace(/^checkup\./, "");
  return FINISH_REFUSALS.find((known) => known === key) ?? "finish.failed";
}

/**
 * The checkup, from the tool list to "Créer ma liste" (§6.5).
 *
 * ## One state, recomputed questions
 *
 * The server hands down the PLAN and the guide trees; this component owns the
 * ANSWERS. Everything on screen is a pure function of that one state
 * (`lib/checkup/selectors.ts`), so there is nothing to keep in sync and nothing
 * that can drift — the summary cannot disagree with the steps, and the tint the
 * viewer gets afterwards cannot disagree with either.
 *
 * ## Where the answers go
 *
 * `demo` and `local` write `va:checkup:<ref>` straight away; a saved bike goes
 * through the server actions with a 2 s debounce and a flush on `pagehide`,
 * which is the last event a phone browser still fires when it discards the tab.
 * The stored payload is answers only — the plan is recomputed and reconciled on
 * the way back in, so a corpus that grew a question does not cost the visitor
 * the fourteen they already answered.
 *
 * ## Keyboard, and the "2" that must not answer anything
 *
 * 1 / 2 / 3 are the three verdicts, and they are ignored the moment focus is in
 * a field: typing "2" in the note of a KO step is a note, not a verdict
 * (§6.8 AC6). The heading takes focus on every step change, so a screen reader
 * announces the new question instead of leaving the user at the bottom of the
 * previous one.
 */
export function Wizard(props: WizardProps): React.JSX.Element {
  const t = useTranslations("checkup");
  const tTools = useTranslations("tools");
  const tGuides = useTranslations("guides");
  const tParts = useTranslations("parts");
  const format = useFormatter();
  const router = useRouter();

  // The saved bike's checkup is known on the SERVER (the page read the row), so
  // it goes into the initial state and the first paint is already right. A
  // guest's lives in `localStorage`, which the server cannot see: it arrives
  // below, after hydration.
  // A stored run this page's scope cannot hold is never restored here — that
  // would trim it to the page's plan, or count its answers for parts they were
  // not given for, and the next save would write that (`.debug/017` §5.10,
  // §5.12): the wizard leaves for the page that holds it instead.
  const [leaving, setLeaving] = useState(() => leavingFor(props, props.initialStored));
  const [state, setState] = useState<CheckupState>(() =>
    restore(props, leaving !== null ? null : props.initialStored),
  );
  const [started, setStarted] = useState(() => alreadyStarted(props, props.initialStored));
  const [notice, setNotice] = useState(() => resumeNoticeOf(props, props.initialStored));
  const [creating, setCreating] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [finishError, setFinishError] = useState<FinishError | null>(null);

  const guestRef = guestRefOf(props.bikeRef);
  const bikeId = props.bikeRef.kind === "db" ? props.bikeRef.id : null;

  // Adjusted DURING RENDER — React's own "a prop changed, reset the state"
  // pattern — rather than in an effect, which would paint an empty checkup and
  // replace it a frame later (and is what `react-hooks/set-state-in-effect`
  // forbids). ONCE, on the first render that has the stored value: this
  // component is what changes that value, and re-hydrating after its own
  // autosave would throw the visitor back to wherever the reconciled cursor
  // lands, mid-question.
  const stored = useStoredCheckup(guestRef);
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && stored !== STORED_CHECKUP_PENDING) {
    setHydrated(true);
    const away = stored === null ? null : leavingFor(props, stored);
    if (away !== null) {
      setLeaving(away);
    } else if (stored !== null) {
      setState(restore(props, stored));
      setStarted(alreadyStarted(props, stored));
      setNotice(resumeNoticeOf(props, stored));
    }
  }

  const store = useMemo<CheckupStore>(
    () => (guestRef === null ? serverStore(bikeId) : localStorageStore(guestRef)),
    [guestRef, bikeId],
  );

  const autosave = useMemo(
    () =>
      createAutosave(store, {
        ...(guestRef === null ? { delay: SERVER_AUTOSAVE_MS } : {}),
        onSaved: () => setSaveState("saved"),
        onError: () => setSaveState("error"),
      }),
    [store, guestRef],
  );

  // The run in progress needs another page: the full checkup (`?resume=full`,
  // with the parts a partial run was opened on, which that page plans to
  // check it again) or the parts it was opened on (`?parts=…&resume=own`).
  // Replaced, not pushed — this address is not a page to come back to, and
  // nothing has been written from it — and by a full navigation
  // (`replace-document.ts` says why).
  useEffect(() => {
    if (leaving === null) return;
    autosave.cancel();
    const own =
      leaving.kind === "own" ? leaving.scope : leaving.kind === "full" ? leaving.from : undefined;
    const query = new URLSearchParams({
      ...(props.specCode === null ? {} : { spec: props.specCode }),
      ...(own === undefined ? {} : { parts: own.partIds.join(",") }),
      resume: leaving.kind === "own" ? "own" : "full",
    });
    const pathname = getPathname({
      href: { pathname: "/velo/[id]/controle", params: { id: props.bikeParam } },
      locale: props.locale,
    });
    replaceDocument(`${pathname}?${query.toString()}`);
  }, [leaving, autosave, props.bikeParam, props.specCode, props.locale]);

  // Flush on `pagehide`: a phone that discards the tab fires nothing else.
  useEffect(() => {
    const flush = (): void => void autosave.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      autosave.cancel();
    };
  }, [autosave]);

  const apply = useCallback(
    (next: CheckupState) => {
      // `reduce` returns the SAME object when the event changed nothing, so an
      // ignored key or a `BACK` on step 1 costs neither a render nor a write.
      if (next === state) return;
      setState(next);
      setSaveState("idle");
      autosave.schedule(next);
    },
    [state, autosave],
  );

  const dispatch = useCallback(
    (event: Parameters<typeof reduce>[1]) => apply(reduce(state, event)),
    [apply, state],
  );

  const step = currentStep(state);
  const onSummary = isOnSummary(state);
  const progress = progressOf(state);
  const phase = leaving !== null ? "resuming" : !started ? "tools" : onSummary ? "summary" : "step";

  // The heading takes focus on every step change — but not on the first
  // render, where focus belongs to whatever the visitor clicked to get here.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastCursor = useRef<number | null>(null);
  useEffect(() => {
    if (phase === "tools" || phase === "resuming") return;
    if (lastCursor.current !== null && lastCursor.current !== state.cursor) {
      headingRef.current?.focus();
    }
    lastCursor.current = state.cursor;
  }, [state.cursor, phase]);

  // `?step=` is the resume link (§6.5). `replaceState`, not a navigation: the
  // App Router has no shallow routing and a push would re-render the page.
  //
  // It is REMOVED on the tool list and on the summary, and that matters: the
  // parameter wins over the stored cursor on load, so a checkup that was
  // finished and then reloaded would come back on its last question instead of
  // on its summary.
  //
  // A saved bike's address also says what the page SHOWS, because the page
  // reads it back on a reload (`page.tsx`): `?parts=` the parts on screen —
  // which may be the run's own rather than the ones the visitor came for, or
  // none, for the full checkup — and `?run=` the run's `startedAt` beside
  // them, which tells the page that these parts are the run's own: a row on
  // the front caliper cannot say whether its run was the front caliper's or
  // both calipers' (`lib/checkup/scope.ts`). Never `?run=` on parts that are
  // not on screen, and never `?resume=`, which is a guest's.
  const runToken = String(Date.parse(state.startedAt));
  const showing = props.bikeRef.kind === "db" ? props.scope : null;
  useEffect(() => {
    // Leaving for the full checkup: this document's address is not touched
    // while the browser loads the next one.
    if (phase === "resuming") return;
    const url = new URL(window.location.href);
    if (phase === "step" && step !== null) url.searchParams.set("step", step.key);
    else url.searchParams.delete("step");
    if (showing !== null) {
      url.searchParams.delete("resume");
      if (showing.kind === "parts") {
        url.searchParams.set("parts", showing.partIds.join(","));
        url.searchParams.set("run", runToken);
      } else {
        url.searchParams.delete("parts");
        url.searchParams.delete("run");
      }
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [phase, step, showing, runToken]);

  // 1 / 2 / 3, ignored while the visitor is typing (§6.8 AC6).
  useEffect(() => {
    if (phase !== "step" || step === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingIn(event.target)) return;
      if (event.key === "1") apply(reduce(state, { type: "ANSWER", key: step.key, result: "ok" }));
      else if (event.key === "2")
        apply(reduce(state, { type: "ANSWER", key: step.key, result: "ko" }));
      else if (event.key === "3") apply(reduce(state, { type: "SKIP", key: step.key }));
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phase, step, state, apply]);

  const labelOf = useCallback((toolId: ToolId) => tTools(`${toolId}.label`), [tTools]);
  const reasonLabel = useCallback(
    (reasonKey: string) => tGuides(`reasons.${reasonKey}` as never),
    [tGuides],
  );
  const guideTitle = useCallback(
    (slug: string) =>
      // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
      Object.hasOwn(props.guideRefs, slug) ? props.guideRefs[slug].title : null,
    [props.guideRefs],
  );
  // A question a partial checkup asks for SOME of the parts it names counts for
  // those only (`coveredParts`, `lib/checkup/plan.ts`): said under the prompt
  // and on the summary, in the parts' own names.
  const coveredOf = useCallback(
    (entry: CheckStepRef): string | null =>
      entry.coveredParts === undefined
        ? null
        : format.list(
            entry.coveredParts.map((partId) => tParts(`${partId}.label` as never)),
            { type: "conjunction" },
          ),
    [format, tParts],
  );
  // The resume notice, in the visitor's words: which questions now count for
  // every part they name, or which parts the run was brought back to.
  const noticeText = (shown: ResumeNotice): string => {
    if (shown.kind === "ownParts") {
      return t("resumed.ownParts", {
        parts: format.list(
          (props.scope.kind === "parts" ? props.scope.partIds : []).map((partId) =>
            tParts(`${partId}.label` as never),
          ),
          { type: "conjunction" },
        ),
      });
    }
    if (shown.kind === "partialAsFull" && shown.questions.length > 0) {
      const titles = new Map(props.steps.map((entry) => [entry.key, entry.title]));
      return t("resumed.partialAsFullNamed", {
        questions: format.list(
          shown.questions.map((key) => t("resumed.question", { title: titles.get(key) ?? key })),
          { type: "conjunction" },
        ),
      });
    }
    return t(`resumed.${shown.kind}`);
  };
  const isStub = useCallback(
    (slug: string) =>
      // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
      Object.hasOwn(props.guideRefs, slug) ? props.guideRefs[slug].stub : false,
    [props.guideRefs],
  );

  const onCreate = useCallback(() => {
    if (!canFinish(state) || creating) return;
    setCreating(true);
    setFinishError(null);
    const before = state;
    const finished = reduce(state, { type: "FINISH" });
    setState(finished);
    autosave.cancel();

    void (async () => {
      try {
        if (guestRef !== null) {
          await store.save(finished);
          // Merged, not replaced: `va:buildlist:<ref>` is the guest's ONE list,
          // so this is where a later OK closes an earlier line (§5.4, §6.7)
          // and where the cassette they already chose survives a re-run. A
          // saved bike has one open `BuildList` too since W5, and
          // `writeBuildList` merges into it by the same rules.
          const stored = readGuestBuildList(guestRef);
          writeGuestBuildList(
            guestRef,
            mergeGuestBuildList(
              stored?.items ?? [],
              deriveBuildList(finished),
              finished,
              stored?.checkupId === finished.id,
            ),
            finished.id,
          );
        } else {
          // The server re-plans, re-derives and writes the list itself (§5.4):
          // the browser never says what is on it.
          const result = await finishCheckupAction({
            bikeId: bikeId ?? "",
            checkup: toStored(finished),
          });
          if (!result.ok) {
            // Refused (a quota, §4.2 c): nothing was written, so the checkup
            // goes back to exactly where it was, and the visitor is told why —
            // never a navigation to a list that does not exist.
            setState(before);
            setFinishError(finishErrorOf(result));
            setCreating(false);
            return;
          }
        }
        setSaveState("saved");
      } catch {
        setSaveState("error");
        setCreating(false);
        return;
      }
      router.push({
        pathname: "/velo/[id]/liste",
        params: { id: props.bikeParam },
        ...(props.specCode === null ? {} : { query: { spec: props.specCode } }),
      });
    })();
  }, [state, creating, autosave, store, guestRef, bikeId, router, props.bikeParam, props.specCode]);

  const heading = phase === "step" && step !== null ? step.title : t("title");

  return (
    <div className="flex flex-col gap-6" data-testid="checkup-wizard" data-phase={phase}>
      <header className="flex flex-col gap-1">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl font-semibold text-ink outline-none"
        >
          {heading}
        </h1>
        <p className="text-sm text-ink-muted" data-testid="checkup-scope">
          {t(props.scope.kind === "full" ? "scopeFull" : "scopePartial")}
        </p>
        <SaveChip state={saveState} />
      </header>

      {props.scopeDropped === true ? (
        <Callout tone="info" data-testid="checkup-scope-dropped">
          {t("scopeDropped")}
        </Callout>
      ) : null}

      {phase === "resuming" ? (
        <p role="status" className="text-ink-muted" data-testid="checkup-resuming">
          {t("resumed.going")}
        </p>
      ) : null}

      {phase !== "resuming" && notice !== null ? (
        <Callout tone="info" data-testid="checkup-resumed" data-notice={notice.kind}>
          {noticeText(notice)}
        </Callout>
      ) : null}

      {phase === "tools" ? (
        <>
          <p className="text-ink-muted">{t("intro")}</p>
          <ToolChecklist
            tools={props.tools}
            missing={state.toolsMissing}
            onToggle={(toolId, missing) => dispatch({ type: "TOOL_MISSING", toolId, missing })}
            labelOf={labelOf}
          />
          <Button
            type="button"
            className="tap-target self-start"
            onClick={() => setStarted(true)}
            data-testid="checkup-start"
          >
            {progress.answered > 0 ? t("tools.resume") : t("tools.start")}
          </Button>
        </>
      ) : null}

      {phase === "step" && step !== null ? (
        <>
          <StepCard
            step={step}
            index={state.cursor}
            total={state.steps.length}
            guideNode={nodeFor(props.guideNodes, step.guideSlug)}
            substitutions={toolSubstitutions(step, state.toolsMissing)}
            labelOf={labelOf}
          >
            {verdictOf(state, step.key) === "ko" ? (
              <SymptomPicker
                stepKey={step.key}
                options={symptomOptions(step)}
                value={symptomsOf(state, step.key)[0] ?? null}
                onPick={(reasonKey) =>
                  dispatch({
                    type: "ANSWER",
                    key: step.key,
                    result: "ko",
                    symptoms: [reasonKey],
                    notes: noteOf(state, step.key),
                  })
                }
                note={noteOf(state, step.key)}
                onNoteChange={(note) =>
                  dispatch({
                    type: "ANSWER",
                    key: step.key,
                    result: "ko",
                    symptoms: [...symptomsOf(state, step.key)],
                    notes: note,
                  })
                }
                reasonLabel={reasonLabel}
                guideTitle={guideTitle}
                isStub={isStub}
              />
            ) : null}
          </StepCard>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="tap-target"
              onClick={() => dispatch({ type: "BACK" })}
              disabled={state.cursor === 0}
              data-testid="checkup-back"
            >
              {t("step.back")}
            </Button>
          </div>

          <VerdictBar
            prompt={step.prompt}
            {...(step.coveredParts === undefined
              ? {}
              : { coveredNote: t("step.covered", { parts: coveredOf(step) ?? "" }) })}
            current={verdictOf(state, step.key)}
            skippable={step.skippable}
            onAnswer={(result) => dispatch({ type: "ANSWER", key: step.key, result })}
            onSkip={() => dispatch({ type: "SKIP", key: step.key })}
          />
        </>
      ) : null}

      {phase === "summary" ? (
        <CheckupSummary
          sections={summarySections(state)}
          counts={progress}
          open={openSteps(state)}
          onEdit={(key) => dispatch({ type: "JUMP", key })}
          onCreate={onCreate}
          creating={creating}
          coveredOf={coveredOf}
        />
      ) : null}

      {phase === "summary" && finishError !== null ? (
        <Callout tone="danger" role="alert" data-testid="checkup-finish-error">
          <p>{t(finishError)}</p>
        </Callout>
      ) : null}
    </div>
  );
}

/**
 * A FINISHED checkup is history, not something to resume.
 *
 * `va:checkup:<ref>` holds one checkup per bike, so without this a guest who
 * completed one and came back could only ever edit that same checkup — and
 * §5.4's "a later OK on a part with an open item closes it" was unreachable,
 * because changing a verdict inside one checkup DROPS the line (the visitor
 * withdrew the finding) instead of closing it with `recheck-ok` (the bike
 * answered differently a month later). The list under `va:buildlist:<ref>`
 * survives, which is exactly what `mergeGuestBuildList` closes against.
 *
 * Not even through `?step=`. The wizard writes that parameter for the question
 * on screen, and after a finished checkup that question belongs to a NEW run: a
 * reload before the new run's first save (a phone that discarded the tab) came
 * back with it, reopened the FINISHED run with its old verdicts on screen, and
 * wrote the next answers into it. `?step=` only says which question of the new
 * run to open (`tests/e2e/checkup-second-run.spec.ts`).
 */
function isFinished(stored: StoredCheckup | null): boolean {
  return stored !== null && stored.completedAt !== undefined;
}

/**
 * What this page knows of its scope against the bike's full plan: handed down
 * with a `parts` scope (`scopeFacts`). A full page's plan IS the full plan.
 * Without the facts — hand-shaped props — every stored answer counts.
 */
function factsOf(props: WizardProps, stored: StoredCheckup): ScopeFacts {
  if (props.scopeFacts !== undefined) return props.scopeFacts;
  const keys = props.steps.map((step) => step.key);
  const asked = props.scope.kind === "full" ? keys : [...keys, ...Object.keys(stored.answers)];
  return { ...scopeFacts(props.scope, props.steps, props.steps), asked };
}

/**
 * Must this page hand a GUEST's stored run over to another page before
 * resuming it, and which? `guestResumeTarget` (`lib/checkup/scope.ts`) decides,
 * from what this page holds:
 *
 *   the full checkup (`?resume=full`)   a full run with answers, opened on some
 *                                       parts; a partial run whose answers the
 *                                       full checkup asks about what they were
 *                                       given for, or which its own parts no
 *                                       longer hold — sent with those parts,
 *                                       which the full page plans to check it
 *                                       again;
 *   its own parts (`?resume=own`)       a partial run opened anywhere else —
 *                                       its answers count for the parts they
 *                                       were given for, and nowhere else. On
 *                                       parts that ask nothing on this bike
 *                                       today, that address is planned as the
 *                                       full checkup for the run, which then
 *                                       takes it over (`page.tsx`, §5.14).
 *
 * A finished run is history, never resumed, so never a reason. A saved bike's
 * run is judged by the server, which read its rows and planned the page
 * accordingly: this component never sends it anywhere. An answer to a
 * question the bike is no longer asked is never a reason, so a question the
 * corpus dropped never sends the visitor to a page that would send them on
 * again.
 */
function leavingFor(props: WizardProps, stored: StoredCheckup | null): ResumeTarget | null {
  if (stored === null || isFinished(stored) || props.bikeRef.kind === "db") return null;
  const target = guestResumeTarget(
    { scope: stored.scope, answers: stored.answers, symptoms: stored.symptoms },
    props.scope,
    props.steps,
    factsOf(props, stored),
    { arrivedOwn: props.resumedOwn === true, widenedFrom: props.widenedFrom ?? null },
  );
  return target.kind === "page" ? null : target;
}

/** What the resume notice says — see {@link resumeNoticeOf}. */
type ResumeNotice =
  | { kind: "partialAsFull"; questions: readonly string[] }
  | { kind: "fullInProgress" }
  | { kind: "ownParts" };

/**
 * Does this question name several parts? An answer given to it in a checkup
 * limited to some of them may have been given for those only.
 */
function namesSeveralParts(step: CheckStepRef): boolean {
  return new Set([...step.partIds, ...step.ko.map((consequence) => consequence.partId)]).size > 1;
}

/**
 * What to tell a visitor whose run carries on elsewhere than where it began:
 *
 *   partialAsFull   a run opened on some parts, resumed over every question —
 *                   a saved bike's whose rows cannot tell its parts, or one
 *                   the full checkup takes over (`carriedOnWhole`; a guest's
 *                   whose own parts ask nothing on this bike among them). Its
 *                   answers to questions that name several parts now count
 *                   for each of them: the sentence says so and NAMES those
 *                   questions (`questions`), so that the visitor knows which
 *                   answers to check — and the wizard opens on the first of
 *                   them where they may count for parts they were not given
 *                   for ({@link showsNamedFirst});
 *   fullInProgress  a full run in progress, which the parts asked for could
 *                   only have narrowed;
 *   ownParts        a run brought back to the parts it was opened on — a
 *                   guest's by `?resume=own`, a saved bike's by the page,
 *                   from its rows: its answers count for them only.
 */
function resumeNoticeOf(props: WizardProps, stored: StoredCheckup | null): ResumeNotice | null {
  if (stored === null || isFinished(stored)) return null;
  const answered = Object.keys(stored.answers);
  if (answered.length === 0) return null;
  if (props.scope.kind === "parts") {
    return props.resumedOwn === true && stored.scope.kind === "parts" ? { kind: "ownParts" } : null;
  }
  if (stored.scope.kind === "parts") {
    return {
      kind: "partialAsFull",
      questions: props.steps
        .filter((step) => Object.hasOwn(stored.answers, step.key) && namesSeveralParts(step))
        .map((step) => step.key),
    };
  }
  return props.resumeWidened === true ? { kind: "fullInProgress" } : null;
}

/**
 * A stored checkup against today's plan, parked on `?step=` when there is one —
 * or a NEW run, when there is nothing to resume.
 *
 * Resumed on the PAGE's scope, never on the one it was stored with: the page
 * holds the run (see {@link leavingFor}), and its plan is what is on screen
 * and what every save posts back. Until 2026-10-22 the stored scope was kept —
 * a saved bike's PARTIAL row reads as a scope naming no part, which planned no
 * question on the server, and the next save deleted every stored answer of the
 * run (`.debug/017` §5.10).
 *
 * `fromStored` is what keeps a corpus change cheap: the answers survive, the
 * questions are the ones on disk now, and the cursor lands on the first one
 * still open.
 *
 * A new run gets its own id AND its own `startedAt` (`createCheckupState`
 * stamps "now"), and the second matters as much as the first: a saved bike's
 * server knows a run by its `startedAt` (`existingCheckup` in
 * `controle/actions.ts`, where the same `startedAt` again is the same checkup
 * finished again). A new run that inherited a finished one's was written INTO
 * it — its first autosave overwrote the finished verdicts, finishing deleted
 * the lines of its list instead of closing them `recheck-ok` (§5.4), and the
 * bike never got a second row for the §4.2 (c) quotas to count
 * (`tests/e2e/checkup-second-run.spec.ts`).
 */
function restore(props: WizardProps, stored: StoredCheckup | null): CheckupState {
  const resumable = stored !== null && !isFinished(stored);
  const restored = resumable
    ? keepTouched(
        fromStored({ ...stored, scope: props.scope }, props.steps, props.contentVersion),
        stored,
        props.scopeFacts?.touched ?? [],
      )
    : createCheckupState({
        id: props.newCheckupId,
        bikeRef: props.bikeRef,
        scope: props.scope,
        locale: props.locale,
        steps: props.steps,
        contentVersion: props.contentVersion,
      });
  // `?step=` wins over "where you had got to": it IS the resume link, and it is
  // also what a deep link into one question of a checkup means.
  const at = stepIndexOf(restored, props.initialStepKey);
  if (at >= 0) return { ...restored, cursor: at };
  // A partial run carried on as the full checkup where its answers may now
  // count for parts they were not given for opens no later than the first
  // answer the notice names, so that the visitor, going on from question to
  // question, sees it again: earlier if a question before it is still open,
  // never past it (`.debug/017` §5.13, RA-3; until then the wizard opened on
  // the first open question, after it, and the answer was never shown) —
  // see {@link showsNamedFirst} for which runs.
  const notice = showsNamedFirst(props, stored) ? resumeNoticeOf(props, stored) : null;
  const named =
    notice?.kind === "partialAsFull" && notice.questions.length > 0
      ? stepIndexOf(restored, notice.questions[0])
      : -1;
  return named < 0 ? restored : { ...restored, cursor: Math.min(named, restored.cursor) };
}

/**
 * Does the full checkup count a resumed partial run's answers for parts they
 * may not have been given for — so that it opens no later than the first one
 * the notice names?
 *
 *   a saved bike's   yes (§5.13, RA-3): the page carries one on here when its
 *                    rows cannot tell its parts — an answer given for one
 *                    side then counts for both — or when the full checkup
 *                    takes over the run they tell; this component is not
 *                    told which, and does it in both;
 *   a guest's        only when the parts it was opened on ask NOTHING on
 *                    this bike today — the page plans `?resume=own` on them as
 *                    the full checkup for them (`widenedFrom` with no step:
 *                    the left shifter's run of before 2026-10-22, a front
 *                    derailleur's once the guest bike is a 1x, `.debug/017`
 *                    §5.14) — or name no part the catalogue knows. Its
 *                    answers were then given for parts the full checkup does
 *                    not ask them about. Otherwise never: the full checkup
 *                    takes a guest's run over only when it asks every answer
 *                    about what it was given for (`guestResumeTarget`).
 */
function showsNamedFirst(props: WizardProps, stored: StoredCheckup | null): boolean {
  if (props.bikeRef.kind === "db") return true;
  if (stored === null || stored.scope.kind !== "parts") return false;
  return knownParts(stored.scope) === null || props.widenedFrom?.steps.length === 0;
}

/**
 * `state` with the stored answers to questions this page only TOUCHES put back
 * — an OK or a skip given, before 2026-10-22, to `hose-leak` in a caliper's
 * checkup (`lib/checkup/scope.ts`). `fromStored` keeps the questions the page
 * asks; these are not asked, so nothing on screen or in a list reads them —
 * every reader goes through `state.steps` — but every save writes them back.
 * Until 2026-10-22 a guest's copy lost them at the next save (`.debug/017`
 * §5.13, V1-3).
 */
function keepTouched(
  state: CheckupState,
  stored: StoredCheckup,
  touched: readonly string[],
): CheckupState {
  const kept = touched.filter((key) => Object.hasOwn(stored.answers, key));
  if (kept.length === 0) return state;
  const pick = <T,>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(
      kept
        .filter((key) => Object.hasOwn(record, key))
        // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
        .map((key) => [key, record[key]]),
    );
  return {
    ...state,
    answers: { ...state.answers, ...pick(stored.answers) },
    notes: { ...state.notes, ...pick(stored.notes) },
    symptoms: { ...state.symptoms, ...pick(stored.symptoms) },
  };
}

/**
 * Does the visitor go straight to a question, or to the tool list first?
 *
 * The tool list is for someone about to start. Somebody coming back to answers
 * they have already given, or following a `?step=` link, is not starting.
 */
function alreadyStarted(props: WizardProps, stored: StoredCheckup | null): boolean {
  const resumable = stored !== null && !isFinished(stored);
  if (resumable && Object.keys(stored.answers).length > 0) return true;
  return props.steps.some((step) => step.key === props.initialStepKey);
}

/**
 * "Sauvegardé", or the honest admission that nothing was (§6.5).
 *
 * Always rendered, empty when there is nothing to say: a chip that appears and
 * disappears every time an answer is given moves everything below it — the
 * question, the guide, and the verdict bar a thumb is already reaching for.
 */
function SaveChip({ state }: { state: "idle" | "saved" | "error" }): React.JSX.Element {
  const t = useTranslations("checkup");
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="checkup-save-state"
      data-state={state}
      className={cn(
        "min-h-6 self-start rounded-full px-2 py-0.5 text-sm",
        state === "saved" && "bg-success/10 text-success-fg",
        state === "error" && "bg-danger/10 text-danger-fg",
      )}
    >
      {state === "idle" ? "" : t(state === "saved" ? "save.saved" : "save.failed")}
    </p>
  );
}

/** Is focus in something the visitor is typing into? */
function isTypingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function nodeFor(nodes: Record<string, React.ReactNode>, slug: string): React.ReactNode {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(nodes, slug) ? nodes[slug] : null;
}

/** The saved bike's store: the four actions, unwrapped from `ActionResult`. */
function serverStore(bikeId: string | null): CheckupStore {
  const id = bikeId ?? "";
  return createServerStore({
    load: async () => {
      const result = await loadCheckupAction({ bikeId: id });
      return result.ok ? result.data : null;
    },
    save: async (stored) => {
      const result = await saveCheckupAction({ bikeId: id, checkup: stored });
      if (!result.ok) throw new Error(result.code);
    },
    list: async () => {
      const result = await listCheckupsAction({ bikeId: id });
      return result.ok ? result.data : [];
    },
  });
}
