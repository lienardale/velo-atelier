/**
 * The design tokens meet WCAG 2.1 AA — computed from the real stylesheet (§6.5).
 *
 * `styles/globals.css` is parsed with `readColorSchemes()` (light = `@theme` +
 * `:root`, dark = the `prefers-color-scheme: dark` overrides) and every pair
 * below is measured with `contrastRatio()`:
 *
 *   text on paper   ink, ink-muted, accent and every status `*-fg`   ≥ 4.5:1
 *                   on `paper` AND `paper-2`, in light AND dark
 *   text on accent  `accent-fg` on `accent` (primary buttons)        ≥ 4.5:1
 *   focus ring      `ring` on both papers (WCAG 1.4.11, non-text)    ≥ 3:1
 *
 * `accent-fg` is the one `*-fg` token that is not text-on-paper — it is the
 * label colour ON an accent fill (white on blue in light) — so it is measured
 * against `accent`, where it is actually used.
 *
 * Changing a token value either keeps these green or fails the build; the
 * last block proves the check is live by degrading a token in memory.
 */
/* eslint-disable security/detect-object-injection -- token names come from our own stylesheet */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AA_NON_TEXT, AA_NORMAL_TEXT, contrastRatio, readColorSchemes } from "@/lib/a11y/contrast";

const CSS = readFileSync(join(process.cwd(), "styles/globals.css"), "utf8");
const SCHEMES = ["light", "dark"] as const;
const PAPERS = ["--color-paper", "--color-paper-2"] as const;

type Tokens = Record<string, string>;

/** Text tokens: ink, ink-muted, accent, and every status `*-fg` found in the file. */
function textTokens(tokens: Tokens): string[] {
  const statusFg = Object.keys(tokens).filter(
    (name) => /^--color-[\w-]+-fg$/.test(name) && name !== "--color-accent-fg",
  );
  return ["--color-ink", "--color-ink-muted", "--color-accent", ...statusFg];
}

interface Failure {
  scheme: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

/** Every pair below its threshold, as readable records. */
function audit(css: string): Failure[] {
  const schemes = readColorSchemes(css);
  const failures: Failure[] = [];
  const check = (scheme: string, tokens: Tokens, fg: string, bg: string, min: number) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    if (ratio < min) failures.push({ scheme, fg, bg, ratio: Number(ratio.toFixed(2)), min });
  };
  for (const scheme of SCHEMES) {
    const tokens = schemes[scheme];
    for (const paper of PAPERS) {
      for (const fg of textTokens(tokens)) check(scheme, tokens, fg, paper, AA_NORMAL_TEXT);
      check(scheme, tokens, "--color-ring", paper, AA_NON_TEXT);
    }
    check(scheme, tokens, "--color-accent-fg", "--color-accent", AA_NORMAL_TEXT);
  }
  return failures;
}

describe("design tokens (styles/globals.css)", () => {
  const schemes = readColorSchemes(CSS);

  it("declares the §6.5 palette in the light theme", () => {
    expect(schemes.light).toMatchObject({
      "--color-paper": "#f7f4ee",
      "--color-paper-2": "#efeae1",
      "--color-ink": "#1c1a17",
      "--color-ink-muted": "#5c574f",
      "--color-rule": "#d9d2c5",
      "--color-accent": "#1f5f8b",
      "--color-accent-fg": "#ffffff",
      "--color-warn": "#d9741c",
      "--color-warn-fg": "#8a4409",
      "--color-danger": "#b23a2f",
      "--color-success": "#2e7d4f",
      "--header-h": "3.5rem",
    });
    for (const name of ["--color-danger-fg", "--color-success-fg", "--color-ring"]) {
      expect(schemes.light[name], name).toBeTruthy();
    }
  });

  it("redefines every palette colour in the dark theme", () => {
    const palette = Object.keys(schemes.light).filter(
      (name) => name.startsWith("--color-") && !["--color-black", "--color-white"].includes(name),
    );
    expect(palette.length).toBeGreaterThanOrEqual(14);
    const unchanged = palette.filter((name) => schemes.dark[name] === schemes.light[name]);
    expect(unchanged, `not overridden in the dark block: ${unchanged.join(", ")}`).toEqual([]);
  });

  it("measures the status *-fg text tokens, not only the named ones", () => {
    expect(textTokens(schemes.light)).toEqual(
      expect.arrayContaining(["--color-warn-fg", "--color-danger-fg", "--color-success-fg"]),
    );
  });

  for (const scheme of SCHEMES) {
    describe(`${scheme} theme`, () => {
      const tokens = schemes[scheme];

      for (const paper of PAPERS) {
        for (const fg of textTokens(tokens)) {
          it(`${fg} on ${paper} ≥ 4.5:1`, () => {
            expect(contrastRatio(tokens[fg], tokens[paper])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
          });
        }

        it(`--color-ring on ${paper} ≥ 3:1`, () => {
          expect(contrastRatio(tokens["--color-ring"], tokens[paper])).toBeGreaterThanOrEqual(
            AA_NON_TEXT,
          );
        });
      }

      it("--color-accent-fg on --color-accent ≥ 4.5:1", () => {
        expect(
          contrastRatio(tokens["--color-accent-fg"], tokens["--color-accent"]),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    });
  }

  it("the real stylesheet has no failing pair", () => {
    expect(audit(CSS)).toEqual([]);
  });

  describe("the check is live", () => {
    it("fails when a light text token is degraded", () => {
      const degraded = CSS.replace("--color-ink-muted: #5c574f;", "--color-ink-muted: #a8a29a;");
      expect(degraded).not.toBe(CSS);
      expect(audit(degraded)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scheme: "light",
            fg: "--color-ink-muted",
            bg: "--color-paper",
          }),
        ]),
      );
    });

    it("fails when a dark status token is degraded", () => {
      const degraded = CSS.replace("--color-danger-fg: #f39a90;", "--color-danger-fg: #7a2a22;");
      expect(degraded).not.toBe(CSS);
      expect(audit(degraded)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scheme: "dark", fg: "--color-danger-fg" }),
        ]),
      );
    });
  });
});
