/**
 * The `?part=` panel of `/acheter` (§5.5).
 *
 * `/acheter` is prerendered, so this panel is the browser's half of the page:
 * it reads the URL, asks the part's own questions, and folds every answer into
 * the query the three shops receive. The URL is untrusted input like any other,
 * which is most of what is checked here.
 */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { outboundUrl } from "@/lib/shop/outbound";
import { BRAND_TIER_KEY, partQuestions } from "@/lib/shop/questions";
import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { PartQuestions, typedValue } from "./PartQuestions";

const BRANDS = {
  chain: {
    note: "Choisissez d'abord le nombre de vitesses.",
    tiers: { entry: ["KMC Z"], mid: ["Shimano HG601"], high: ["YBN"] },
  },
};

async function renderPanel(search: string, locale: "fr" | "en" = "fr") {
  setNavigationState({ pathname: "/fr/acheter", search });
  return renderWithIntl(<PartQuestions locale={locale} brandsByPart={BRANDS} />, { locale });
}

beforeEach(() => {
  setNavigationState({ pathname: "/fr/acheter", search: "" });
});

describe("what the URL is allowed to ask for", () => {
  it("renders nothing without a part", async () => {
    await renderPanel("");
    expect(screen.queryByTestId("part-questions")).not.toBeInTheDocument();
  });

  it("renders nothing for a part the catalogue does not know", async () => {
    await renderPanel("part=sprocket");
    expect(screen.queryByTestId("part-questions")).not.toBeInTheDocument();
  });

  it("renders nothing for a prototype key or an oversized value", async () => {
    await renderPanel("part=__proto__");
    expect(screen.queryByTestId("part-questions")).not.toBeInTheDocument();
    await renderPanel(`part=${"a".repeat(200)}`);
    expect(screen.queryByTestId("part-questions")).not.toBeInTheDocument();
  });

  it("opens on the named part, titled with its label", async () => {
    await renderPanel("part=chain");
    expect(screen.getByTestId("part-questions")).toHaveAttribute("data-part-id", "chain");
    expect(screen.getByRole("heading", { name: "Acheter : Chaîne" })).toBeInTheDocument();
  });
});

describe("the back-link to a build list", () => {
  it("appears when `?bike=` names a bike", async () => {
    // The mocked `Link` renders the internal pathname (see CategoryGrid.test);
    // the localized URL is the e2e's business.
    await renderPanel("part=chain&bike=demo&item=i1");
    expect(screen.getByTestId("part-questions-back")).toHaveAttribute("href", "/velo/demo/liste");
  });

  it("is dropped when the ref is not a bike", async () => {
    await renderPanel("part=chain&bike=../etc");
    expect(screen.queryByTestId("part-questions-back")).not.toBeInTheDocument();
  });
});

describe("the questions", () => {
  it("asks the part's own editable attributes, plus the brand tier", async () => {
    await renderPanel("part=chain");
    const panel = screen.getByTestId("part-questions");
    const keys = [...panel.querySelectorAll("[data-question]")].map((node) =>
      node.getAttribute("data-question"),
    );
    expect(keys).toEqual(partQuestions("chain").map((question) => question.key));
    expect(keys).toContain(BRAND_TIER_KEY);
  });

  it("folds an answer into the query the shops receive", async () => {
    const { user } = await renderPanel("part=chain");
    await user.selectOptions(screen.getByLabelText("Vitesses"), "11");

    expect(screen.getByTestId("part-query")).toHaveTextContent("chaîne 11 vitesses");
    const rose = within(screen.getByTestId("part-vendor-buttons")).getByRole("link", {
      name: /Rose Bikes/,
    });
    expect(rose).toHaveAttribute("href", outboundUrl("rosebikes", "fr", "chaîne 11 vitesses"));
  });

  it("appends the tier's first brand once a range is chosen", async () => {
    const { user } = await renderPanel("part=chain");
    await user.selectOptions(screen.getByLabelText("Vitesses"), "11");
    await user.selectOptions(screen.getByLabelText("Gamme"), "mid");
    expect(screen.getByTestId("part-query")).toHaveTextContent("chaîne 11 vitesses Shimano HG601");
  });

  it("shows the brands each range stands for", async () => {
    await renderPanel("part=chain");
    const tiers = screen.getByTestId("brand-tiers");
    expect(within(tiers).getByText("KMC Z")).toBeInTheDocument();
    expect(within(tiers).getByText("YBN")).toBeInTheDocument();
    expect(within(tiers).getByText(BRANDS.chain.note)).toBeInTheDocument();
  });

  it("omits the brand table for a part the content file does not cover", async () => {
    await renderPanel("part=saddle");
    expect(screen.getByTestId("part-questions")).toBeInTheDocument();
    expect(screen.queryByTestId("brand-tiers")).not.toBeInTheDocument();
  });

  it("speaks English on the English page", async () => {
    await renderPanel("part=chain", "en");
    expect(screen.getByRole("heading", { name: "Buying: Chain" })).toBeInTheDocument();
    expect(screen.getByLabelText("Range")).toBeInTheDocument();
  });
});

describe("typedValue", () => {
  const [speeds, eRated] = partQuestions("chain");

  it("keeps the catalogue's own spelling of an enum value", () => {
    expect(typedValue(speeds, "11")).toBe(11);
    expect(typedValue(speeds, "single")).toBe("single");
    expect(typedValue(speeds, "nonsense")).toBeUndefined();
  });

  it("reads a boolean back, and treats an empty control as no answer", () => {
    expect(typedValue(eRated, "true")).toBe(true);
    expect(typedValue(eRated, "false")).toBe(false);
    expect(typedValue(eRated, "")).toBeUndefined();
  });

  it("refuses a number that is not finite", () => {
    const number = { ...speeds, kind: "number" as const, values: null };
    expect(typedValue(number, "17")).toBe(17);
    expect(typedValue(number, "nope")).toBeUndefined();
  });
});
