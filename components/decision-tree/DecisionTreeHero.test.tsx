/**
 * `DecisionTreeHero` — the home page's landing heading.
 *
 * Until `.debug/011` this file was `DecisionTreeSkeleton.test.tsx` and its
 * sharpest test said the heading is NOT in the tree's `<Suspense>` fallback,
 * because React destroys a fallback's DOM when the real subtree arrives and
 * Chrome reports the re-created LCP node as a second, much later candidate
 * (`.debug/007`). There is no boundary and no fallback any more — the tree is
 * prerendered and hydrated — so that test has no subject. What replaced it is
 * in `tests/e2e/decision-tree.spec.ts`: the home DOCUMENT itself must carry
 * this heading and the tree's first question, with no skeleton between them.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import frTree from "@/messages/fr/decision-tree.json";
import enTree from "@/messages/en/decision-tree.json";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { DecisionTreeHero } from "./DecisionTreeHero";

describe("DecisionTreeHero", () => {
  it("is the page's real h1 and its intro paragraph", async () => {
    await renderWithIntl(<DecisionTreeHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(frCommon.site.tagline);
    expect(screen.getByTestId("home-hero")).toHaveTextContent(frTree.home.intro);
  });

  it("speaks English", async () => {
    await renderWithIntl(<DecisionTreeHero />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(enCommon.site.tagline);
    expect(screen.getByTestId("home-hero")).toHaveTextContent(enTree.home.intro);
  });
});
