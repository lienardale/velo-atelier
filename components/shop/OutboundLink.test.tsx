/**
 * Every link that leaves this site (§5.8 AC5).
 *
 * The criterion says "every `<OutboundLink>` has the exact `rel`/`target`, and
 * msw asserts zero network calls on click". Both halves are here, and so is the
 * thing that makes "every" true rather than "every one I remembered to test":
 * a scan of the whole source tree for any other way to open a new window.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the scan below walks the repo's own tree */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OUTBOUND_REL, OUTBOUND_TARGET, outboundUrl } from "@/lib/shop/outbound";
import { buildQuery } from "@/lib/shop/query";
import { mswState } from "@/tests/_mocks/handlers";
import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { VendorButtons } from "../build-list/VendorButtons";
import { CategoryGrid } from "./CategoryGrid";
import { OutboundLink } from "./OutboundLink";
import { PartQuestions } from "./PartQuestions";
import { VendorSearch } from "./VendorSearch";

const CATEGORIES = [
  {
    id: "chains",
    label: "Chaînes",
    hint: "Au bon nombre de vitesses.",
    query: "chaîne vélo",
    partId: "chain",
    retailers: ["rosebikes", "alltricks", "decathlon"] as const,
  },
];

const BRANDS = {
  chain: {
    note: "Choisissez d'abord le nombre de vitesses.",
    tiers: { entry: ["KMC Z"], mid: ["KMC X"], high: ["YBN"] },
  },
};

/**
 * jsdom has no navigation: a click on `target="_blank"` reaches `window.open`,
 * which it does not implement and reports on the virtual console. The point of
 * the assertion is that OUR code makes no request, so the default is suppressed
 * and the recording left to msw and to the spies.
 */
function swallowNavigation(): () => void {
  const stop = (event: Event) => event.preventDefault();
  document.addEventListener("click", stop, true);
  return () => document.removeEventListener("click", stop, true);
}

beforeEach(() => {
  setNavigationState({ pathname: "/fr/acheter", search: "" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<OutboundLink>", () => {
  it("carries the exact target and rel of §5.8 AC5", async () => {
    await renderWithIntl(
      <OutboundLink href="https://www.rosebikes.fr/search?q=x">Rose</OutboundLink>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveAttribute("href", "https://www.rosebikes.fr/search?q=x");
  });

  it("names the new window in its accessible name, not only in an icon", async () => {
    await renderWithIntl(<OutboundLink href="https://www.rosebikes.fr/">Rose</OutboundLink>);
    expect(screen.getByRole("link").textContent).toContain("(nouvelle fenêtre)");
    // The icon is decoration: it must not reach the accessibility tree.
    expect(screen.getByRole("link").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("says it in English on the English page", async () => {
    await renderWithIntl(<OutboundLink href="https://www.rosebikes.com/">Rose</OutboundLink>, {
      locale: "en",
    });
    expect(screen.getByRole("link").textContent).toContain("(opens in a new window)");
  });

  it("makes no request when it is clicked (§5.8 AC5)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    const release = swallowNavigation();
    try {
      const { user } = await renderWithIntl(
        <OutboundLink href="https://www.rosebikes.fr/search?q=x">Rose</OutboundLink>,
      );
      await user.click(screen.getByRole("link"));
      expect(mswState.requests).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it("has no click handler at all: there is nothing to track with", () => {
    const code = withoutComments(
      readFileSync(join(process.cwd(), "components/shop/OutboundLink.tsx"), "utf8"),
    );
    expect(code).not.toMatch(/onClick|onAuxClick|fetch\(|sendBeacon|useEffect/);
  });
});

describe("every outbound link the shop renders", () => {
  /** Every `<a>` an `<OutboundLink>` produced, from all four call sites. */
  async function renderEveryOutboundLink(): Promise<HTMLAnchorElement[]> {
    setNavigationState({ pathname: "/fr/acheter", search: "part=chain&bike=demo&item=i1" });
    const { container } = await renderWithIntl(
      <div>
        <CategoryGrid categories={CATEGORIES} locale="fr" />
        <VendorSearch locale="fr" defaultQuery="chaîne 11 vitesses" />
        <VendorButtons partId="chain" query="chaîne 11 vitesses" locale="fr" />
        <PartQuestions locale="fr" brandsByPart={BRANDS} />
      </div>,
    );
    return [...container.querySelectorAll<HTMLAnchorElement>("a[data-outbound]")];
  }

  it("is rendered by all four call sites", async () => {
    const links = await renderEveryOutboundLink();
    // 3 category buttons + 3 free-text + 3 vendor buttons + 3 in the part panel.
    expect(links).toHaveLength(12);
  });

  it("carries the same target, rel and https href, every one of them", async () => {
    const links = await renderEveryOutboundLink();
    for (const link of links) {
      expect(link.getAttribute("target"), link.href).toBe(OUTBOUND_TARGET);
      expect(link.getAttribute("rel"), link.href).toBe(OUTBOUND_REL);
      expect(new URL(link.href).protocol, link.href).toBe("https:");
      expect(within(link).getByText("(nouvelle fenêtre)")).toBeInTheDocument();
    }
  });

  it("puts the built query in the two shops that have a search endpoint", async () => {
    const links = await renderEveryOutboundLink();
    const query = buildQuery("chain", { speeds: 11 }, "fr");
    const rose = links.filter((link) => link.href.startsWith("https://www.rosebikes.fr"));
    expect(rose.some((link) => link.href === outboundUrl("rosebikes", "fr", query))).toBe(true);
  });
});

// ── The "every" in "every OutboundLink" ──────────────────────────────────────

const SOURCE_DIRS = ["app", "components", "lib"];
const SOURCE_EXT = /\.(ts|tsx)$/;

/**
 * The two files that ARE the contract, plus the one link on this site that
 * predates it: the footer's "code source" link to the GitHub repository
 * (W0-T2). It is not a shop link — there is no query to encode and no retailer
 * to verify — but it is still a new window, so the test holds it to the same
 * security pair and to its own sr-only announcement rather than waving it
 * through.
 */
const NOT_A_SHOP_LINK = "components/layout/SiteFooter.tsx";
const CONTRACT_FILES = ["components/shop/OutboundLink.tsx", "lib/shop/outbound.ts"];

/** Strip block and line comments: a doc comment is not code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
      found.push(full);
    }
  }
  return found;
}

describe("nothing else opens a new window", () => {
  it('leaves `target="_blank"` to OutboundLink alone', () => {
    const offenders: string[] = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(join(process.cwd(), dir))) {
        const rel = relative(process.cwd(), file).split(sep).join("/");
        if (CONTRACT_FILES.includes(rel) || rel === NOT_A_SHOP_LINK) continue;
        const source = withoutComments(readFileSync(file, "utf8"));
        if (/target\s*=\s*["'{]?_blank/.test(source)) offenders.push(rel);
      }
    }
    expect(
      offenders,
      "these files open a new window without going through <OutboundLink>, so nothing " +
        "guarantees their rel, their icon or their screen-reader announcement",
    ).toEqual([]);
  });

  it("holds the one exception — the footer's repository link — to the same pair", () => {
    const source = readFileSync(join(process.cwd(), NOT_A_SHOP_LINK), "utf8");
    expect(source).toMatch(/rel="noopener noreferrer"/);
    expect(source).toMatch(/footer\.newTab/);
  });
});
