import { NAMESPACES, type Namespace } from "./namespaces";

/**
 * What each route sends to the BROWSER, keyed by the file that mounts the
 * provider (`components/i18n/ClientMessages.tsx`).
 *
 * The key is the path of the file that reads it — `app/[locale]/page.tsx` reads
 * `CLIENT_NAMESPACES["app/[locale]/page.tsx"]` and nothing else. Keying the
 * table by its call site is what stops the table and the code from drifting:
 * `tests/unit/i18n/client-namespaces.test.ts` checks that every key is a real
 * file, that the file reads its own entry, and — the point of the exercise —
 * that the entry covers every namespace the client components reachable from
 * that route can read.
 *
 * **Where a provider goes.** The locale layout mounts one for the site shell
 * (header, footer, skip link, and the `error.tsx` / `not-found.tsx` boundaries
 * that render inside it). Below that, a provider goes on the segment layout
 * when the segment has one — `velo/[id]` and `(protected)` do, and their
 * `error.tsx` renders inside it — and otherwise on the page itself, wrapping
 * everything the page returns. A route with no entry here inherits the nearest
 * one above it, which the test resolves the same way.
 *
 * **Adding a namespace to a route is not a formality.** The provider REPLACES
 * what the layout gave (next-intl never merges), so a client component whose
 * namespace is missing renders its keys instead of its text. That is what the
 * test exists to prevent — it fails with the exact list to write here.
 */
export const CLIENT_NAMESPACES = {
  /**
   * The site shell: `SiteHeader` (`common`) with `AccountMenu` (`auth.menu`),
   * `LocaleSwitcher` and `SkipLink` (`common`), `SiteFooter` (`common`), and
   * `app/[locale]/error.tsx` / `not-found.tsx`, which render inside it.
   */
  "app/[locale]/layout.tsx": ["auth", "common"],

  /**
   * Home. The decision tree reads the questions and options it walks
   * (`decision`, through `useDecisionText`), its own chrome (`decision-tree`),
   * the drawings' accessible names (`illustrations`, in `TreeDrawing`) and
   * `common` for the document title.
   */
  "app/[locale]/page.tsx": ["common", "decision", "decision-tree", "illustrations"],

  "app/[locale]/guides/page.tsx": ["common", "guides", "parts"],
  "app/[locale]/guides/[slug]/page.tsx": ["common", "guides", "illustrations", "parts"],

  /**
   * Everything, and the test says why: `components/auth/form-parts.tsx` reads
   * the catalogue with no namespace — a server action returns a message KEY
   * (§4.3) and `translateMessageKey` resolves it, so the key that arrives
   * decides which namespace is read, at runtime. Until those keys are pinned to
   * a namespace the way `useDecisionText` pins the tree's, the honest
   * declaration for these routes is the whole catalogue.
   */
  "app/[locale]/(auth)/connexion/page.tsx": NAMESPACES,
  "app/[locale]/(auth)/inscription/page.tsx": NAMESPACES,

  /**
   * `/compte` and `/mes-velos`. Same reason, through `form-parts.tsx` and
   * `components/account/BikeCard.tsx` (`tRoot(…)` over `parts.*` keys the part
   * catalogue carries).
   */
  "app/[locale]/(protected)/layout.tsx": NAMESPACES,

  /**
   * The workspace and its sub-routes, including their shared `error.tsx`. Same
   * reason again: `PartInfo`, `PartEditForm`, `MeasureCard` and
   * `MeasurementForm` translate `parts.*` keys that the part definitions carry.
   */
  "app/[locale]/velo/[id]/layout.tsx": NAMESPACES,

  "app/[locale]/dev/bike3d/page.tsx": NAMESPACES,
  "app/[locale]/dev/bike3d-perf/page.tsx": NAMESPACES,
} as const satisfies Record<string, readonly Namespace[]>;

/** A route key of {@link CLIENT_NAMESPACES}. */
export type ClientNamespaceRoute = keyof typeof CLIENT_NAMESPACES;
