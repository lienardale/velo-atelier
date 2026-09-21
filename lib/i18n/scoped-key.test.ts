/**
 * `translateScopedKey` — the resolver behind the per-route message namespaces
 * (§1.2 message keys, `.debug/008`): a runtime key is resolved inside the ONE
 * namespace its first segment names, so a route can declare exactly the
 * namespaces its client components read.
 */
import { describe, expect, it, vi } from "vitest";

import { translateScopedKey, type ScopedTranslator } from "./scoped-key";

function recorder(name: string): ScopedTranslator & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const translate = ((key: string, values?: Record<string, string | number>) => {
    calls.push([key, values]);
    return `${name}:${key}`;
  }) as ScopedTranslator & { calls: unknown[][] };
  translate.calls = calls;
  return translate;
}

describe("translateScopedKey", () => {
  it("looks a key up inside the namespace its first segment names", () => {
    const errors = recorder("errors");
    const bike = recorder("bike");
    expect(translateScopedKey("errors.invalidCredentials", { errors, bike })).toBe(
      "errors:invalidCredentials",
    );
    // Only the FIRST segment is the namespace: the rest is a path inside it.
    expect(translateScopedKey("bike.errors.fitRange", { errors, bike })).toBe(
      "bike:errors.fitRange",
    );
    expect(bike.calls).toEqual([["errors.fitRange", undefined]]);
  });

  it("forwards ICU values to the translator it picked", () => {
    const parts = recorder("parts");
    translateScopedKey("parts.units.speeds", { parts }, { value: 12 });
    expect(parts.calls).toEqual([["units.speeds", { value: 12 }]]);
  });

  it("hands a key from an undeclared namespace to the first translator, unchanged", () => {
    // next-intl then reports MISSING_MESSAGE and renders its fallback: a visible
    // failure, never a key silently resolved against the wrong namespace.
    const errors = recorder("errors");
    const auth = recorder("auth");
    expect(translateScopedKey("rules.brakes.message", { errors, auth })).toBe(
      "errors:rules.brakes.message",
    );
    expect(translateScopedKey("VALIDATION", { errors, auth })).toBe("errors:VALIDATION");
    expect(translateScopedKey(".leading-dot", { errors, auth })).toBe("errors:.leading-dot");
    expect(auth.calls).toEqual([]);
  });

  it("does not treat an inherited property as a namespace", () => {
    const errors = recorder("errors");
    const spy = vi.fn();
    Object.defineProperty(Object.prototype, "__scopedKeyProbe", {
      value: spy,
      configurable: true,
    });
    try {
      expect(translateScopedKey("__scopedKeyProbe.x", { errors })).toBe(
        "errors:__scopedKeyProbe.x",
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      delete (Object.prototype as Record<string, unknown>).__scopedKeyProbe;
    }
  });

  it("refuses to run with no translator at all", () => {
    expect(() => translateScopedKey("errors.VALIDATION", {})).toThrow(/no translator/);
  });
});
