import { useTranslations } from "next-intl";

/**
 * The landing heading of the home page: the site's promise as the `<h1>` and
 * one paragraph on how the questions work.
 *
 * Shown while the visitor has not answered anything. Once the first answer is
 * given, the question title becomes the `<h1>` and this block steps aside —
 * `DecisionTreeFrame` drops it, on the report of the tree.
 *
 * **It is rendered by the SERVER** (`app/[locale]/page.tsx` →
 * `DecisionTreeFrame hero=`), and that is load-bearing twice over.
 *
 * Its paragraph is the home page's LCP element. `.debug/007` is what happened
 * when that node lived inside the tree's `<Suspense>` boundary and the
 * fallback-to-content swap re-created it: Chrome counted the re-created node as
 * a NEW largest-contentful-paint candidate — one painted with the web font,
 * where the first paint used the metric-adjusted fallback, so it measured a
 * hair larger and won — and the page scored LCP 3.6 s on a 1.7 s FCP, 96 %
 * "render delay", with its LCP text in the first 10 kB of HTML. That boundary
 * is gone (`.debug/011`), but the property it cost so much to establish is kept
 * on purpose: created outside `DecisionTreeFrame`, this node is one React never
 * re-renders, whatever the tree below it does.
 *
 * And it has no `"use client"`: rendered from the page it is server code, so
 * none of it reaches the browser's JavaScript. `/[locale]` is the tightest
 * first-load budget on the site (`perf.budgets.json`).
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
