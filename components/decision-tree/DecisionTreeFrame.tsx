"use client";

import { Suspense, useState, type ReactNode } from "react";

import { DecisionTree } from "./DecisionTree";
import { DecisionTreeSkeleton } from "./DecisionTreeSkeleton";
import type { LoadLocalBike } from "./Summary";
import type { TreeIllustrations } from "./tree-illustrations";

export interface DecisionTreeFrameProps {
  /**
   * The landing heading, **already rendered by the server**
   * (`<DecisionTreeHero />` in `app/[locale]/page.tsx`). A node, not a
   * component: it has to be created outside this boundary to stay out of it.
   */
  hero: ReactNode;
  /** Every drawing the tree can show (`renderTreeIllustrations()`). */
  illustrations: TreeIllustrations;
  /** Injection point for tests (see `Summary`). */
  loadLocalBike?: LoadLocalBike;
}

/**
 * The home page's tree block: the landing heading, then the tree itself behind
 * the `<Suspense>` boundary its `useSearchParams` needs.
 *
 * **Why the heading is here and not inside the tree.** The tree reads the query
 * string, so on a static route it renders only on the client, under a boundary
 * whose fallback is the prerendered skeleton. React throws the fallback's DOM
 * away when the real tree arrives — and the heading's paragraph is the page's
 * LCP element. Re-creating it makes Chrome report a second, later LCP candidate
 * (the new node paints with the web font, the first paint used the fallback
 * font, so it measures marginally larger and wins), which is why the home page
 * scored LCP 3.6 s on a 1.7 s FCP while every other page had LCP == FCP. Kept
 * above the boundary, the node is painted once and never touched: `.debug/007`.
 *
 * The heading still has to disappear once an answer exists — from then on the
 * question itself is the `<h1>`, and two `<h1>`s would be wrong. The tree knows
 * which screen it is on and reports it (`onIntroChange`), exactly as before:
 * on a deep link the visitor saw the heading during the skeleton and lost it
 * when the tree arrived, and that is still what happens.
 */
export function DecisionTreeFrame({
  hero,
  illustrations,
  loadLocalBike,
}: DecisionTreeFrameProps): React.JSX.Element {
  // The server has no query string, so it renders the landing screen; a deep
  // link corrects this on the tree's first effect, as the skeleton used to.
  const [intro, setIntro] = useState(true);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12">
      {intro ? hero : null}
      <Suspense fallback={<DecisionTreeSkeleton />}>
        <DecisionTree
          illustrations={illustrations}
          loadLocalBike={loadLocalBike}
          onIntroChange={setIntro}
        />
      </Suspense>
    </div>
  );
}
