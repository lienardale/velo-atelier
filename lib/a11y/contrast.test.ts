import { describe, expect, it } from "vitest";

import {
  composite,
  contrastRatio,
  meetsAA,
  parseColor,
  readColorSchemes,
  relativeLuminance,
} from "./contrast";

describe("parseColor", () => {
  it("reads 3-, 4-, 6- and 8-digit hex", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0008")).toEqual({ r: 0, g: 0, b: 0, a: 0x88 / 255 });
    expect(parseColor(" #1F5F8B ")).toEqual({ r: 31, g: 95, b: 139, a: 1 });
    expect(parseColor("#1f5f8b80")).toEqual({ r: 31, g: 95, b: 139, a: 128 / 255 });
  });

  it("reads rgb() and rgba() in comma and space syntax", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("rgb(1 2 3 / 25%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.25 });
    expect(parseColor("rgb(100% 0% 50%)")).toEqual({ r: 255, g: 0, b: 127.5, a: 1 });
    expect(parseColor("rgb(300 -4 3)")).toEqual({ r: 255, g: 0, b: 3, a: 1 });
  });

  it("reads the two keywords the token file may use", () => {
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("BLACK")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("throws on anything else", () => {
    for (const bad of ["#12", "#12345", "red", "hsl(0 0% 0%)", "rgb(1, 2)", "rgb(1 2 3 4 / 1)"]) {
      expect(() => parseColor(bad), bad).toThrow();
    }
    expect(() => parseColor("rgb(a, 2, 3)")).toThrow(/channel/);
    expect(() => parseColor("rgba(1, 2, 3, x)")).toThrow(/alpha/);
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(relativeLuminance(parseColor("#000"))).toBe(0);
    expect(relativeLuminance(parseColor("#fff"))).toBeCloseTo(1, 10);
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#fff", "#fff")).toBe(1);
    // The canonical AA-boundary grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1f5f8b", "#f7f4ee")).toBeCloseTo(
      contrastRatio("#f7f4ee", "#1f5f8b"),
      10,
    );
  });

  it("composites a translucent foreground over the background", () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
    expect(contrastRatio("rgb(0 0 0 / 0)", "#fff")).toBe(1);
    expect(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(
      21,
    );
  });

  it("refuses a translucent background", () => {
    expect(() => contrastRatio("#000", "#ffffff80")).toThrow(/opaque/);
  });
});

describe("meetsAA", () => {
  it("applies the text, large-text and non-text thresholds", () => {
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.49)).toBe(false);
    expect(meetsAA(3, "large-text")).toBe(true);
    expect(meetsAA(2.99, "large-text")).toBe(false);
    expect(meetsAA(3, "non-text")).toBe(true);
    expect(meetsAA(2.5, "non-text")).toBe(false);
  });
});

describe("readColorSchemes", () => {
  const css = `
    @import "tailwindcss";
    /* a comment with { braces } and --color-fake: #000; */
    @theme {
      --color-*: initial;
      --color-paper: #ffffff;
      --color-ink: #111111;
      --color-alias: var(--color-ink);
    }
    @theme inline {
      --color-background: var(--color-paper);
    }
    :root {
      --header-h: 3.5rem;
      --color-fallback: var(--color-missing, #222222);
      --font: "a;b{c}";
    }
    :root, :host { --color-host: #333333; }
    :root .nested { --color-ignored: #444444; }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --color-paper: #000000;
        .inside { --color-nested: #555555; }
        --color-ink: #eeeeee;
      }
      .other { --color-other: #666666; }
    }
    @media (prefers-reduced-motion: reduce) {
      :root { --color-paper: #777777; }
    }
    @layer base { body { color: red; } }
  `;

  it("collects light tokens from @theme and :root, resolving var()", () => {
    const { light } = readColorSchemes(css);
    expect(light).toMatchObject({
      "--color-paper": "#ffffff",
      "--color-ink": "#111111",
      "--color-alias": "#111111",
      "--header-h": "3.5rem",
      "--color-fallback": "#222222",
      "--font": '"a;b{c}"',
      "--color-host": "#333333",
    });
    expect(light).not.toHaveProperty("--color-background"); // @theme inline = aliases only
    expect(light).not.toHaveProperty("--color-fake"); // commented out
    expect(light).not.toHaveProperty("--color-ignored"); // not :root itself
  });

  it("overrides with the prefers-color-scheme: dark :root block only", () => {
    const { dark } = readColorSchemes(css);
    expect(dark["--color-paper"]).toBe("#000000");
    expect(dark["--color-ink"]).toBe("#eeeeee");
    // Aliases follow the dark value.
    expect(dark["--color-alias"]).toBe("#eeeeee");
    expect(dark).not.toHaveProperty("--color-nested");
    expect(dark).not.toHaveProperty("--color-other");
  });

  it("throws on undefined or circular references and unbalanced braces", () => {
    expect(() => readColorSchemes(":root { --a: var(--nope); }")).toThrow(/not defined/);
    expect(() => readColorSchemes(":root { --a: var(--b); --b: var(--a); }")).toThrow(/circular/);
    expect(() => readColorSchemes(":root { --a: #fff; ")).toThrow(/unbalanced/);
    expect(() => readColorSchemes("--a: #fff; }")).toThrow(/unbalanced/);
  });
});
