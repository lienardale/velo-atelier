import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";
import { makeGuide } from "@/tests/_helpers/guides";

import { GuideContent, guideComponents } from "./GuideContent";
import { Illustration } from "./Illustration";
import { Tool } from "./Tool";
import { Warning } from "./Warning";

// The compiled-MDX evaluator is replaced by a stand-in that renders what a
// compiled guide would: its components, fed the props an author writes.
vi.mock("@content-collections/mdx/react", () => ({
  MDXContent: ({
    code,
    components,
  }: {
    code: string;
    components: Record<string, (props: Record<string, unknown>) => React.ReactNode>;
  }) => {
    const { Step, Tool: ToolComponent } = components;
    return (
      <div data-code={code}>
        {Step({ id: "one", children: <p>{ToolComponent({ id: "rags" })}</p> })}
        {Step({ id: "unknown", children: <p>orphan</p> })}
      </div>
    );
  },
}));

describe("GuideContent", () => {
  it("renders the compiled MDX with steps bound to the frontmatter", async () => {
    const guide = makeGuide({
      mdx: "compiled",
      steps: [{ id: "one", title: "Nettoyer", illustration: "chain-wear-checker" }],
    });
    const { container } = await renderWithIntl(<GuideContent guide={guide} />);
    expect(container.querySelector("[data-code=compiled]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Étape 1\s*Nettoyer/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Indicateur d’usure/ })).toBeInTheDocument();
    // A body step missing from the frontmatter still renders, titled by its id.
    expect(screen.getByRole("heading", { name: /Étape 0\s*unknown/ })).toBeInTheDocument();
  });

  it("exposes exactly the components the content check allows", () => {
    expect(Object.keys(guideComponents(makeGuide())).sort()).toEqual(
      ["Illustration", "Measure", "Step", "Tool", "Warning"].sort(),
    );
  });
});

describe("Tool", () => {
  it("names the tool, and its stand-in when given", async () => {
    await renderWithIntl(
      <p>
        <Tool id="allen-keys" alt="multi-tool" />
      </p>,
    );
    expect(screen.getByText("Clés Allen")).toBeInTheDocument();
    expect(screen.getByText(/\(ou Multi-outil\)/)).toBeInTheDocument();
  });

  it("without a stand-in, in English", async () => {
    const { container } = await renderWithIntl(<Tool id="rags" />, { locale: "en" });
    expect(container).toHaveTextContent("Clean rags");
    expect(container).not.toHaveTextContent("(");
  });
});

describe("Warning", () => {
  it.each([
    ["info", "À savoir", "info"],
    ["caution", "Attention", "warning"],
    ["danger", "Danger", "danger"],
    ["unknown", "À savoir", "info"],
  ])("level %s is titled %s", async (level, title, tone) => {
    const { container } = await renderWithIntl(<Warning level={level}>Texte</Warning>);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(container.querySelector("[data-slot=callout]")).toHaveAttribute("data-tone", tone);
    expect(container.querySelector("[role=alert]")).toBeNull();
  });
});

describe("Illustration", () => {
  it("draws the illustration with its numbered legend and caption", async () => {
    await renderWithIntl(<Illustration id="pad-wear-disc" caption="Vue de profil" />);
    expect(screen.getByRole("img", { name: /Plaquette de frein à disque/ })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent("Limite d’usure : 1 mm");
    expect(screen.getByText("Vue de profil")).toBeInTheDocument();
  });

  it("draws a decision-tree option thumbnail without callouts or caption", async () => {
    const { container } = await renderWithIntl(<Illustration id="ill-cockpit-drop" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders nothing for an unknown id", async () => {
    const { container } = await renderWithIntl(<Illustration id="nope" />);
    expect(container).toBeEmptyDOMElement();
  });
});
