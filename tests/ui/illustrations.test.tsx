/**
 * Every registered illustration renders as a named image (§5.3) — the smoke
 * test that stands in for coverage of `components/illustrations/**`.
 *
 *   - the registry (`lib/content/illustrations.ts`) and the barrel agree: every
 *     id has its component, every component is registered;
 *   - each renders one `svg[role=img]` whose `<title>` is
 *     `illustrations.<id>.alt`, in FR and EN, and nothing visible when
 *     `decorative`;
 *   - guide drawings use the 320 × 240 box and draw exactly as many
 *     `data-callout` circles as `illustrations.<id>.callouts.*` has keys;
 *   - decision-tree drawings (W2-T4c) are final: the 16 help drawings
 *     (`DecisionNode.help.illustrationId`) use the 320 × 240 box and draw at
 *     least one callout, exactly matching their callout keys; option thumbnails
 *     use the 120 × 120 box and carry no callout.
 */
import { cleanup } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ILLUSTRATION_COMPONENTS, illustrationComponent } from "@/components/illustrations";
import { CONTENT_ILLUSTRATIONS, GUIDE_ILLUSTRATION_IDS } from "@/lib/content/illustrations";
import { DECISION_TREE, ILLUSTRATIONS } from "@/lib/domain";
import { renderWithIntl } from "@/tests/_helpers/intl";

import en from "@/messages/en/illustrations.json";
import fr from "@/messages/fr/illustrations.json";

const CATALOGUES = { fr, en } as unknown as Record<
  "fr" | "en",
  Record<string, { alt: string; callouts?: Record<string, string> }>
>;
const guideIds = new Set<string>(GUIDE_ILLUSTRATION_IDS);
const treeIds = new Set<string>(Object.keys(ILLUSTRATIONS));
const helpIds = new Set<string>(DECISION_TREE.map((node) => node.help.illustrationId));

describe("decision-tree drawings", () => {
  it("has one help drawing per question", () => {
    expect(helpIds.size).toBe(16);
    for (const id of helpIds) expect(treeIds.has(id), id).toBe(true);
  });
});

describe("illustration registry ↔ components", () => {
  it("every registered id has a component and every component is registered", () => {
    const registered = Object.values(CONTENT_ILLUSTRATIONS)
      .map((definition) => definition.component)
      .sort();
    expect(Object.keys(ILLUSTRATION_COMPONENTS).sort()).toEqual(registered);
    expect(illustrationComponent("toString")).toBeUndefined();
  });
});

for (const locale of ["fr", "en"] as const) {
  describe(`every illustration renders (${locale})`, () => {
    for (const [id, definition] of Object.entries(CONTENT_ILLUSTRATIONS)) {
      it(id, async () => {
        const Drawing = illustrationComponent(definition.component)!;
        const { container } = await renderWithIntl(<Drawing />, { locale });
        const svg = container.querySelector("svg")!;
        expect(svg).toHaveAttribute("role", "img");
        // eslint-disable-next-line security/detect-object-injection -- id from the registry
        expect(svg.querySelector("title")?.textContent).toBe(CATALOGUES[locale][id].alt);

        if (guideIds.has(id)) {
          expect(svg).toHaveAttribute("viewBox", "0 0 320 240");
          expect(svg).toHaveAttribute("aria-labelledby", svg.querySelector("title")!.id);
          // eslint-disable-next-line security/detect-object-injection -- id from the registry
          const keys = Object.keys(CATALOGUES[locale][id].callouts ?? {});
          const circles = [...svg.querySelectorAll("[data-callout]")].map((c) =>
            c.getAttribute("data-callout"),
          );
          expect(circles).toEqual(keys);
          for (const text of svg.querySelectorAll("text:not([data-callout])")) {
            expect(text).toHaveAttribute("aria-hidden", "true");
          }
        }

        if (treeIds.has(id)) {
          expect(svg).toHaveAttribute("data-status", "final");
          expect(svg).toHaveAttribute("aria-labelledby", svg.querySelector("title")!.id);
          const circles = [...svg.querySelectorAll("[data-callout]")].map((c) =>
            c.getAttribute("data-callout"),
          );
          // eslint-disable-next-line security/detect-object-injection -- id from the registry
          const keys = Object.keys(CATALOGUES[locale][id].callouts ?? {});
          if (helpIds.has(id)) {
            expect(svg).toHaveAttribute("viewBox", "0 0 320 240");
            expect(circles.length).toBeGreaterThanOrEqual(1);
          } else {
            expect(svg).toHaveAttribute("viewBox", "0 0 120 120");
          }
          expect(circles).toEqual(keys);
          for (const text of svg.querySelectorAll("text")) {
            expect(text).toHaveAttribute("aria-hidden", "true");
          }
        }
        cleanup();

        const decorative = await renderWithIntl(<Drawing decorative />, { locale });
        const hidden = decorative.container.querySelector("svg")!;
        expect(hidden).toHaveAttribute("aria-hidden", "true");
        expect(hidden.querySelector("title")).toBeNull();
      });
    }
  });
}
