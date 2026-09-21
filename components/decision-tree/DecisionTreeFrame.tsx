"use client";

import { useState, type ReactNode } from "react";

import { DecisionTree } from "./DecisionTree";
import type { LoadLocalBike } from "./Summary";
import type { TreeIllustrations } from "./tree-illustrations";

export interface DecisionTreeFrameProps {
  /**
   * The landing heading, **already rendered by the server**
   * (`<DecisionTreeHero />` in `app/[locale]/page.tsx`). A node, not a
   * component: rendering it here would put it in the home page's client
   * bundle, and re-rendering it is the one thing the LCP element must never do.
   */
  hero: ReactNode;
  /** Every drawing the tree can show (`renderTreeIllustrations()`). */
  illustrations: TreeIllustrations;
  /** Injection point for tests (see `Summary`). */
  loadLocalBike?: LoadLocalBike;
}

/**
 * The home page's tree block: the landing heading, then the tree itself.
 *
 * **There is no `<Suspense>` boundary here, and that is the point.** The tree
 * used to read the query string during render, which on a static route forces
 * one: React prerenders the boundary's fallback, throws its DOM away when the
 * real subtree arrives, and builds that subtree on the client rather than
 * hydrating it. On the home page that second render was a long task of its own
 * — the 7 % `/fr` and `/en` were over their 300 ms TBT budget by, measured in
 * `.debug/008` and removed in `.debug/011`. The tree now reads the URL on
 * mount, so the whole thing is prerendered into the document and hydrated once.
 *
 * **Why the heading is still a prop.** Two reasons, and neither of them was the
 * fallback swap. `DecisionTreeHero` has no `"use client"`: rendered from the
 * page it is server code and ships no JavaScript, and `/[locale]` is the
 * tightest first-load budget on the site. And it is the page's LCP element —
 * `.debug/007` is what happens when that node is re-created after paint — so
 * keeping it a node created outside this component means no re-render here can
 * touch it, whatever the tree below is doing.
 *
 * The heading still has to disappear once an answer exists — from then on the
 * question itself is the `<h1>`, and two `<h1>`s would be wrong. The tree knows
 * which screen it is on and reports it (`onIntroChange`): on a deep link the
 * visitor sees the landing screen until the tree adopts the URL, and loses the
 * heading then.
 */
export function DecisionTreeFrame({
  hero,
  illustrations,
  loadLocalBike,
}: DecisionTreeFrameProps): React.JSX.Element {
  // The server has no query string, so it renders the landing screen; a deep
  // link corrects this on the tree's first effect.
  const [intro, setIntro] = useState(true);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12">
      {intro ? hero : null}
      <DecisionTree
        illustrations={illustrations}
        loadLocalBike={loadLocalBike}
        onIntroChange={setIntro}
      />
    </div>
  );
}
