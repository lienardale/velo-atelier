import type { Namespace } from "./namespaces";

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

  /**
   * `/acheter`. The three client islands — the part panel, the free-text
   * search and the vendor buttons under both — read `shop` and nothing else:
   * part, attribute and value names are resolved by `lib/domain/i18n.ts` with
   * an explicit locale, the same way the search query itself is assembled, so
   * this route never has to declare the `parts` catalogue.
   */
  "app/[locale]/acheter/page.tsx": ["shop"],

  "app/[locale]/guides/page.tsx": ["common", "guides", "parts"],
  "app/[locale]/guides/[slug]/page.tsx": ["common", "guides", "illustrations", "parts"],

  /**
   * Sign-in and sign-up: the forms' own strings (`auth`) and the message KEYS
   * their server actions return (`errors.*`, `auth.password.*`), which
   * `components/auth/form-parts.tsx` resolves inside exactly those two
   * namespaces (`translateScopedKey`) instead of with a root translator.
   */
  "app/[locale]/(auth)/connexion/page.tsx": ["auth", "errors"],
  "app/[locale]/(auth)/inscription/page.tsx": ["auth", "errors"],

  /**
   * `/compte`, `/mes-velos` and `/import`, which share this layout's provider:
   * the account forms (`account`, `auth`, `common`, `errors` — through
   * `form-parts.tsx`), the garage's `BikeCard` (`bike`, with its rename and
   * delete errors resolved by `useBikeActionText`) and the guest import
   * (`account`, `errors`).
   */
  "app/[locale]/(protected)/layout.tsx": ["account", "auth", "bike", "common", "errors"],

  /**
   * The workspace family — `/velo/[id]`, its part deep link and `/reglages` —
   * plus the segment's `error.tsx`, all under the layout's provider. The panel
   * resolves the part catalogue's keys through `usePartsText` (`parts.attr.*`)
   * and a write's answer through `useBikeActionText` (`bike.errors.*`,
   * `errors.*`); nothing here reads the checkup's, the list's or the shop's
   * namespaces, so those stay off the page the site's Lighthouse gate measures.
   */
  "app/[locale]/velo/[id]/layout.tsx": ["bike", "bike3d", "common", "errors", "parts"],

  /**
   * The checkup mounts its own provider: the wizard reads its chrome
   * (`checkup`), the tools checklist (`tools`), the reasons (`guides`) and part
   * names (`parts`) — none of which the rest of the segment needs.
   */
  "app/[locale]/velo/[id]/controle/page.tsx": ["checkup", "guides", "parts", "tools"],

  /**
   * The build list mounts its own provider: its chrome, refinement form and
   * vendor links (`shop`), and the two kinds of key a line carries at runtime —
   * the finding's reason (`guides.reasons.*`) and a compatibility issue
   * (`rules.<group>.*`) — read through `useListText()`
   * (`components/build-list/list-text.ts`), not a root translator.
   */
  "app/[locale]/velo/[id]/liste/page.tsx": ["guides", "rules", "shop"],

  /** The dev harness: the viewer (`bike3d`) and the part names it lists (`parts`). */
  "app/[locale]/dev/bike3d/page.tsx": ["bike3d", "parts"],
  "app/[locale]/dev/bike3d-perf/page.tsx": ["bike3d", "parts"],
} as const satisfies Record<string, readonly Namespace[]>;

/** A route key of {@link CLIENT_NAMESPACES}. */
export type ClientNamespaceRoute = keyof typeof CLIENT_NAMESPACES;
