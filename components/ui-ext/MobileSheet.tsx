"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useRef, useState } from "react";

import { motionDuration, useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * How tall the sheet is, as a fraction of the viewport. Its top edge never
 * reaches the header: 0.92 leaves 8 dvh of the page visible above it, which is
 * what tells a first-time user there is something behind the sheet.
 */
export const SHEET_HEIGHT = 0.92;

/**
 * The three resting positions, as the fraction of the viewport the sheet
 * covers (§6.4): a peek that leaves the 3D viewer fully usable, a half that
 * shows the parts list next to the bike, and (almost) full screen.
 */
export const SHEET_SNAP_POINTS = [0.18, 0.5, 0.92] as const;

/** Index into `SHEET_SNAP_POINTS`; also the value of `data-snap`. */
export type SheetSnap = 0 | 1 | 2;

const MAX_SNAP: SheetSnap = 2;

/** Below this, a pointer gesture is a tap on the handle, not a drag. */
const DRAG_SLOP_PX = 4;

interface DragState {
  pointerId: number;
  /** Where the finger went down. */
  startY: number;
  /** The sheet's offset when the finger went down. */
  startOffset: number;
  /** The sheet's offset right now — read on pointerup, so it is never stale. */
  offset: number;
  /** Has the finger travelled further than the slop? */
  moved: boolean;
}

export interface MobileSheetProps extends Omit<
  React.ComponentProps<"section">,
  "title" | "onChange"
> {
  /**
   * The sheet's DOM id — the handle's `aria-controls` target. Defaults to a
   * generated one; the bike workspace passes `parts-sheet` (§6.4).
   */
  id?: string;
  /** Optional heading pinned above the scroll area; also the sheet's label. */
  title?: React.ReactNode;
  /** Accessible name of the handle while the sheet can still grow. */
  expandLabel: string;
  /** Accessible name of the handle once it is fully open. */
  collapseLabel: string;
  /** Controlled snap index. Pass it together with `onSnapChange`. */
  snap?: SheetSnap;
  /** Initial snap index when uncontrolled. Defaults to the half position. */
  defaultSnap?: SheetSnap;
  /** Called with the new index on every drag, click or key that moves the sheet. */
  onSnapChange?: (snap: SheetSnap) => void;
  /** Override the resting positions. Three fractions of the viewport, ascending. */
  snapPoints?: readonly [number, number, number];
  children: React.ReactNode;
}

/**
 * The mobile bottom sheet (§6.4): fixed to the bottom, 92 dvh tall, resting at
 * one of three snap points, and the only scrolling container on the page.
 *
 * Hand-rolled on pointer events, deliberately — `vaul` is unmaintained and its
 * React 19 support is unverified (see the plan's decisions table), and
 * everything this needs is one `translateY` plus `setPointerCapture`.
 *
 * Three properties the test suite pins down, because they are the ones that
 * silently rot:
 *
 *  - **It is operable without a pointer.** The handle is a real `<button>`
 *    carrying `aria-expanded` / `aria-controls`: clicking it steps up through
 *    the snap points and wraps back to the bottom from the top, and ArrowUp /
 *    ArrowDown / Home / End move one step at a time. Every snap point is
 *    reachable from the keyboard.
 *  - **The position is observable.** `data-snap="0|1|2"` on the root and the
 *    offset itself in `--sheet-y`, so a test (and Playwright) reads where the
 *    sheet is instead of parsing a transform matrix.
 *  - **Reduced motion means zero, not "fast".** The transition runs for
 *    `--sheet-duration`, a literal `0ms` when the user asked for less motion —
 *    and also while a finger is down, so the sheet tracks the drag instead of
 *    lagging 200 ms behind it.
 *
 * Strings arrive as props: this component owns no message namespace.
 */
export function MobileSheet({
  id,
  title,
  expandLabel,
  collapseLabel,
  snap: controlledSnap,
  defaultSnap = 1,
  onSnapChange,
  snapPoints = SHEET_SNAP_POINTS,
  className,
  style,
  children,
  ...props
}: MobileSheetProps): React.JSX.Element {
  const generatedId = useId();
  const sheetId = id ?? `sheet-${generatedId}`;
  const titleId = `${sheetId}-title`;

  const [uncontrolledSnap, setUncontrolledSnap] = useState<SheetSnap>(defaultSnap);
  const snap = controlledSnap ?? uncontrolledSnap;

  /** Live drag offset in px. `null` means "resting at a snap point". */
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<DragState | null>(null);
  /** A drag that moved also ends in a `click`; that click must not step again. */
  const dragged = useRef(false);

  const reducedMotion = useReducedMotion();

  function commit(next: SheetSnap): void {
    if (controlledSnap === undefined) setUncontrolledSnap(next);
    if (next !== snap) onSnapChange?.(next);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    // Secondary buttons open context menus; they must not start a drag.
    if (event.button !== 0) return;
    const startOffset = offsetPxFor(pointAt(snapPoints, snap));
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
      moved: false,
    };
    dragged.current = false;
    // Capture, so a finger that slides off the 44 px handle keeps dragging.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragOffset(startOffset);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const travelled = event.clientY - active.startY;
    if (Math.abs(travelled) > DRAG_SLOP_PX) active.moved = true;
    // Down to the lowest snap point, up to the sheet's full height: the drag
    // can never lift the sheet off the bottom edge or push it off-screen.
    const lowest = offsetPxFor(snapPoints[0]);
    active.offset = Math.min(Math.max(active.startOffset + travelled, 0), lowest);
    setDragOffset(active.offset);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>): void {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null;
    dragged.current = active.moved;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragOffset(null);
    // A tap is not a drag: leave it to the click handler, which steps up.
    if (!active.moved) return;
    const height = viewportHeight();
    commit(
      nearestSnap(snapPoints, height === 0 ? snapPoints[0] : SHEET_HEIGHT - active.offset / height),
    );
  }

  function handleClick(): void {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    // Up one step, and back to the bottom once there is nowhere left to go, so
    // this one button reaches every position.
    commit(snap === MAX_SNAP ? 0 : step(snap, 1));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowUp") commit(step(snap, 1));
    else if (event.key === "ArrowDown") commit(step(snap, -1));
    else if (event.key === "Home") commit(0);
    else if (event.key === "End") commit(MAX_SNAP);
    else return;
    // Otherwise the page behind the sheet scrolls at the same time.
    event.preventDefault();
  }

  const fullyOpen = snap === MAX_SNAP;

  return (
    <section
      id={sheetId}
      data-slot="mobile-sheet"
      data-snap={snap}
      data-dragging={dragOffset === null ? undefined : "true"}
      aria-labelledby={title === undefined ? undefined : titleId}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex h-[92dvh] max-h-[92dvh] flex-col",
        "translate-y-(--sheet-y) rounded-t-xl border-t border-rule bg-paper text-ink",
        "shadow-[0_-8px_24px_rgb(0_0_0/0.18)]",
        "transition-transform duration-(--sheet-duration) ease-(--ease-standard)",
        className,
      )}
      style={
        {
          "--sheet-y":
            dragOffset === null ? offsetVhFor(snapPoints, snap) : `${Math.round(dragOffset)}px`,
          "--sheet-duration": dragOffset === null ? motionDuration(reducedMotion) : "0ms",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      <button
        type="button"
        data-slot="mobile-sheet-handle"
        aria-expanded={snap > 0}
        aria-controls={sheetId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="tap-target w-full shrink-0 touch-none gap-2 rounded-t-xl"
      >
        <span aria-hidden="true" className="block h-1.5 w-10 rounded-full bg-rule" />
        {fullyOpen ? (
          <ChevronDown aria-hidden="true" className="size-4 text-ink-muted" />
        ) : (
          <ChevronUp aria-hidden="true" className="size-4 text-ink-muted" />
        )}
        <span className="sr-only">{fullyOpen ? collapseLabel : expandLabel}</span>
      </button>

      {title === undefined ? null : (
        <p
          id={titleId}
          data-slot="mobile-sheet-title"
          className="shrink-0 border-b border-rule px-4 pb-2 font-display text-base font-semibold"
        >
          {title}
        </p>
      )}

      <div
        data-slot="mobile-sheet-content"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {children}
      </div>
    </section>
  );
}

/** `points[index]`, without an unchecked dynamic index. */
function pointAt(points: readonly number[], index: number): number {
  return points.at(index) ?? SHEET_SNAP_POINTS[1];
}

/** One step along the snap points, clamped at both ends. */
function step(from: SheetSnap, delta: number): SheetSnap {
  return Math.min(Math.max(from + delta, 0), MAX_SNAP) as SheetSnap;
}

/** The viewport height the drag maths works in; 0 only outside a browser. */
function viewportHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

/**
 * How far down the sheet sits, in px, when it covers `point` of the viewport:
 * it is `SHEET_HEIGHT` tall, so showing less means pushing the difference off
 * the bottom edge.
 */
function offsetPxFor(point: number): number {
  return (SHEET_HEIGHT - point) * viewportHeight();
}

/** The same offset as a `dvh` length, which survives the mobile URL bar. */
function offsetVhFor(points: readonly number[], snap: SheetSnap): string {
  const hidden = (SHEET_HEIGHT - pointAt(points, snap)) * 100;
  return `${Number(hidden.toFixed(4))}dvh`;
}

/** The snap point whose coverage is closest to `visible`. */
function nearestSnap(points: readonly number[], visible: number): SheetSnap {
  let best: SheetSnap = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(point - visible);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index as SheetSnap;
    }
  });
  return best;
}
