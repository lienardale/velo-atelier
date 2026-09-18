import { useTranslations } from "next-intl";

/**
 * The landing heading of the home page: the site's promise as the `<h1>` and
 * one paragraph on how the questions work.
 *
 * Shown while the visitor has not answered anything. Once the first answer is
 * given, the question title becomes the `<h1>` and this block steps aside —
 * `DecisionTreeFrame` drops it, on the report of the client tree.
 *
 * **It is rendered by the SERVER, above the tree's `<Suspense>` boundary**
 * (`app/[locale]/page.tsx` → `DecisionTreeFrame hero=`), and that placement is
 * load-bearing, not cosmetic: its paragraph is the home page's LCP element, and
 * a node inside the boundary is destroyed and re-created when the fallback
 * gives way to the hydrated tree. Chrome counts the re-created node as a NEW
 * largest-contentful-paint candidate — one painted with the web font, where the
 * first paint used the metric-adjusted fallback, so it measures a hair larger
 * and wins. That is the whole of `.debug/005`: LCP 3.6 s with a 1.7 s FCP,
 * 96 % "render delay", on a page whose LCP text was in the first 10 kB of HTML.
 * Outside the boundary the node is never re-created, Chrome reports it once,
 * and LCP == FCP as on every other page of the site.
 *
 * Shared (no `"use client"`): a server component, and the frame that hides it
 * receives it as an already-rendered node.
 */
export function DecisionTreeHero(): React.JSX.Element {
  const common = useTranslations("common");
  const tree = useTranslations("decision-tree");
  return (
    <header className="flex flex-col gap-3" data-testid="home-hero">
      <p className="text-sm font-semibold tracking-wide text-accent uppercase">
        {tree("home.eyebrow")}
      </p>
      <h1 className="max-w-3xl text-3xl font-semibold sm:text-5xl">{common("site.tagline")}</h1>
      <p className="max-w-2xl text-base text-ink-muted sm:text-lg">{tree("home.intro")}</p>
    </header>
  );
}

/**
 * What the home page shows before the client tree takes over (§6.2: the
 * `<Suspense>` fallback, so `/[locale]` prerenders as a static shell even though
 * the tree reads the query string). Same rhythm as the real first screen, so
 * nothing jumps when it swaps in (CLS ≤ 0.1, §6.8 AC9).
 *
 * The heading is NOT here: `DecisionTreeFrame` renders it above this boundary,
 * so the page's `<h1>` and its paragraph are in the prerendered HTML and are
 * never destroyed by the swap (see `DecisionTreeHero`). This is the body only.
 */
export function DecisionTreeSkeleton(): React.JSX.Element {
  const tree = useTranslations("decision-tree");
  return (
    <section
      aria-busy="true"
      data-testid="decision-tree-skeleton"
      className="flex w-full flex-col gap-6"
    >
      <p className="sr-only" role="status">
        {tree("tree.loading")}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="h-5 w-16 rounded bg-paper-2" />
          <div className="h-1.5 w-full rounded-full bg-rule" />
        </div>
        <div className="h-8 w-3/4 max-w-lg rounded bg-paper-2" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="h-28 rounded-lg border border-rule bg-paper-2/60" />
          <div className="h-28 rounded-lg border border-rule bg-paper-2/60" />
        </div>
        <div className="h-11 w-40 rounded-md bg-paper-2" />
      </div>
    </section>
  );
}
