"use client";

import dynamic from "next/dynamic";

type Toast = (typeof import("sonner"))["toast"];

/**
 * sonner's `toast`, kept from the moment the host's own chunk arrives — see
 * {@link loadToast}.
 */
let hostToast: Toast | null = null;

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
const Toaster = dynamic(
  () =>
    import("sonner").then((module) => {
      hostToast = module.toast;
      return module.Toaster;
    }),
  { ssr: false },
);

export function Notices(): React.JSX.Element {
  return <Toaster position="bottom-center" closeButton richColors />;
}

/**
 * sonner's `toast`, for a notice that has to be raised when the network may
 * be DOWN — "this was not saved" is first of all what a lost connection ends
 * in.
 *
 * An `import("sonner")` at the call site is not that: the bundler gives each
 * dynamic import its own chunk, and the one a page's component asks for is NOT
 * the one this host loaded. `components/bike/PartEditForm.tsx` raised its "not
 * saved" notice that way until 2026-10-09, and offline the visitor was told
 * nothing: `Failed to load chunk`, unhandled (measured in Chromium 153,
 * `.debug/017` §5.8, "Review of the fix"). Once the host is on the page — a
 * moment after hydration, on every route — this answers from memory and no
 * request is made.
 *
 * KEEPING what the host's import resolved to is the whole of it. The import
 * two lines below, in this very module, is still a request when the network
 * is down: with `hostToast` never assigned, the offline cases of
 * `tests/e2e/part-panel.spec.ts` fail again (measured) — and every jsdom test
 * passes, a mocked module being always importable.
 *
 * So before the host has loaded this falls back to that import, and REJECTS
 * when sonner cannot be had at all: a caller has to say it some other way.
 */
export function loadToast(): Promise<Toast> {
  if (hostToast !== null) return Promise.resolve(hostToast);
  return import("sonner").then((module) => module.toast);
}
