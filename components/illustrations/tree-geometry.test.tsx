/**
 * The split between a decision-tree drawing's frame and its shapes
 * (`.debug/007`).
 *
 * Four things have to hold now that the two halves are rendered by different
 * runtimes:
 *
 *   1. every drawing the tree can show has geometry — otherwise the visitor
 *      gets an empty box;
 *   2. the geometry really is the drawing's shapes, and carries the numbered
 *      `data-callout`s the help panel's legend names;
 *   3. it stays inside the closed vocabulary of `tree-drawing-node.ts` — this
 *      is the artifact that crosses the server/client boundary, and it is data
 *      over a whitelist precisely so that no HTML is ever injected into the
 *      DOM (`tests/security/xss-form-inputs.test.ts`);
 *   4. `treeFrameAttrs()` — what the client draws around the shapes — is
 *      exactly the `<svg>` `TreeIllustrationFrame` draws on the server.
 */
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { DECISION_TREE, ILLUSTRATIONS, type IllustrationId } from "@/lib/domain";
import { messagesFor } from "@/tests/_helpers/intl";

import { illustrationComponent } from "./index";
import {
  DRAWING_ATTRIBUTES,
  DRAWING_TAGS,
  type DrawingElement,
  type DrawingNode,
} from "./tree-drawing-node";
import { TreeIllustrationFrame } from "./tree-frame";
import { treeFrameAttrs } from "./tree-frame-attrs";
import {
  parseDrawing,
  parseDrawingStyle,
  renderTreeGeometry,
  treeIllustrationIds,
} from "./tree-geometry";

/** Every element of a drawing, depth-first. */
function walk(nodes: readonly DrawingNode[]): DrawingElement[] {
  const found: DrawingElement[] = [];
  for (const node of nodes) {
    if (typeof node === "string") continue;
    found.push(node);
    if (node.c) found.push(...walk(node.c));
  }
  return found;
}

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

describe("parseDrawing", () => {
  it("reads nested elements, self-closing tags and text", () => {
    const { nodes, end } = parseDrawing(
      '<g transform="translate(1 2)"><circle cx="3" cy="4" r="5"/><text x="6" y="7">40-622</text></g>',
    );
    expect(end).toBe(94);
    expect(nodes).toEqual([
      {
        t: "g",
        a: { transform: "translate(1 2)" },
        c: [
          { t: "circle", a: { cx: "3", cy: "4", r: "5" } },
          { t: "text", a: { x: "6", y: "7" }, c: ["40-622"] },
        ],
      },
    ]);
  });

  it("decodes the entities React writes", () => {
    expect(parseDrawing('<text x="1">A &amp; B</text>').nodes).toEqual([
      { t: "text", a: { x: "1" }, c: ["A & B"] },
    ]);
  });

  // It reads one renderer's output over one closed vocabulary; anything else is
  // a build failure, never a guess. That is what lets the result be replayed as
  // React elements instead of injected as HTML.
  it("throws on a tag outside the whitelist", () => {
    expect(() => parseDrawing('<image href="http://evil/x.png"/>')).toThrow(/not on the whitelist/);
    expect(() => parseDrawing("<script>alert(1)</script>")).toThrow(/not on the whitelist/);
  });

  it("throws on an attribute outside the whitelist", () => {
    expect(() => parseDrawing('<circle onclick="alert(1)" r="1"/>')).toThrow(
      /not on the whitelist/,
    );
    expect(() => parseDrawing('<path clip-path="url(#x)" d="M0 0"/>')).toThrow(
      /not on the whitelist/,
    );
  });

  it("throws on a value that could reference or escape", () => {
    expect(() => parseDrawing('<path d="url(#x)"/>')).toThrow(/may not reference or escape/);
  });

  it("throws on markup it does not understand rather than skipping it", () => {
    expect(() => parseDrawing("<circle r=1>")).toThrow(/not understood/);
    expect(() => parseDrawing("<!-- comment -->")).toThrow(/not understood/);
    expect(() => parseDrawing('<g transform="a"><circle r="1"/></rect>')).toThrow(
      /is not closed where expected/,
    );
  });
});

describe("parseDrawingStyle", () => {
  it("turns the theme tokens a drawing may set into a React style object", () => {
    expect(parseDrawingStyle("stroke:var(--color-accent);fill:var(--color-paper)")).toEqual({
      stroke: "var(--color-accent)",
      fill: "var(--color-paper)",
    });
  });

  it("refuses a property that is not stroke or fill", () => {
    expect(() => parseDrawingStyle("background:var(--color-paper)")).toThrow(/not allowed/);
  });

  it("refuses anything but a colour token — a url() above all", () => {
    expect(() => parseDrawingStyle("fill:url(#evil)")).toThrow(/colour token/);
    expect(() => parseDrawingStyle("fill:red")).toThrow(/colour token/);
  });
});

describe("renderTreeGeometry", () => {
  it("gives every drawing the tree can show its shapes, and no words", async () => {
    const geometry = renderTreeGeometry(await messagesFor("fr"));
    for (const id of treeIllustrationIds()) {
      // eslint-disable-next-line security/detect-object-injection -- an IllustrationId from the tree
      if (ILLUSTRATIONS[id].status !== "final") continue;
      const shapes = geometry[id];
      expect(shapes, id).toBeInstanceOf(Array);
      const elements = walk(shapes);
      expect(elements.length, id).toBeGreaterThan(0);
      // The title is the one language-dependent part; it is drawn by the
      // client, from the visitor's catalogue, and must not be baked in here.
      expect(
        elements.some((element) => element.t === "title"),
        id,
      ).toBe(false);
    }
  });

  it("stays inside the closed vocabulary, everywhere", async () => {
    const geometry = renderTreeGeometry(await messagesFor("fr"));
    const tags = new Set<string>();
    const attributes = new Set<string>();

    for (const shapes of Object.values(geometry)) {
      for (const element of walk(shapes)) {
        tags.add(element.t);
        for (const name of Object.keys(element.a)) attributes.add(name);
      }
    }

    expect(tags.size).toBeGreaterThan(0);
    for (const tag of tags) expect(DRAWING_TAGS, tag).toContain(tag);
    for (const name of attributes) expect(DRAWING_ATTRIBUTES, name).toContain(name);
    // The things the whitelist exists to keep out.
    for (const name of attributes) {
      expect(name.startsWith("on"), name).toBe(false);
      expect(name).not.toMatch(/href|src|filter|mask|clip-path|class/);
    }
  });

  it("carries the numbered callouts the help legend names", async () => {
    const geometry = renderTreeGeometry(await messagesFor("fr"));
    let withCallouts = 0;
    for (const node of DECISION_TREE) {
      const shapes = geometry[node.help.illustrationId];
      if (shapes === undefined) continue;
      const callouts = walk(shapes)
        .map((element) => element.a["data-callout"])
        .filter((value): value is string => typeof value === "string");
      if (callouts.length === 0) continue;
      withCallouts += 1;
      expect(callouts, node.id).toContain("1");
    }
    expect(withCallouts, "no drawing kept its callouts").toBeGreaterThan(0);
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
