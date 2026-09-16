"use client";

import { createContext, useContext } from "react";

/**
 * Which step of a guide is on screen (§5.2, the W1-T4 ↔ W3-T1 wizard contract).
 *
 *   activeStepId === null   the guide page: every `<Step>` renders, and so does
 *                           the table of contents;
 *   activeStepId === "id"   the checkup wizard: only that step renders, and the
 *                           table of contents does not.
 *
 * A guide's MDX compiles to one server-rendered tree; the wizard wraps that same
 * tree in `<StepScope activeStepId={current.stepId}>` and changes the id on
 * every step. No guide code is re-fetched or re-run in the browser — only this
 * context value changes.
 *
 * Without a provider the value is `null`, so a guide rendered anywhere shows
 * all its steps.
 */
const StepScopeContext = createContext<string | null>(null);

export function StepScope({
  activeStepId,
  children,
}: {
  activeStepId: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return <StepScopeContext.Provider value={activeStepId}>{children}</StepScopeContext.Provider>;
}

/** The step the surrounding scope shows, or `null` for "all of them". */
export function useActiveStepId(): string | null {
  return useContext(StepScopeContext);
}
