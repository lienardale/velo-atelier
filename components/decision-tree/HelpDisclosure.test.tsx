/* eslint-disable security/detect-object-injection -- lookups into our own message catalogues by tree ids */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import enDecision from "@/messages/en/decision.json";
import enIllustrations from "@/messages/en/illustrations.json";
import frDecision from "@/messages/fr/decision.json";
import frIllustrations from "@/messages/fr/illustrations.json";
import { disclosureStorageKey } from "@/components/ui-ext/Disclosure";
import { DECISION_HELP_PERSIST_KEY } from "@/lib/bike/storage-keys";
import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { HelpDisclosure } from "./HelpDisclosure";
import { renderTreeIllustrations } from "./tree-illustrations";

type Catalogue = Record<string, { help: string }>;
type Alts = Record<string, { alt: string }>;
type Legends = Record<string, { callouts?: Record<string, string> }>;
const DECISION = { fr: frDecision as Catalogue, en: enDecision as Catalogue };
const ALTS = { fr: frIllustrations as unknown as Alts, en: enIllustrations as unknown as Alts };
const CALLOUTS = {
  fr: frIllustrations as unknown as Legends,
  en: enIllustrations as unknown as Legends,
};

afterEach(() => window.localStorage.clear());

describe("HelpDisclosure", () => {
  for (const locale of ["fr", "en"] as const) {
    it(`every question has one named drawing and its help paragraph (${locale})`, async () => {
      const illustrations = renderTreeIllustrations();
      for (const node of DECISION_TREE) {
        const { unmount } = await renderWithIntl(
          <HelpDisclosure node={node} illustrations={illustrations} />,
          { locale },
        );
        const details = screen.getByTestId("decision-help");
        const images = details.querySelectorAll("svg[role=img]");
        expect(images, node.id).toHaveLength(1);
        expect(images[0].querySelector("title")?.textContent).toBe(
          ALTS[locale][node.help.illustrationId].alt,
        );
        const paragraphs = [...details.querySelectorAll("p")].map((p) => p.textContent);
        expect(paragraphs).toContain(DECISION[locale][node.id].help);
        unmount();
      }
    });
  }

  it("starts closed and remembers being opened", async () => {
    const node = DECISION_TREE[0];
    const { user, unmount } = await renderWithIntl(
      <HelpDisclosure node={node} illustrations={renderTreeIllustrations()} />,
    );
    const details = screen.getByTestId("decision-help") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await user.click(details.querySelector("summary")!);
    expect(window.localStorage.getItem(disclosureStorageKey(DECISION_HELP_PERSIST_KEY))).toBe("1");
    unmount();

    await renderWithIntl(
      <HelpDisclosure node={DECISION_TREE[1]} illustrations={renderTreeIllustrations()} />,
    );
    expect((screen.getByTestId("decision-help") as HTMLDetailsElement).open).toBe(true);
  });

  for (const locale of ["fr", "en"] as const) {
    it(`names every numbered callout of the drawing (${locale})`, async () => {
      const illustrations = renderTreeIllustrations();
      let checked = 0;
      for (const node of DECISION_TREE) {
        const legend = CALLOUTS[locale][node.help.illustrationId]?.callouts;
        if (legend === undefined) continue;
        checked += 1;
        const { unmount } = await renderWithIntl(
          <HelpDisclosure node={node} illustrations={illustrations} />,
          { locale },
        );
        const items = [
          ...screen.getByTestId("decision-help").querySelectorAll("figcaption ol li"),
        ].map((li) => {
          const spans = li.querySelectorAll(":scope > span");
          // The badge is the number a sighted reader matches against the ink on
          // the drawing; it is aria-hidden, and the text repeats the number in
          // an sr-only span so a screen reader hears "2. Motor around…" too.
          return { badge: spans[0]?.textContent, read: spans[1]?.textContent };
        });
        // One entry per callout, in order, each carrying its own number.
        const expected = Object.entries(legend)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([n, text]) => ({ badge: n, read: `${n}. ${text}` }));
        expect(items, `${node.id} (${locale})`).toEqual(expected);
        unmount();
      }
      // Guards the loop: a registry that lost its callouts would pass vacuously.
      expect(checked, "no question had a callout legend").toBeGreaterThan(0);
    });
  }

  it("still renders its text when a drawing is missing", async () => {
    const node = DECISION_TREE[0];
    await renderWithIntl(<HelpDisclosure node={node} illustrations={{}} />);
    expect(screen.getByTestId("decision-help").querySelector("svg[role=img]")).toBeNull();
    expect(screen.getByText(frDecision.drive.help)).toBeInTheDocument();
  });
});
