"use client";

import dynamic from "next/dynamic";

/**
 * The one toast host, mounted by the locale layout.
 *
 * **Lazily, on purpose.** The layout wraps every route, so anything it imports
 * statically lands in every route's first-load JS — and sonner is ~10 kB gzip,
 * measured across all six budgeted routes at the W2 integration. That is a poor
 * trade for a host that renders nothing until something raises a notice: the
 * home page is already 56 kB above its target (`docs/backlog.md`).
 *
 * `ssr: false` because a toast host has nothing to contribute to the HTML —
 * there is no notice to show on a fresh document, only after an interaction.
 * Callers reach the same instance through sonner's module-level store, which is
 * why `toast()` is imported dynamically at its call sites too: a static import
 * there would pull the library back into that route's first load.
 */
const Toaster = dynamic(() => import("sonner").then((module) => module.Toaster), { ssr: false });

export function Notices(): React.JSX.Element {
  return <Toaster position="bottom-center" closeButton richColors />;
}
