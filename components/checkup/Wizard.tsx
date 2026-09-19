"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  finishCheckupAction,
  listCheckupsAction,
  loadCheckupAction,
  saveCheckupAction,
} from "@/app/[locale]/velo/[id]/controle/actions";
import { Button } from "@/components/ui/button";
import { deriveBuildList } from "@/lib/checkup/build-list";
import { createCheckupState, reduce } from "@/lib/checkup/reducer";
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
import { useRouter } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

import { CheckupSummary } from "./CheckupSummary";
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
  const router = useRouter();

  // The saved bike's checkup is known on the SERVER (the page read the row), so
  // it goes into the initial state and the first paint is already right. A
  // guest's lives in `localStorage`, which the server cannot see: it arrives
  // below, after hydration.
  const [state, setState] = useState<CheckupState>(() => restore(props, props.initialStored));
  const [started, setStarted] = useState(() => answeredAny(props.initialStored));
  const [creating, setCreating] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  const guestRef = guestRefOf(props.bikeRef);
  const bikeId = props.bikeRef.kind === "db" ? props.bikeRef.id : null;

  // Adjusted DURING RENDER, React's own "a prop changed, reset the state"
  // pattern — not in an effect, which would paint an empty checkup first and
  // then replace it (and is what `react-hooks/set-state-in-effect` forbids).
  const stored = useStoredCheckup(guestRef);
  const [hydratedFrom, setHydratedFrom] = useState<StoredCheckup | null>(null);
  if (stored !== STORED_CHECKUP_PENDING && stored !== null && stored !== hydratedFrom) {
    setHydratedFrom(stored);
    setState(restore(props, stored));
    setStarted(answeredAny(stored));
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
  const phase = !started ? "tools" : onSummary ? "summary" : "step";

  // The heading takes focus on every step change — but not on the first
  // render, where focus belongs to whatever the visitor clicked to get here.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastCursor = useRef<number | null>(null);
  useEffect(() => {
    if (phase === "tools") return;
    if (lastCursor.current !== null && lastCursor.current !== state.cursor) {
      headingRef.current?.focus();
    }
    lastCursor.current = state.cursor;
  }, [state.cursor, phase]);

  // `?step=` is the resume link (§6.5). `replaceState`, not a navigation: the
  // App Router has no shallow routing and a push would re-render the page.
  useEffect(() => {
    if (phase !== "step" || step === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set("step", step.key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [phase, step]);

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
  const isStub = useCallback(
    (slug: string) =>
      // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
      Object.hasOwn(props.guideRefs, slug) ? props.guideRefs[slug].stub : false,
    [props.guideRefs],
  );

  const onCreate = useCallback(() => {
    if (!canFinish(state) || creating) return;
    setCreating(true);
    const finished = reduce(state, { type: "FINISH" });
    setState(finished);
    autosave.cancel();

    void (async () => {
      try {
        if (guestRef !== null) {
          await store.save(finished);
          writeGuestBuildList(guestRef, deriveBuildList(finished));
        } else {
          // The server re-plans, re-derives and writes the list itself (§5.4):
          // the browser never says what is on it.
          await finishCheckupAction({ bikeId: bikeId ?? "", checkup: toStored(finished) });
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
        />
      ) : null}
    </div>
  );
}

/**
 * A stored checkup against today's plan, parked on `?step=` when there is one.
 *
 * `fromStored` is what keeps a corpus change cheap: the answers survive, the
 * questions are the ones on disk now, and the cursor lands on the first one
 * still open.
 */
function restore(props: WizardProps, stored: StoredCheckup | null): CheckupState {
  const empty = createCheckupState({
    id: stored?.id ?? props.newCheckupId,
    bikeRef: props.bikeRef,
    scope: props.scope,
    locale: props.locale,
    steps: props.steps,
    contentVersion: props.contentVersion,
    ...(stored === null ? {} : { startedAt: stored.startedAt }),
  });
  if (stored === null) return empty;
  const restored = fromStored(stored, props.steps, props.contentVersion);
  const at = stepIndexOf(restored, props.initialStepKey);
  return at < 0 ? restored : { ...restored, cursor: at };
}

function answeredAny(stored: StoredCheckup | null): boolean {
  return stored !== null && Object.keys(stored.answers).length > 0;
}

/** "Sauvegardé", or the honest admission that nothing was (§6.5). */
function SaveChip({ state }: { state: "idle" | "saved" | "error" }): React.JSX.Element | null {
  const t = useTranslations("checkup");
  if (state === "idle") return null;
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="checkup-save-state"
      data-state={state}
      className={cn(
        "self-start rounded-full px-2 py-0.5 text-sm",
        state === "saved" ? "bg-success/10 text-success-fg" : "bg-danger/10 text-danger-fg",
      )}
    >
      {t(state === "saved" ? "save.saved" : "save.failed")}
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
