/**
 * `DecisionTreeFrame` — the home page's composition of the landing heading and
 * the suspended tree.
 *
 * The heading is the page's LCP element and it must be rendered OUTSIDE the
 * tree's `<Suspense>` boundary, because React throws the fallback's DOM away
 * when the hydrated tree replaces it and Chrome reports the re-created node as
 * a new, much later LCP candidate (`.debug/005`). These tests pin the two
 * user-visible halves of that arrangement: the heading is on the landing
 * screen, in both locales, and it steps aside — leaving exactly one `<h1>` —
 * as soon as the question itself becomes the `<h1>`.
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import enCommon from "@/messages/en/common.json";
import enDecision from "@/messages/en/decision.json";
import frCommon from "@/messages/fr/common.json";
import frDecision from "@/messages/fr/decision.json";
import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { DecisionTreeFrame } from "./DecisionTreeFrame";
import { DecisionTreeHero } from "./DecisionTreeSkeleton";
import { renderTreeIllustrations } from "./tree-illustrations";

const GRAVEL_AT_BRAKES = "drive=muscular&discipline=gravel&wheel-size=700c&step=brake-type";

function go(search: string) {
  window.history.replaceState(null, "", `/fr${search ? `?${search}` : ""}`);
  setNavigationState({ pathname: "/", search });
}

async function renderFrame(search = "", locale: "fr" | "en" = "fr") {
  go(search);
  return renderWithIntl(
    <DecisionTreeFrame hero={<DecisionTreeHero />} illustrations={renderTreeIllustrations()} />,
    { locale },
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  setNavigationState({ search: "" });
});

describe("DecisionTreeFrame", () => {
  it("shows the landing heading as the only h1 on the first screen (fr)", async () => {
    await renderFrame();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(frCommon.site.tagline);
    // The first question is asked under it, not as a second h1.
    expect(screen.getByRole("heading", { level: 2, name: frDecision.drive.title })).toBeVisible();
  });

  it("shows the landing heading as the only h1 on the first screen (en)", async () => {
    await renderFrame("", "en");
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(enCommon.site.tagline);
    expect(screen.getByRole("heading", { level: 2, name: enDecision.drive.title })).toBeVisible();
  });

  it("drops the landing heading once a question is the h1", async () => {
    await renderFrame(GRAVEL_AT_BRAKES);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(frDecision["brake-type"].title);
    expect(screen.queryByTestId("home-hero")).toBeNull();
  });

  it("brings the landing heading back when the visitor goes back to the first question", async () => {
    const { user } = await renderFrame(GRAVEL_AT_BRAKES);
    expect(screen.queryByTestId("home-hero")).toBeNull();

    // Editing the first answer puts the tree back on the landing screen.
    go("");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await user.click(screen.getAllByRole("radio")[0]);
    expect(screen.getByTestId("home-hero")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
