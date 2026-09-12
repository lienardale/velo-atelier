/**
 * WCAG 2.x contrast, computed — not eyeballed.
 *
 * - `parseColor` reads the colour syntaxes the token file uses (`#rgb`,
 *   `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` in comma or space form).
 * - `contrastRatio(fg, bg)` is the WCAG 2.2 ratio (1–21), with a translucent
 *   foreground composited over the background first.
 * - `readColorSchemes(css)` extracts the light and dark custom properties from
 *   `styles/globals.css` (Tailwind v4 `@theme` + `:root`, and the
 *   `@media (prefers-color-scheme: dark)` block), resolving `var()` references.
 *
 * `tests/unit/tokens-contrast.test.ts` runs every text token against both
 * papers in both themes through these functions (§6.5).
 */
/* eslint-disable security/detect-object-injection -- integer offsets into a string, and names read from our own stylesheet */

export interface Rgba {
  r: number; // 0–255
  g: number;
  b: number;
  a: number; // 0–1
}

/** WCAG AA thresholds. Large text = ≥ 24 px, or ≥ 18.66 px bold; non-text UI = 1.4.11. */
export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\(\s*([^)]*)\)$/i;

function channel(raw: string): number {
  const value = raw.trim();
  if (value.endsWith("%")) return clamp((parseFloat(value) / 100) * 255, 0, 255);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid colour channel "${raw}"`);
  return clamp(parsed, 0, 255);
}

function alpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = raw.trim();
  const parsed = value.endsWith("%") ? parseFloat(value) / 100 : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid alpha "${raw}"`);
  return clamp(parsed, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parse a CSS colour. Throws on anything it does not understand (a typo must fail loudly). */
export function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase();

  const hex = HEX.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    const byte = (index: number) => parseInt(digits.slice(index, index + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) / 255 : 1 };
  }

  const fn = RGB_FN.exec(value);
  if (fn) {
    // `rgb(1, 2, 3)`, `rgba(1, 2, 3, .5)`, `rgb(1 2 3)`, `rgb(1 2 3 / 50%)`.
    const [colour, slashAlpha] = fn[1].split("/");
    const parts = colour.includes(",")
      ? colour.split(",").map((p) => p.trim())
      : colour.trim().split(/\s+/);
    if (parts.length < 3 || parts.length > 4 || (parts.length === 4 && slashAlpha !== undefined)) {
      throw new Error(`Invalid colour "${input}"`);
    }
    return {
      r: channel(parts[0]),
      g: channel(parts[1]),
      b: channel(parts[2]),
      a: alpha(slashAlpha ?? parts[3]),
    };
  }

  if (value === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (value === "black") return { r: 0, g: 0, b: 0, a: 1 };

  throw new Error(`Unsupported colour "${input}"`);
}

/** `fg` painted over an opaque `bg` (source-over). */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG relative luminance (sRGB, 0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Contrast ratio of `foreground` on `background`, 1 to 21. A translucent
 * background is refused: its contrast depends on what is behind it.
 */
export function contrastRatio(foreground: string | Rgba, background: string | Rgba): number {
  const bg = typeof background === "string" ? parseColor(background) : background;
  if (bg.a < 1) throw new Error("contrastRatio(): the background must be opaque");
  const fgRaw = typeof foreground === "string" ? parseColor(foreground) : foreground;
  const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
  const [light, dark] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Whether `ratio` meets WCAG AA for normal text, large text, or non-text UI. */
export function meetsAA(ratio: number, kind: "text" | "large-text" | "non-text" = "text"): boolean {
  const min =
    kind === "text" ? AA_NORMAL_TEXT : kind === "large-text" ? AA_LARGE_TEXT : AA_NON_TEXT;
  return ratio >= min;
}

// ── Reading the token file ────────────────────────────────────────────────────

interface CssBlock {
  prelude: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Index just past the string literal that starts at `start` (a quote character). */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length && css[i] !== quote) i += css[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** The `{ … }` blocks at the top level of `css` (a stylesheet or a block body). */
function blocks(css: string): CssBlock[] {
  const found: CssBlock[] = [];
  let preludeStart = 0;
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
    } else if (ch === ";") {
      preludeStart = ++i; // an at-statement (`@import …;`) or a declaration
    } else if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '"' || css[j] === "'") {
          j = skipString(css, j);
          continue;
        }
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      if (depth !== 0) throw new Error("readColorSchemes(): unbalanced braces");
      found.push({ prelude: css.slice(preludeStart, i).trim(), body: css.slice(i + 1, j - 1) });
      i = preludeStart = j;
    } else if (ch === "}") {
      throw new Error("readColorSchemes(): unbalanced braces");
    } else {
      i++;
    }
  }
  return found;
}

/** `--name: value;` declarations of a block body; nested rules are skipped whole. */
function customProperties(body: string): Map<string, string> {
  const props = new Map<string, string>();
  const take = (declaration: string) => {
    const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration);
    if (match) props.set(match[1], match[2]);
  };
  let fragment = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(body, i);
      fragment += body.slice(i, end);
      i = end;
    } else if (ch === "{") {
      // A nested rule: `fragment` is its prelude. Drop both.
      let depth = 1;
      i++;
      while (i < body.length && depth > 0) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}") depth--;
        i++;
      }
      fragment = "";
    } else if (ch === ";") {
      take(fragment);
      fragment = "";
      i++;
    } else {
      fragment += ch;
      i++;
    }
  }
  take(fragment);
  return props;
}

/** `:root`, or a selector list made only of `:root` / `:host` (Tailwind's own output shape). */
const isRoot = (prelude: string) => {
  const selectors = prelude.split(",").map((s) => s.trim());
  return selectors.includes(":root") && selectors.every((s) => s === ":root" || s === ":host");
};
const isThemeBlock = (prelude: string) => /^@theme\b/.test(prelude) && !/\binline\b/.test(prelude);
const isDarkMedia = (prelude: string) =>
  /^@media\b/.test(prelude) && /prefers-color-scheme\s*:\s*dark/.test(prelude);

function resolve(props: Map<string, string>, value: string, seen: Set<string>): string {
  return value.replace(
    // eslint-disable-next-line security/detect-unsafe-regex -- linear (no nested repetition over the same input); runs on our own stylesheet
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_, name: string, fallback?: string) => {
      if (seen.has(name)) throw new Error(`readColorSchemes(): circular var(${name})`);
      const target = props.get(name);
      if (target === undefined) {
        if (fallback !== undefined) return resolve(props, fallback, seen);
        throw new Error(`readColorSchemes(): var(${name}) is not defined`);
      }
      return resolve(props, target, new Set([...seen, name]));
    },
  );
}

function resolveAll(props: Map<string, string>): Record<string, string> {
  return Object.fromEntries(
    [...props].map(([name, value]) => [name, resolve(props, value, new Set([name]))]),
  );
}

/**
 * The custom properties in effect for each colour scheme.
 *
 *   light = `@theme` blocks (not `@theme inline`) + top-level `:root` blocks
 *   dark  = light, overridden by `:root` inside `@media (prefers-color-scheme: dark)`
 *
 * Later declarations win, as in the cascade. `var()` references are resolved;
 * a reference to an undefined property without a fallback throws.
 */
export function readColorSchemes(css: string): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const topLevel = blocks(stripComments(css));
  const light = new Map<string, string>();
  const darkOverrides = new Map<string, string>();

  for (const block of topLevel) {
    if (isThemeBlock(block.prelude) || isRoot(block.prelude)) {
      for (const [name, value] of customProperties(block.body)) light.set(name, value);
    } else if (isDarkMedia(block.prelude)) {
      for (const inner of blocks(block.body)) {
        if (!isRoot(inner.prelude)) continue;
        for (const [name, value] of customProperties(inner.body)) darkOverrides.set(name, value);
      }
    }
  }

  return {
    light: resolveAll(light),
    dark: resolveAll(new Map([...light, ...darkOverrides])),
  };
}
