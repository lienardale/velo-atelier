"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useId } from "react";

import { cn } from "@/lib/utils";

/** Where a `persistKey` actually lands in `localStorage`. */
export function disclosureStorageKey(persistKey: string): string {
  return `va:ui:disclosure:${persistKey}`;
}

export interface DisclosureProps extends Omit<React.ComponentProps<"details">, "open"> {
  /** The always-visible label. Rendered inside the `<summary>`. */
  summary: React.ReactNode;
  /** Open on first render, when nothing has been remembered yet. */
  defaultOpen?: boolean;
  /**
   * Remember the open/closed state under this key (§6.3: the decision tree's
   * help stays open across steps). Omit for a disclosure that always starts
   * from `defaultOpen`.
   */
  persistKey?: string;
  /** Called whenever the user opens or closes it. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * A native `<details>`/`<summary>` disclosure — the help panel of the decision
 * tree (§6.3) and the "how to measure" panels of the build list (§6.5).
 *
 * Native on purpose: `<details>` already gives the button semantics, the
 * expanded state, keyboard operation and find-in-page expansion, and it works
 * with JavaScript disabled or still loading. Nothing here re-implements any of
 * that; the component only adds the chevron, the 44 px target and the optional
 * `localStorage` memory.
 *
 * The open state lives in the DOM, not in React state. The remembered value is
 * applied through a ref callback, which runs after the commit that mounted the
 * element: the server has no `localStorage`, so reading it while rendering
 * would make the first client render disagree with the HTML and trip
 * hydration — and, unlike an effect, a ref callback does not schedule a second
 * render just to move one attribute. Storage access is wrapped: Safari's
 * private mode throws on `localStorage`, and a help panel is not worth a
 * crashed page.
 */
export function Disclosure({
  summary,
  defaultOpen = false,
  persistKey,
  onOpenChange,
  className,
  children,
  ...props
}: DisclosureProps): React.JSX.Element {
  const contentId = useId();

  const applyStoredState = useCallback(
    (node: HTMLDetailsElement | null) => {
      if (!node || !persistKey) return;
      const stored = readStoredOpen(persistKey);
      if (stored !== null) node.open = stored;
    },
    [persistKey],
  );

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (persistKey) writeStoredOpen(persistKey, next);
    onOpenChange?.(next);
  };

  return (
    <details
      ref={applyStoredState}
      data-slot="disclosure"
      open={defaultOpen}
      onToggle={handleToggle}
      className={cn("group rounded-md border border-rule bg-paper-2/60", className)}
      {...props}
    >
      <summary
        data-slot="disclosure-summary"
        aria-controls={contentId}
        className="tap-target w-full cursor-pointer list-none justify-between gap-2 rounded-md px-3 text-left text-sm font-medium text-ink marker:content-none hover:bg-paper-2 [&::-webkit-details-marker]:hidden"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted transition-transform duration-(--motion-fast) group-open:rotate-180"
        />
      </summary>
      <div
        id={contentId}
        data-slot="disclosure-content"
        className="border-t border-rule px-3 py-3 text-sm text-ink-muted"
      >
        {children}
      </div>
    </details>
  );
}

function readStoredOpen(persistKey: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(disclosureStorageKey(persistKey));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredOpen(persistKey: string, open: boolean): void {
  try {
    window.localStorage.setItem(disclosureStorageKey(persistKey), open ? "1" : "0");
  } catch {
    // Private browsing, or storage full: the panel still works, it just forgets.
  }
}
