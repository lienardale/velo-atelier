/**
 * Leave this document for `url`, replacing it in the history — a FULL
 * navigation, never the App Router's.
 *
 * The wizard uses it once: to hand a run in progress over to the full checkup
 * (`?resume=full`) when the page's scope cannot hold it (`.debug/017` §5.10).
 * The first version used the App Router's `router.replace`: in Chromium 153
 * the new page's flight answered 200, and the wizard stayed on its "Reprise du
 * contrôle en cours…" line under the OLD header, the address never changing
 * (`tests/e2e/guest-import.spec.ts`, 4 runs of 4, both projects; why the soft
 * navigation did not commit was not found). Had it committed, the same wizard
 * would have been handed the full plan with its state from the narrower page.
 * A fresh document plans the full checkup and mounts a fresh wizard, which is
 * all this needs; the cost is one page load, on a path a visitor takes
 * rarely.
 *
 * Its own module so a test can see where the wizard went: jsdom does not
 * navigate, and `window.location` cannot be spied on.
 */
export function replaceDocument(url: string): void {
  window.location.replace(url);
}
