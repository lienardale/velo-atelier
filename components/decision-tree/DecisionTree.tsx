"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Stepper } from "@/components/ui-ext/Stepper";
import { defaultOption, visibleOptions } from "@/lib/domain/engine/decision";
import type { DecisionNode, QuestionId } from "@/lib/domain/schema/decision";
import { Link } from "@/lib/i18n/navigation";

import { DefaultCallout } from "./DefaultCallout";
import { HelpDisclosure } from "./HelpDisclosure";
import { OptionGrid } from "./OptionGrid";
import { RouterSearch } from "./RouterSearch";
import type { LoadLocalBike } from "./Summary";
import { useDecisionText } from "./decision-text";
import { notifyLocationSearchChanged, useLocationSearch } from "./location-search";
import type { TreeIllustrations } from "./tree-illustrations";
import {
  applyAnswer,
  parseTreeSearch,
  positionOf,
  previousQuestion,
  resolveScreen,
  serializeTreeSearch,
  type TreeState,
} from "./tree-state";

/**
 * The summary screen is loaded when it is first shown: it brings the
 * confirmation dialog (Radix Dialog, focus trap, scroll lock) that no question
 * screen needs, and the home page is the tightest bundle budget (`/[locale]`).
 */
const Summary = lazy(() => import("./Summary").then((module) => ({ default: module.Summary })));

/**
 * Key under which each history entry the tree writes records how many tree
 * entries precede it — so "Question précédente" can go back through history
 * when there is a tree entry to go back to, and must not leave the site when
 * the visitor arrived on a deep link.
 */
const HISTORY_DEPTH_KEY = "vaTreeDepth";

function historyDepth(): number {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return 0;
  // eslint-disable-next-line security/detect-object-injection -- a constant key
  const depth = (state as Record<string, unknown>)[HISTORY_DEPTH_KEY];
  return typeof depth === "number" && Number.isInteger(depth) && depth > 0 ? depth : 0;
}

export interface DecisionTreeProps {
  /**
   * Every drawing of the tree, rendered by the server
   * (`renderTreeIllustrations()` in `app/[locale]/page.tsx`): the illustration
   * components never ship to the browser.
   */
  illustrations: TreeIllustrations;
  /** Injection point for tests (see `Summary`). */
  loadLocalBike?: LoadLocalBike;
  /**
   * Called whenever the tree moves on or off the landing screen, so
   * `DecisionTreeFrame` — which owns the `<h1>` heading above this boundary —
   * can drop it as soon as a question becomes the `<h1>`.
   */
  onIntroChange?: (intro: boolean) => void;
}

/**
 * The home page's decision tree (§6.3): one question per screen, the URL as
 * the state.
 *
 * **URL.** Read from `window.location.search` through `useLocationSearch()`,
 * never with `useSearchParams()` during render, and parsed by `tree-state.ts`.
 * That is what lets this whole tree be prerendered into the home document and
 * hydrated once: a `useSearchParams()` read during render puts the tree under a
 * `<Suspense>` boundary on a static route, and React throws the prerendered
 * fallback's DOM away and BUILDS the subtree on the client instead of hydrating
 * it — a second long task, and the 7 % the home page was over its TBT budget by
 * (`.debug/011`).
 *
 * The server has no query string, so the prerendered HTML and the first client
 * render are both the landing screen; React re-reads the URL once hydration is
 * done, which changes nothing on `/fr` itself and costs one render on a deep
 * link. Answering writes with `history.pushState` (moving forward) or
 * `history.replaceState` (editing an earlier answer) — the App Router has no
 * shallow routing, and native history calls cost zero RSC requests — and says
 * so with `notifyLocationSearchChanged()`, because neither call fires an event.
 * `popstate` covers the browser's back and forward buttons, and `RouterSearch`
 * — the one remaining `useSearchParams` consumer, which renders nothing —
 * covers a router navigation that changes the query without leaving the route
 * (the header logo).
 *
 * **Focus.** Every screen change moves focus to the screen's heading and
 * updates `document.title`, so a screen-reader user hears the new question and
 * a keyboard user continues from the top of it.
 *
 * **Headings.** Before any answer, the page's `<h1>` is the site's promise
 * (`DecisionTreeHero`, rendered by the SERVER and handed to
 * `DecisionTreeFrame` as a node, so the LCP element is never re-created by
 * anything this component does — `.debug/007`) and the first question is an
 * `<h2>` under it; from the first answer on, the question itself is the `<h1>`
 * and the frame drops the heading on `onIntroChange(false)`.
 */
export function DecisionTree({
  illustrations,
  loadLocalBike,
  onIntroChange,
}: DecisionTreeProps): React.JSX.Element {
  const common = useTranslations("common");
  const tree = useTranslations("decision-tree");
  const t = useDecisionText();

  // `""` on the server and through hydration, the real query once React has
  // re-read it: this component is prerendered into the document, so the first
  // client render has to be the landing screen. See `location-search.ts`.
  const search = useLocationSearch();

  /**
   * Set when the VISITOR asked for another screen — answering, the back
   * button, a router navigation — and read by the focus effect below.
   *
   * It exists because the URL is adopted after hydration rather than during
   * render, so "the screen key changed" can no longer tell a deep link's
   * arrival apart from a move the visitor made. Without this, a deep-linked
   * page would steal the focus as it loaded, which is the one thing that effect
   * has always promised not to do.
   */
  const askedForScreen = useRef(false);

  /**
   * Back and forward. The re-read itself is `useLocationSearch`'s own
   * subscription; this listener only records that the visitor asked for it, and
   * so never calls `setState` from an effect.
   */
  useEffect(() => {
    const onPopState = () => {
      askedForScreen.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** A router navigation changed the query without leaving the route. */
  const onRouterNavigation = useCallback(() => {
    askedForScreen.current = true;
    notifyLocationSearchChanged();
  }, []);

  const state = useMemo(() => parseTreeSearch(search), [search]);
  const screen = resolveScreen(state);
  const intro = screen.kind === "question" && Object.keys(state.answers).length === 0;
  const screenKey = screen.kind === "summary" ? "summary" : screen.node.id;
  const screenTitle = screen.kind === "summary" ? tree("summary.title") : t(screen.node.titleKey);

  const headingId = useId();
  const headingElement = useRef<HTMLHeadingElement | null>(null);
  const focusPending = useRef(false);
  // A callback ref, so a heading that mounts AFTER the screen change (the lazy
  // summary) still receives the focus the change asked for.
  const headingRef = useCallback((element: HTMLHeadingElement | null) => {
    headingElement.current = element;
    if (element !== null && focusPending.current) {
      focusPending.current = false;
      element.focus();
    }
  }, []);
  const shownScreen = useRef<string | null>(null);
  const wantedTitle = useRef<string | null>(null);

  // Next streams the page metadata: React writes the static `<title>` into the
  // head AFTER this component's first effects, which silently undid the
  // question title on a deep link (seen in the e2e run: set, then reset by a
  // DOM mutation). Re-apply the title this screen wants whenever the head
  // changes; comparing first keeps it from feeding itself.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const wanted = wantedTitle.current;
      if (wanted !== null && document.title !== wanted) document.title = wanted;
    });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // The intro screen keeps the home page's own title (`app/[locale]/page.tsx`
    // builds it the same way); every other screen names its question.
    const title = intro
      ? `${common("site.name")} — ${common("site.tagline")}`
      : tree("documentTitle", { title: screenTitle, site: common("site.name") });
    wantedTitle.current = title;
    if (document.title !== title) document.title = title;

    const changed = shownScreen.current !== screenKey;
    shownScreen.current = screenKey;
    // Never steal focus on page load — not on the first screen, and not when a
    // deep link corrects it one render later: only a move the visitor made.
    if (changed && askedForScreen.current) {
      askedForScreen.current = false;
      if (headingElement.current === null) focusPending.current = true;
      else headingElement.current.focus();
    }
  }, [screenKey, intro, screenTitle, tree, common]);

  const writeUrl = useCallback((next: TreeState, mode: "push" | "replace") => {
    const query = serializeTreeSearch(next, window.location.search);
    const url = `${window.location.pathname}${query}${window.location.hash}`;
    const depth = historyDepth();
    if (mode === "push") window.history.pushState({ [HISTORY_DEPTH_KEY]: depth + 1 }, "", url);
    else window.history.replaceState({ [HISTORY_DEPTH_KEY]: depth }, "", url);
    askedForScreen.current = true;
    // A history write fires no event: say so, or nothing re-reads the URL.
    notifyLocationSearchChanged();
  }, []);

  const answer = (node: DecisionNode, option: string, guessed: boolean, editing: boolean) => {
    writeUrl(applyAnswer(state, node.id, option, guessed), editing ? "replace" : "push");
  };

  const back = (node: DecisionNode) => {
    if (historyDepth() > 0) {
      window.history.back();
      return;
    }
    const previous = previousQuestion(node, state.answers);
    if (previous !== null) writeUrl({ ...state, step: previous }, "replace");
  };

  const edit = (question: QuestionId) => writeUrl({ ...state, step: question }, "push");

  // The landing heading lives above this boundary (see `DecisionTreeFrame`);
  // report which screen we are on so it can step aside for the question's `<h1>`.
  useEffect(() => {
    onIntroChange?.(intro);
  }, [intro, onIntroChange]);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="decision-tree"
      data-screen={screenKey}
      className="flex w-full flex-col gap-6"
    >
      {/*
       * Renders nothing, and is the only `useSearchParams` consumer left here.
       * Its boundary's fallback is empty, so the client render React does
       * instead of hydrating it builds no DOM — see `RouterSearch`.
       */}
      <Suspense fallback={null}>
        <RouterSearch onNavigate={onRouterNavigation} />
      </Suspense>

      {screen.kind === "summary" ? (
        <Suspense fallback={<p className="text-ink-muted">{common("loading")}</p>}>
          <Summary
            answers={state.answers}
            guessed={state.guessed}
            onEdit={edit}
            headingId={headingId}
            headingRef={headingRef}
            loadLocalBike={loadLocalBike}
          />
        </Suspense>
      ) : (
        <QuestionStep
          key={screen.node.id}
          node={screen.node}
          state={state}
          editing={screen.editing}
          headingLevel={intro ? 2 : 1}
          headingId={headingId}
          headingRef={headingRef}
          illustrations={illustrations}
          onAnswer={answer}
          onBack={back}
        />
      )}

      <p className="text-sm">
        <Link
          href={{ pathname: "/velo/[id]", params: { id: "demo" } }}
          data-testid="skip-to-demo"
          className="inline-flex min-h-[var(--tap-min)] items-center font-medium text-accent underline underline-offset-4 hover:no-underline"
        >
          {tree("actions.skipToDemo")}
        </Link>
      </p>
    </section>
  );
}

interface QuestionStepProps {
  node: DecisionNode;
  state: TreeState;
  /** The question already has an answer (the visitor came back to change it). */
  editing: boolean;
  headingLevel: 1 | 2;
  headingId: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  illustrations: TreeIllustrations;
  onAnswer: (node: DecisionNode, option: string, guessed: boolean, editing: boolean) => void;
  onBack: (node: DecisionNode) => void;
}

/**
 * One question: progress, title, answer cards, "Je ne sais pas" (which picks
 * the context-dependent default and explains it, without advancing), the help
 * disclosure, and the navigation buttons. Remounted per question (`key`), so
 * the local selection always starts from the stored answer.
 */
export function QuestionStep({
  node,
  state,
  editing,
  headingLevel,
  headingId,
  headingRef,
  illustrations,
  onAnswer,
  onBack,
}: QuestionStepProps): React.JSX.Element {
  const t = useDecisionText();
  const tree = useTranslations("decision-tree");
  const stored = state.answers[node.id];
  const [selected, setSelected] = useState<string | undefined>(stored);
  const [guessed, setGuessed] = useState(stored !== undefined && state.guessed.includes(node.id));
  const [missing, setMissing] = useState(false);
  const errorId = useId();

  const options = visibleOptions(node, state.answers);
  const { step, total } = positionOf(node, state.answers);
  const hasPrevious = previousQuestion(node, state.answers) !== null;
  const Heading = headingLevel === 1 ? "h1" : "h2";

  const choose = (option: string) => {
    setSelected(option);
    setGuessed(false);
    setMissing(false);
  };

  const dontKnow = () => {
    setSelected(defaultOption(node, state.answers));
    setGuessed(true);
    setMissing(false);
  };

  const proceed = () => {
    if (selected === undefined) {
      setMissing(true);
      return;
    }
    onAnswer(node, selected, guessed, editing);
  };

  return (
    <div data-testid="question-step" data-question={node.id} className="flex flex-col gap-5">
      <Stepper
        current={step}
        total={total}
        label={tree("progress.label", { step: String(step), total: String(total) })}
        title={tree(`questions.${node.id}`)}
      />

      <Heading
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className={
          headingLevel === 1
            ? "text-2xl font-semibold outline-none sm:text-4xl"
            : "text-xl font-semibold outline-none sm:text-2xl"
        }
      >
        {t(node.titleKey)}
      </Heading>

      <OptionGrid
        options={options}
        value={selected}
        onValueChange={choose}
        labelledBy={headingId}
        describedBy={missing ? errorId : undefined}
        illustrations={illustrations}
      />

      {missing ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-fg">
          {tree("actions.chooseFirst")}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={dontKnow}
          aria-pressed={guessed}
          data-testid="dont-know"
          className="tap-target rounded-md border border-dashed border-rule px-4 font-medium text-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-accent aria-pressed:text-accent"
        >
          {tree("actions.dontKnow")}
        </button>
      </div>

      {guessed && selected !== undefined ? (
        <DefaultCallout node={node} answers={state.answers} />
      ) : null}

      <div className="flex flex-wrap-reverse items-center justify-between gap-3">
        {hasPrevious ? (
          <button
            type="button"
            onClick={() => onBack(node)}
            data-testid="tree-back"
            className="tap-target gap-2 rounded-md px-3 font-medium text-ink-muted hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {tree("actions.back")}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={proceed}
          data-testid="tree-continue"
          className="tap-target gap-2 rounded-md bg-accent px-6 font-medium text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {tree("actions.continue")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>

      <HelpDisclosure key={node.id} node={node} illustrations={illustrations} />
    </div>
  );
}
