/**
 * The `?part=` panel of `/acheter` (§5.5).
 *
 * `/acheter` is prerendered, so this panel is the browser's half of the page:
 * it reads the URL, asks the part's own questions, and folds every answer into
 * the query the three shops receive. The URL is untrusted input like any other,
 * which is most of what is checked here.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildListKey } from "@/lib/bike/storage-keys";
import { writeGuestBuildList } from "@/lib/checkup/storage";
import type { BuildListItem } from "@/lib/checkup/types";
import type { PartId } from "@/lib/domain/data/parts";
import { outboundUrl } from "@/lib/shop/outbound";
import { BRAND_TIER_KEY, partQuestions } from "@/lib/shop/questions";
import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { PartQuestions, prefillFor, typedValue } from "./PartQuestions";
import type { ReadBuildListItem } from "./item-prefill";

/** Stands in for `loadBuildListItemAction`, which the page hands down. */
const readItem = vi.fn<ReadBuildListItem>(async () => ({ ok: false, code: "NOT_FOUND" }));

const BRANDS = {
  chain: {
    note: "Choisissez d'abord le nombre de vitesses.",
    tiers: { entry: ["KMC Z"], mid: ["Shimano HG601"], high: ["YBN"] },
  },
};

async function renderPanel(search: string, locale: "fr" | "en" = "fr") {
  setNavigationState({ pathname: "/fr/acheter", search });
  return renderWithIntl(
    <PartQuestions locale={locale} brandsByPart={BRANDS} readItem={readItem} />,
    { locale },
  );
}

beforeEach(() => {
  setNavigationState({ pathname: "/fr/acheter", search: "" });
  window.localStorage.clear();
});

/**
 * The `?item=` line is read after the first render — a guest's reader is
 * loaded on demand, a saved bike's is a server action — and the panel is
 * `aria-busy` until that read has answered. Every assertion about what was
 * (or was not) pre-filled waits for that first: asserted before it, "nothing
 * was pre-filled" would pass however the defence behaved.
 */
async function settled(): Promise<HTMLElement> {
  const panel = screen.getByTestId("part-questions");
  await waitFor(() => expect(panel).not.toHaveAttribute("aria-busy"));
  return panel;
}

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

/**
 * §5.5: "with `?part=<id>&bike=<ref>&item=<id>` it pre-fills from the
 * build-list item" — written by `BuildItemCard`, and read by nothing until W4.
 */
describe("?item= pre-fills from the build-list line", () => {
  const ITEM = "check-drivetrain#chain-wear|chain|replace";
  const line = (overrides: Partial<BuildListItem> = {}): BuildListItem => ({
    id: ITEM,
    stepKey: "check-drivetrain#chain-wear",
    sourceKeys: ["check-drivetrain#chain-wear"],
    partId: "chain" as PartId,
    action: "replace",
    reasonKey: "chain-elongation",
    done: false,
    sortOrder: 0,
    refinement: { speeds: "11", [BRAND_TIER_KEY]: "mid" },
    ...overrides,
  });
  const guestList = (items: BuildListItem[]) =>
    writeGuestBuildList("local", items, "11111111-1111-4111-8111-111111111111");
  const search = (item = ITEM, part = "chain", bike = "local") =>
    new URLSearchParams({ part, bike, item }).toString();

  it("opens a guest's line with the answers it already has, in the query too", async () => {
    guestList([line()]);
    await renderPanel(search());
    await settled();

    expect(screen.getByLabelText("Vitesses")).toHaveValue("11");
    expect(screen.getByLabelText("Gamme")).toHaveValue("mid");
    expect(screen.getByTestId("part-query")).toHaveTextContent("chaîne 11 vitesses Shimano HG601");
    expect(screen.getByTestId("part-questions-prefilled")).toBeInTheDocument();
  });

  it("lets the visitor change a pre-filled answer", async () => {
    guestList([line()]);
    const { user } = await renderPanel(search());
    await settled();
    await user.selectOptions(screen.getByLabelText("Vitesses"), "12");
    expect(screen.getByLabelText("Vitesses")).toHaveValue("12");
    expect(screen.getByTestId("part-query")).toHaveTextContent("chaîne 12 vitesses Shimano HG601");
  });

  it("prefills nothing from a line about another part, or a line that is not there", async () => {
    guestList([line({ partId: "cassette" as PartId })]);
    await renderPanel(search());
    await settled();
    expect(screen.getByLabelText("Vitesses")).toHaveValue("");

    cleanup();
    await renderPanel(search("not-a-line"));
    await settled();
    expect(screen.queryByTestId("part-questions-prefilled")).not.toBeInTheDocument();

    // The same rule for a saved bike: the owner's line, but about a cassette.
    readItem.mockResolvedValueOnce({
      ok: true,
      data: { partId: "cassette", refinement: { speeds: "11" } },
    });
    cleanup();
    await renderPanel(
      search(
        "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        "chain",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      ),
    );
    await settled();
    expect(screen.getByLabelText("Vitesses")).toHaveValue("");
  });

  it("drops an answer this panel cannot show, and survives a corrupted list", async () => {
    guestList([
      line({ refinement: { speeds: "99", "not-a-question": "x", [BRAND_TIER_KEY]: "luxe" } }),
    ]);
    await renderPanel(search());
    await settled();
    expect(screen.getByLabelText("Vitesses")).toHaveValue("");
    expect(screen.getByLabelText("Gamme")).toHaveValue("");

    window.localStorage.setItem(
      buildListKey("local"),
      JSON.stringify({ version: 1, updatedAt: "2026-09-21T08:00:00.000Z", items: [null, 3] }),
    );
    cleanup();
    await renderPanel(search());
    await settled();
    expect(screen.getByLabelText("Vitesses")).toHaveValue("");
  });

  it("asks the server for a saved bike's line, and shows what the owner's read returned", async () => {
    const bike = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const item = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    readItem.mockResolvedValueOnce({
      ok: true,
      data: { partId: "chain", refinement: { speeds: "10" } },
    });

    await renderPanel(search(item, "chain", bike));
    await settled();

    expect(screen.getByLabelText("Vitesses")).toHaveValue("10");
    expect(readItem).toHaveBeenCalledWith({ bikeId: bike, itemId: item });
  });

  it("opens empty when the server says the line is not the caller's", async () => {
    const bike = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    await renderPanel(search("6f9619ff-8b86-4d11-b42d-00c04fc964ff", "chain", bike));
    await settled();
    expect(readItem).toHaveBeenCalled();
    expect(screen.getByLabelText("Vitesses")).toHaveValue("");
  });

  it("is busy while the line is read, and only while", async () => {
    let answer: (result: Awaited<ReturnType<ReadBuildListItem>>) => void = () => undefined;
    readItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await renderPanel(
      search(
        "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        "chain",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      ),
    );
    const panel = screen.getByTestId("part-questions");
    await waitFor(() => expect(readItem).toHaveBeenCalled());
    expect(panel).toHaveAttribute("aria-busy", "true");

    answer({ ok: true, data: { partId: "chain", refinement: { speeds: "9" } } });
    await settled();
    expect(screen.getByLabelText("Vitesses")).toHaveValue("9");

    // No `?item=`: nothing to read, so never busy.
    cleanup();
    await renderPanel("part=chain&bike=local");
    expect(screen.getByTestId("part-questions")).not.toHaveAttribute("aria-busy");
  });
});

describe("prefillFor", () => {
  it("keeps an answer only under one of the questions, with a value it accepts", () => {
    expect(
      prefillFor(partQuestions("chain"), {
        speeds: "11",
        [BRAND_TIER_KEY]: "high",
        "e-rated": "maybe",
        constructor: "x",
      }),
    ).toEqual({ speeds: "11", [BRAND_TIER_KEY]: "high" });
    expect(prefillFor(partQuestions("chain"), null)).toEqual({});
  });
});
