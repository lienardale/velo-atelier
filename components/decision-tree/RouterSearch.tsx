"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export interface RouterSearchProps {
  /**
   * Called when the router's query string CHANGES. Never on mount: the query
   * the page loaded with is the one `useLocationSearch()` already reads, and
   * reporting it again would make a deep link's arrival look like a move the
   * visitor made — which would steal the focus on load.
   */
  onNavigate: () => void;
}

/**
 * Watches the router's query string and reports that it moved. Renders nothing.
 *
 * **Why this exists at all.** `DecisionTree` used to call `useSearchParams()`
 * during its own render, which on a static route means the whole tree sits
 * under a `<Suspense>` boundary: React prerenders the fallback, throws its DOM
 * away on arrival and BUILDS the tree on the client instead of hydrating it.
 * That second client render was the home page's extra long task and the 7 % it
 * was over the TBT budget by (`.debug/008`, fixed in `.debug/011`). The tree
 * reads `window.location` instead now, and follows `popstate`.
 *
 * That leaves exactly one case those two do not cover: a **router navigation
 * that changes the query without leaving the route** — the header logo, which
 * is `<Link href="/">`, clicked from `/fr?drive=…&step=discipline`. The App
 * Router writes that URL with `history.pushState`, which fires no `popstate`,
 * so without this the tree would go on showing question 2 under a URL that says
 * nothing about it.
 *
 * So one `useSearchParams` consumer survives, reduced to what it is for: a
 * subscription. It renders `null`, so the `<Suspense>` boundary it needs has an
 * empty fallback — what React discards and re-renders on the client is nothing
 * at all, which is the entire difference between this and where we started.
 */
export function RouterSearch({ onNavigate }: RouterSearchProps): null {
  const search = useSearchParams().toString();
  const reported = useRef(search);

  useEffect(() => {
    if (search === reported.current) return;
    reported.current = search;
    onNavigate();
  }, [search, onNavigate]);

  return null;
}
