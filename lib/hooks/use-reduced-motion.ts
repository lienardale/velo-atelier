"use client";

import { MEDIA, useMediaQuery } from "./use-media";

/** How fast a transition runs, named after the motion tokens in `styles/globals.css`. */
export type MotionSpeed = "fast" | "base" | "slow";

/**
 * `true` when the user asked their operating system for reduced motion.
 *
 * Most components need nothing more than the CSS: `styles/globals.css` sets
 * `--motion-*` to `0ms` inside `@media (prefers-reduced-motion: reduce)`, so a
 * transition written against those tokens stops on its own. This hook is for
 * the cases where JavaScript has to know too — a component that would otherwise
 * wait for a `transitionend`, or one whose duration must be *observable*
 * (`MobileSheet` publishes `--sheet-duration`, and its test asserts `0ms`).
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(MEDIA.reducedMotion);
}

/**
 * The CSS duration to animate with: a motion token normally, and a literal
 * `0ms` when motion is reduced.
 *
 * Pure, so a component can be tested at both settings without a DOM.
 */
export function motionDuration(reduced: boolean, speed: MotionSpeed = "base"): string {
  if (reduced) return "0ms";
  if (speed === "fast") return "var(--motion-fast)";
  if (speed === "slow") return "var(--motion-slow)";
  return "var(--motion-base)";
}

/** `motionDuration()` bound to the user's current preference. */
export function useMotionDuration(speed: MotionSpeed = "base"): string {
  return motionDuration(useReducedMotion(), speed);
}
