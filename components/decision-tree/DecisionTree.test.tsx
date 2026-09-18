/* eslint-disable security/detect-object-injection -- lookups into our own message catalogues by literal test ids */
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import frCommon from "@/messages/fr/common.json";
import frDecision from "@/messages/fr/decision.json";
import frTree from "@/messages/fr/decision-tree.json";
import enDecision from "@/messages/en/decision.json";
import { disclosureStorageKey } from "@/components/ui-ext/Disclosure";
import { DECISION_HELP_PERSIST_KEY } from "@/lib/bike/storage-keys";
import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { DecisionTreeFrame } from "./DecisionTreeFrame";
import { DecisionTreeHero } from "./DecisionTreeSkeleton";
import type { LoadLocalBike } from "./Summary";
import { renderTreeIllustrations } from "./tree-illustrations";

const HOME_TITLE = `${frCommon.site.name} — ${frCommon.site.tagline}`;
const GRAVEL_AT_BRAKES = "drive=muscular&discipline=gravel&wheel-size=700c&step=brake-type";

function go(search: string) {
  window.history.replaceState(null, "", `/fr${search ? `?${search}` : ""}`);
  setNavigationState({ pathname: "/", search });
}

/**
 * The tree as the home page composes it: `DecisionTreeFrame` around the tree,
 * with the landing heading passed in as the already-rendered node the server
 * gives it. Rendering the frame rather than `DecisionTree` alone is what keeps
 * the heading assertions below honest — the `<h1>` lives above the tree's
 * `<Suspense>` boundary now (`.debug/005`), and the tree only reports which
 * screen it is on.
 */
async function renderTree(
  search = "",
  options: { locale?: "fr" | "en"; loadLocalBike?: LoadLocalBike } = {},
) {
  go(search);
  return renderWithIntl(
    <DecisionTreeFrame
      hero={<DecisionTreeHero />}
      illustrations={renderTreeIllustrations()}
      loadLocalBike={options.loadLocalBike}
    />,
    { locale: options.locale },
  );
}

const currentQuery = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  window.localStorage.clear();
  document.title = HOME_TITLE;
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  setNavigationState({ search: "" });
  vi.restoreAllMocks();
});

describe("DecisionTree — first screen", () => {
  it("keeps the site's promise as the h1 and asks the first question under it", async () => {
    await renderTree();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(frCommon.site.tagline);
    expect(screen.getByRole("heading", { level: 2, name: frDecision.drive.title })).toBeVisible();
    expect(screen.getByRole("radiogroup", { name: frDecision.drive.title })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    // Nothing is focused on page load, and the title is the home page's own.
    expect(document.body).toHaveFocus();
    expect(document.title).toBe(HOME_TITLE);
    expect(screen.getByRole("link", { name: frTree.actions.skipToDemo })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/velo\/demo$/),
    );
  });

  it("does not offer 'previous question' on the first question", async () => {
    await renderTree();
    expect(screen.queryByRole("button", { name: frTree.actions.back })).toBeNull();
  });

  it("ignores unrelated and invalid query parameters (step=2, parts=chain)", async () => {
    await renderTree("parts=chain&step=2");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(frDecision.drive.title);
  });
});

describe("DecisionTree — URL state", () => {
  it("restores step 4 with three answers from the URL", async () => {
    await renderTree(GRAVEL_AT_BRAKES);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      frDecision["brake-type"].title,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByTestId("question-step")).toHaveAttribute("data-question", "brake-type");
    expect(document.title).toBe(`${frDecision["brake-type"].title} · vélo-atelier`);
  });

  it("clamps a step beyond the next question to the next question", async () => {
    await renderTree("drive=muscular&step=pedals");
    expect(screen.getByTestId("question-step")).toHaveAttribute("data-question", "discipline");
  });

  it("answers with pushState, moves focus to the new h1 and updates the title", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const { user } = await renderTree();
    await user.click(screen.getByRole("radio", { name: /Électrique/ }));
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toEqual({ vaTreeDepth: 1 });
    expect(window.location.search).toBe("?drive=electric&step=discipline");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(frDecision.discipline.title);
    expect(heading).toHaveFocus();
    expect(document.title).toBe(`${frDecision.discipline.title} · vélo-atelier`);
  });

  it("keeps foreign parameters when writing the URL", async () => {
    const { user } = await renderTree("utm_source=newsletter");
    await user.click(screen.getByRole("radio", { name: /Musculaire/ }));
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));
    expect(currentQuery().get("utm_source")).toBe("newsletter");
    expect(currentQuery().get("drive")).toBe("muscular");
  });

  it("asks for an answer instead of continuing with none", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const { user } = await renderTree();
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(frTree.actions.chooseFirst);
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(frTree.actions.chooseFirst);
    await user.click(screen.getAllByRole("radio")[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["gravel", "disc-hydraulic~", null],
    ["city-hybrid", "v-brake~", "Ville ou VTC"],
  ])(
    "'Je ne sais pas' on brake-type for %s yields %s, explained, without advancing",
    async (discipline, expected, context) => {
      const push = vi.spyOn(window.history, "pushState");
      const size = discipline === "gravel" ? "700c" : "26";
      const { user } = await renderTree(
        `drive=muscular&discipline=${discipline}&wheel-size=${size}&step=brake-type`,
      );
      await user.click(screen.getByRole("button", { name: frTree.actions.dontKnow }));

      expect(push).not.toHaveBeenCalled();
      const callout = screen.getByTestId("default-callout");
      expect(callout).toHaveAttribute("role", "status");
      const option = expected.replace("~", "") as "disc-hydraulic" | "v-brake";
      expect(callout).toHaveTextContent(frDecision["brake-type"].options[option].label);
      if (context) expect(callout).toHaveTextContent(context);
      else expect(callout).toHaveTextContent("C’est le cas le plus courant.");
      expect(screen.getByRole("radio", { checked: true })).toHaveAttribute(
        "data-option-id",
        option,
      );

      await user.click(screen.getByRole("button", { name: frTree.actions.continue }));
      expect(currentQuery().get("brake-type")).toBe(expected);
      expect(window.location.search).toContain(`brake-type=${expected}`);
    },
  );

  it("drops the guessed flag when the visitor then picks a card", async () => {
    const { user } = await renderTree(GRAVEL_AT_BRAKES);
    await user.click(screen.getByRole("button", { name: frTree.actions.dontKnow }));
    await user.click(screen.getByRole("radio", { name: /Disque mécanique/ }));
    expect(screen.queryByTestId("default-callout")).toBeNull();
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));
    expect(currentQuery().get("brake-type")).toBe("disc-mechanical");
  });

  it("editing mtb → road with replaceState removes suspension from the URL", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const { user } = await renderTree(
      "drive=muscular&discipline=mtb&wheel-size=29&brake-type=disc-hydraulic&brake-mount=post-mount&cockpit=riser&drivetrain=derailleur-1x&speeds=12&shifter=trigger&pedals=flat&suspension=front&step=discipline",
    );
    replace.mockClear();
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-option-id", "mtb");
    await user.click(screen.getByRole("radio", { name: /^Route/ }));
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(currentQuery().has("suspension")).toBe(false);
    expect(currentQuery().has("wheel-size")).toBe(false);
    expect(currentQuery().get("step")).toBe("wheel-size");
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("goes back through history when the tree wrote the previous entry", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { user } = await renderTree();
    await user.click(screen.getByRole("radio", { name: /Musculaire/ }));
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));
    await user.click(screen.getByRole("button", { name: frTree.actions.back }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("goes back to the previous question in place on a deep link (never leaves the site)", async () => {
    const back = vi.spyOn(window.history, "back");
    const { user } = await renderTree(GRAVEL_AT_BRAKES);
    await user.click(screen.getByRole("button", { name: frTree.actions.back }));
    expect(back).not.toHaveBeenCalled();
    expect(currentQuery().get("step")).toBe("wheel-size");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-option-id", "700c");
  });

  it("follows the browser's back and forward buttons (popstate)", async () => {
    await renderTree(GRAVEL_AT_BRAKES);
    act(() => {
      window.history.replaceState(null, "", "/fr?drive=electric");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(frDecision.discipline.title);
    expect(heading).toHaveFocus();
  });

  it("puts the question title back when the metadata rewrites <title> later", async () => {
    await renderTree(GRAVEL_AT_BRAKES);
    const wanted = `${frDecision["brake-type"].title} · vélo-atelier`;
    expect(document.title).toBe(wanted);
    // What Next's streamed metadata does after hydration: React rewrites the head's <title>.
    const title =
      document.head.querySelector("title") ??
      document.head.appendChild(document.createElement("title"));
    title.textContent = HOME_TITLE;
    await waitFor(() => expect(document.title).toBe(wanted));
  });

  it("adopts a query changed by a router navigation (header logo → bare home)", async () => {
    const { rerender } = await renderTree(GRAVEL_AT_BRAKES);
    setNavigationState({ search: "" });
    rerender(
      <DecisionTreeFrame hero={<DecisionTreeHero />} illustrations={renderTreeIllustrations()} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(frCommon.site.tagline);
  });

  it("renders the question in English", async () => {
    await renderTree(GRAVEL_AT_BRAKES, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      enDecision["brake-type"].title,
    );
  });
});

describe("DecisionTree — help disclosure", () => {
  it("holds the question's drawing as a named image and its help paragraph", async () => {
    await renderTree(GRAVEL_AT_BRAKES);
    const help = screen.getByTestId("decision-help");
    expect(help.tagName).toBe("DETAILS");
    const images = within(help).getAllByRole("img", { hidden: true });
    expect(images).toHaveLength(1);
    expect(images[0].querySelector("title")?.textContent).toBeTruthy();
    expect(within(help).getByText(frDecision["brake-type"].help).tagName).toBe("P");
    // Option thumbnails are decorative: the radio names come from labels only.
    for (const radio of screen.getAllByRole("radio")) {
      expect(within(radio).queryByRole("img")).toBeNull();
    }
  });

  it("remembers its open state across questions", async () => {
    const { user } = await renderTree("drive=muscular&step=discipline");
    const summary = screen.getByTestId("decision-help").querySelector("summary")!;
    expect(summary.textContent).toBe(frTree.help.summary);
    await user.click(summary);
    expect(window.localStorage.getItem(disclosureStorageKey(DECISION_HELP_PERSIST_KEY))).toBe("1");

    await user.click(screen.getByRole("radio", { name: /^Gravel/ }));
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));
    const next = screen.getByTestId("decision-help");
    expect(next).toHaveAttribute("data-question", "wheel-size");
    expect(next).toHaveAttribute("open");
  });
});

describe("DecisionTree — summary", () => {
  const COMPLETE =
    "drive=muscular&discipline=gravel&wheel-size=700c&brake-type=disc-hydraulic~&brake-mount=flat-mount&cockpit=drop&drivetrain=derailleur-1x&speeds=11&shifter=sti-integrated&pedals=spd~&seatpost=rigid&tire-system=tubeless";

  function fakeLocalBike(existing: boolean, written: unknown = { id: "x" }) {
    const writeLocalBike = vi.fn(() => written);
    const hasLocalBike = vi.fn(() => existing);
    const load = vi.fn(async () => ({ writeLocalBike, hasLocalBike }) as never);
    return { load: load as unknown as LoadLocalBike, writeLocalBike, hasLocalBike };
  }

  it("shows every answer with 'par défaut' badges and focuses its h1 on arrival", async () => {
    const { user } = await renderTree(
      COMPLETE.replace("&tire-system=tubeless", "&step=tire-system"),
    );
    await user.click(screen.getByRole("radio", { name: /Tubeless/ }));
    await user.click(screen.getByRole("button", { name: frTree.actions.continue }));

    const heading = await screen.findByRole("heading", { level: 1, name: frTree.summary.title });
    await waitFor(() => expect(heading).toHaveFocus());
    const table = screen.getByRole("table", { name: frTree.summary.caption });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(12);
    expect(within(table).getAllByTestId("default-badge")).toHaveLength(2);
    const brakes = rows.find((row) => row.dataset.question === "brake-type")!;
    expect(brakes).toHaveTextContent("Disque hydraulique");
    expect(brakes).toHaveTextContent(frTree.summary.defaultBadge);
  });

  it("edits one row with pushState and comes back to that question", async () => {
    const { user } = await renderTree(COMPLETE);
    const edit = await screen.findByRole("button", { name: "Modifier : Pédales" });
    await user.click(edit);
    expect(currentQuery().get("step")).toBe("pedals");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(frDecision.pedals.title);
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-option-id", "spd");
    expect(screen.getByTestId("default-callout")).toBeVisible();
  });

  it("stores the guest bike and opens /velo/local", async () => {
    const { routerSpies } = await import("@/tests/_fakes/session");
    const fake = fakeLocalBike(false);
    const { user } = await renderTree(COMPLETE, { loadLocalBike: fake.load });
    await user.click(await screen.findByRole("button", { name: frTree.summary.generate }));

    await waitFor(() => expect(routerSpies.push).toHaveBeenCalledTimes(1));
    expect(fake.writeLocalBike).toHaveBeenCalledWith({
      answers: expect.objectContaining({ "brake-type": "disc-hydraulic", pedals: "spd" }),
    });
    expect(routerSpies.push).toHaveBeenCalledWith({
      pathname: "/velo/[id]",
      params: { id: "local" },
    });
  });

  it("asks before replacing a bike already stored, and does nothing on cancel", async () => {
    const { routerSpies } = await import("@/tests/_fakes/session");
    const fake = fakeLocalBike(true);
    const { user } = await renderTree(COMPLETE, { loadLocalBike: fake.load });
    await user.click(await screen.findByRole("button", { name: frTree.summary.generate }));

    const dialog = await screen.findByRole("dialog", { name: frTree.summary.replace.title });
    await user.click(within(dialog).getByRole("button", { name: frTree.summary.replace.cancel }));
    expect(fake.writeLocalBike).not.toHaveBeenCalled();
    expect(routerSpies.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: frTree.summary.generate }));
    const again = await screen.findByRole("dialog");
    await user.click(within(again).getByRole("button", { name: frTree.summary.replace.confirm }));
    expect(fake.writeLocalBike).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledTimes(1);
  });

  it("says so when the browser refuses to store the bike", async () => {
    const { routerSpies } = await import("@/tests/_fakes/session");
    const fake = fakeLocalBike(false, null);
    const { user } = await renderTree(COMPLETE, { loadLocalBike: fake.load });
    await user.click(await screen.findByRole("button", { name: frTree.summary.generate }));

    expect(await screen.findByRole("alert")).toHaveTextContent(frTree.summary.storageError);
    expect(routerSpies.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: frTree.summary.generate })).toBeEnabled();
  });

  it("really writes va:bike:local with the default loader", async () => {
    const { user } = await renderTree(COMPLETE);
    await user.click(await screen.findByRole("button", { name: frTree.summary.generate }));
    await waitFor(() => expect(window.localStorage.getItem("va:bike:local")).not.toBeNull());
    const stored = JSON.parse(window.localStorage.getItem("va:bike:local")!) as {
      answers: Record<string, string>;
    };
    expect(stored.answers["brake-type"]).toBe("disc-hydraulic");
  });
});
