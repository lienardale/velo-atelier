/**
 * The i18n core: routing contract, request config (namespace merge + locale
 * fallback) and the `Localized<T>` helpers.
 *
 * `tests/setup.ts` mocks `getRequestConfig` as the identity, so the default
 * export of `request.ts` is the callback itself and can be called directly.
 */
import { describe, expect, it } from "vitest";

import frCommon from "@/messages/fr/common.json";
import enCommon from "@/messages/en/common.json";

import { isLocalized, pickLocalized } from "./localized";
import { NAMESPACES } from "./namespaces";
import requestConfig, { loadMessages } from "./request";
import { isLocale, routing } from "./routing";

type RequestConfigFn = (params: {
  requestLocale: Promise<string | undefined>;
}) => Promise<{ locale: string; messages: Record<string, unknown> }>;

const getConfig = requestConfig as unknown as RequestConfigFn;

describe("routing", () => {
  it("is FR-default, always-prefixed, with no Accept-Language detection (§6.1)", () => {
    expect(routing.locales).toEqual(["fr", "en"]);
    expect(routing.defaultLocale).toBe("fr");
    expect(routing.localePrefix).toBe("always");
    expect(routing.localeDetection).toBe(false);
  });

  it("maps the French internal paths to English ones", () => {
    expect(routing.pathnames["/velo/[id]/controle"]).toEqual({
      fr: "/velo/[id]/controle",
      en: "/bike/[id]/checkup",
    });
    expect(routing.pathnames["/acheter"]).toEqual({ fr: "/acheter", en: "/shop" });
    expect(routing.pathnames["/guides"]).toBe("/guides");
  });

  it("keeps every localized path parameter-compatible with its key", () => {
    for (const [key, value] of Object.entries(routing.pathnames)) {
      const params = (path: string) => (path.match(/\[[^\]]+\]/g) ?? []).sort();
      const localized = typeof value === "string" ? [value] : Object.values(value);
      for (const path of localized) expect(params(path), key).toEqual(params(key));
      if (typeof value !== "string") expect(Object.keys(value).sort(), key).toEqual(["en", "fr"]);
    }
  });

  it("isLocale accepts only the configured locales", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("request config", () => {
  it("merges one top-level object per namespace", async () => {
    const messages = await loadMessages("fr");
    expect(Object.keys(messages).sort()).toEqual([...NAMESPACES].sort());
    expect(messages.common).toEqual(frCommon);
  });

  it("serves the requested locale", async () => {
    const config = await getConfig({ requestLocale: Promise.resolve("en") });
    expect(config.locale).toBe("en");
    expect(config.messages.common).toEqual(enCommon);
  });

  it("falls back to French for a missing or unknown locale", async () => {
    for (const requested of [undefined, "de", ""]) {
      const config = await getConfig({ requestLocale: Promise.resolve(requested) });
      expect(config.locale, String(requested)).toBe("fr");
      expect(config.messages.common).toEqual(frCommon);
    }
  });
});

describe("Localized<T>", () => {
  const isString = (value: unknown): value is string => typeof value === "string";

  it("picks the value for a locale", () => {
    expect(pickLocalized({ fr: "Cadre", en: "Frame" }, "en")).toBe("Frame");
    expect(pickLocalized({ fr: 1, en: 2 }, "fr")).toBe(1);
  });

  it("guards the exact per-locale shape", () => {
    expect(isLocalized({ fr: "a", en: "b" }, isString)).toBe(true);
    expect(isLocalized({ fr: "a" }, isString)).toBe(false);
    expect(isLocalized({ fr: "a", en: "b", de: "c" }, isString)).toBe(false);
    expect(isLocalized({ fr: "a", de: "b" }, isString)).toBe(false);
    expect(isLocalized({ fr: "a", en: 2 }, isString)).toBe(false);
    expect(isLocalized(null, isString)).toBe(false);
    expect(isLocalized(["a", "b"], isString)).toBe(false);
    expect(isLocalized("a", isString)).toBe(false);
  });
});
