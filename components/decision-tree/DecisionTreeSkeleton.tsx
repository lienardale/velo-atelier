import { useTranslations } from "next-intl";

/**
 * The landing heading of the home page: the site's promise as the `<h1>` and
 * one paragraph on how the questions work.
 *
 * Shown while the visitor has not answered anything (first question on screen)
 * and in the static skeleton, so the prerendered HTML already carries the
 * page's real heading. Once the first answer is given, the question title
 * becomes the `<h1>` (`DecisionTree`), and this block steps aside.
 *
 * Shared (no `"use client"`): rendered by the server inside the skeleton and by
 * the client tree.
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
 * the tree reads the query string). Same outer box and rhythm as the real
 * first screen, so nothing jumps when it swaps in (CLS ≤ 0.1, §6.8 AC9).
 */
export function DecisionTreeSkeleton(): React.JSX.Element {
  const tree = useTranslations("decision-tree");
  return (
    <section
      aria-busy="true"
      data-testid="decision-tree-skeleton"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12"
    >
      <DecisionTreeHero />
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
