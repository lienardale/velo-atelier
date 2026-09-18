/**
 * The split between a decision-tree drawing's frame and its shapes
 * (`.debug/005`).
 *
 * Three things have to hold for a drawing to reach the screen unchanged now
 * that the two halves are rendered by different runtimes:
 *
 *   1. every drawing the tree can show has geometry in the map — otherwise the
 *      visitor gets an empty box;
 *   2. the geometry really is the drawing's shapes, and carries the numbered
 *      `data-callout`s the help panel's legend names;
 *   3. `treeFrameAttrs()` — what the client draws around them — is exactly the
 *      `<svg>` `TreeIllustrationFrame` draws on the server.
 */
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { DECISION_TREE, ILLUSTRATIONS, type IllustrationId } from "@/lib/domain";
import { messagesFor } from "@/tests/_helpers/intl";

import { illustrationComponent } from "./index";
import { TreeIllustrationFrame } from "./tree-frame";
import { treeFrameAttrs } from "./tree-frame-attrs";
import { renderTreeGeometry, svgBody, treeIllustrationIds } from "./tree-geometry";

describe("treeIllustrationIds", () => {
  it("lists every help drawing and every option thumbnail of the tree", () => {
    const ids = new Set(treeIllustrationIds());
    for (const node of DECISION_TREE) {
      expect(ids, `help of ${node.id}`).toContain(node.help.illustrationId);
      for (const option of node.options) {
        if (option.illustrationId === undefined) continue;
        expect(ids, `${node.id}/${option.id}`).toContain(option.illustrationId);
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(50);
  });
});

describe("svgBody", () => {
  it("keeps everything between the svg's tags", () => {
    expect(svgBody('<svg viewBox="0 0 1 1"><g><path d="M0 0"/></g></svg>')).toBe(
      '<g><path d="M0 0"/></g>',
    );
  });

  it("refuses markup that is not a single svg element", () => {
    expect(() => svgBody('<div class="x"></div>')).toThrow(/single <svg>/);
    expect(() => svgBody("")).toThrow(/single <svg>/);
  });
});

describe("renderTreeGeometry", () => {
  it("gives every drawing the tree can show its shapes, and no words", async () => {
    const geometry = renderTreeGeometry(await messagesFor("fr"));
    for (const id of treeIllustrationIds()) {
      // eslint-disable-next-line security/detect-object-injection -- an IllustrationId from the tree
      if (ILLUSTRATIONS[id].status !== "final") continue;
      const body = geometry[id];
      expect(body, id).toBeTypeOf("string");
      expect(body, id).toMatch(/<(path|circle|rect|g|line|polyline|ellipse)\b/);
      // The title is the one language-dependent part; it is drawn by the
      // client, from the visitor's catalogue, and must not be baked in here.
      expect(body, id).not.toContain("<title");
    }
  });

  it("carries the numbered callouts the help legend names", async () => {
    const geometry = renderTreeGeometry(await messagesFor("fr"));
    const withCallouts = Object.values(geometry).filter((body) => body.includes("data-callout"));
    expect(withCallouts.length, "no drawing kept its callouts").toBeGreaterThan(0);
    for (const node of DECISION_TREE) {
      const body = geometry[node.help.illustrationId];
      if (body === undefined || !body.includes("data-callout")) continue;
      expect(body).toMatch(/data-callout="1"/);
    }
  });
});

describe("treeFrameAttrs", () => {
  it("is exactly the <svg> the server frame draws, for both aspects", async () => {
    const messages = await messagesFor("fr");
    const ids: IllustrationId[] = ["ill-drive", "ill-discipline-road"];

    for (const id of ids) {
      const { container, unmount } = render(
        <NextIntlClientProvider locale="fr" messages={messages} timeZone="Europe/Paris">
          <TreeIllustrationFrame id={id} className="probe">
            <path d="M0 0" />
          </TreeIllustrationFrame>
        </NextIntlClientProvider>,
      );
      const svg = container.querySelector("svg")!;
      const attrs = treeFrameAttrs(id);
      expect(svg.getAttribute("viewBox"), id).toBe(attrs.viewBox);
      expect(svg.getAttribute("preserveAspectRatio"), id).toBe(attrs.preserveAspectRatio);
      expect(svg.getAttribute("fill"), id).toBe(attrs.fill);
      expect(svg.getAttribute("stroke"), id).toBe(attrs.stroke);
      expect(svg.getAttribute("stroke-width"), id).toBe(String(attrs.strokeWidth));
      expect(svg.getAttribute("stroke-linecap"), id).toBe(attrs.strokeLinecap);
      expect(svg.getAttribute("stroke-linejoin"), id).toBe(attrs.strokeLinejoin);
      expect(svg.getAttribute("data-illustration"), id).toBe(attrs["data-illustration"]);
      expect(svg.getAttribute("data-status"), id).toBe(attrs["data-status"]);
      unmount();
    }
  });

  it("covers both boxes: the help drawing is 4/3, the thumbnail square", () => {
    expect(treeFrameAttrs("ill-drive").viewBox).toBe("0 0 320 240");
    expect(treeFrameAttrs("ill-discipline-road").viewBox).toBe("0 0 120 120");
    expect(treeFrameAttrs("ill-drive").strokeWidth).toBe(2);
    expect(treeFrameAttrs("ill-discipline-road").strokeWidth).toBe(3);
  });

  it("has a component for every drawing it frames", () => {
    for (const id of treeIllustrationIds()) {
      // eslint-disable-next-line security/detect-object-injection -- an IllustrationId from the tree
      const definition = ILLUSTRATIONS[id];
      expect(illustrationComponent(definition.component), id).toBeDefined();
    }
  });
});
