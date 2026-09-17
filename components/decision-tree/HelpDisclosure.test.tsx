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
const DECISION = { fr: frDecision as Catalogue, en: enDecision as Catalogue };
const ALTS = { fr: frIllustrations as unknown as Alts, en: enIllustrations as unknown as Alts };

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

  it("still renders its text when a drawing is missing", async () => {
    const node = DECISION_TREE[0];
    await renderWithIntl(<HelpDisclosure node={node} illustrations={{}} />);
    expect(screen.getByTestId("decision-help").querySelector("svg[role=img]")).toBeNull();
    expect(screen.getByText(frDecision.drive.help)).toBeInTheDocument();
  });
});
