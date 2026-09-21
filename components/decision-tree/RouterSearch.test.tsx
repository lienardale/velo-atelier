/**
 * `RouterSearch` — the decision tree's one remaining `useSearchParams`
 * consumer, and the reason `/[locale]` can still be prerendered whole
 * (`.debug/011`).
 *
 * Two things make it work, and both are here: it stays silent about the query
 * the page loaded with — which `useLocationSearch()` already reads, and which
 * would otherwise make a deep link look like a navigation and steal the focus
 * — and it speaks up when the router moves without a `popstate`, which is what
 * a soft navigation to `<Link href="/">` from a tree URL is.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setNavigationState } from "@/tests/_fakes/session";

import { RouterSearch } from "./RouterSearch";

afterEach(() => {
  setNavigationState({ search: "" });
});

describe("RouterSearch", () => {
  it("renders nothing, so its <Suspense> fallback discards nothing", () => {
    setNavigationState({ search: "drive=muscular" });
    const { container } = render(<RouterSearch onNavigate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing about the query the page loaded with", () => {
    setNavigationState({ search: "drive=muscular&step=discipline" });
    const onNavigate = vi.fn();
    render(<RouterSearch onNavigate={onNavigate} />);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("reports a router navigation that changed the query", () => {
    setNavigationState({ search: "drive=muscular&step=discipline" });
    const onNavigate = vi.fn();
    const { rerender } = render(<RouterSearch onNavigate={onNavigate} />);

    setNavigationState({ search: "" });
    rerender(<RouterSearch onNavigate={onNavigate} />);
    expect(onNavigate).toHaveBeenCalledTimes(1);

    // And only once per move: a re-render on the same URL is not a navigation.
    rerender(<RouterSearch onNavigate={onNavigate} />);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
