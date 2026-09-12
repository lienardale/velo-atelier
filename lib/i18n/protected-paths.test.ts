import { describe, expect, it } from "vitest";

import {
  ANON_ONLY_KEYS,
  ANON_ONLY_PATHS,
  externalPaths,
  localizedPath,
  pathAccess,
  PROTECTED_KEYS,
  PROTECTED_PATHS,
  splitLocale,
} from "./protected-paths";
import { routing } from "./routing";

describe("protected-paths", () => {
  it("names the §4.3 keys, all of them real routes", () => {
    expect(PROTECTED_KEYS).toEqual(["/compte", "/mes-velos", "/import"]);
    expect(ANON_ONLY_KEYS).toEqual(["/connexion", "/inscription"]);
    for (const key of [...PROTECTED_KEYS, ...ANON_ONLY_KEYS]) {
      expect(Object.keys(routing.pathnames)).toContain(key);
    }
  });

  it("expands every key to its external path in every locale", () => {
    expect(PROTECTED_PATHS).toEqual([
      "/fr/compte",
      "/en/account",
      "/fr/mes-velos",
      "/en/my-bikes",
      "/fr/import",
      "/en/import",
    ]);
    expect(ANON_ONLY_PATHS).toEqual([
      "/fr/connexion",
      "/en/sign-in",
      "/fr/inscription",
      "/en/sign-up",
    ]);
    expect(externalPaths(["/"])).toEqual(["/fr", "/en"]);
  });

  it("reads localized paths straight from routing.pathnames", () => {
    expect(localizedPath("/compte", "en")).toBe("/account");
    expect(localizedPath("/compte", "fr")).toBe("/compte");
    expect(localizedPath("/guides", "en")).toBe("/guides");
    expect(localizedPath("/velo/[id]", "en")).toBe("/bike/[id]");
  });

  describe("splitLocale", () => {
    it("splits a known locale prefix", () => {
      expect(splitLocale("/en/account/x")).toEqual({ locale: "en", rest: "/account/x" });
      expect(splitLocale("/fr")).toEqual({ locale: "fr", rest: "/" });
      expect(splitLocale("/fr/")).toEqual({ locale: "fr", rest: "/" });
    });

    it("leaves anything else alone", () => {
      expect(splitLocale("/connexion")).toEqual({ locale: null, rest: "/connexion" });
      expect(splitLocale("/french")).toEqual({ locale: null, rest: "/french" });
      expect(splitLocale("/de/x")).toEqual({ locale: null, rest: "/de/x" });
      expect(splitLocale("/")).toEqual({ locale: null, rest: "/" });
    });
  });

  describe("pathAccess", () => {
    it("flags the signed-in area, including sub-paths and a trailing slash", () => {
      for (const path of [
        "/fr/compte",
        "/en/account",
        "/en/account/",
        "/fr/mes-velos/x",
        "/en/import",
      ]) {
        expect(pathAccess(path), path).toBe("protected");
      }
    });

    it("flags the auth pages as anonymous-only", () => {
      for (const path of ["/fr/connexion", "/en/sign-in", "/fr/inscription", "/en/sign-up/"]) {
        expect(pathAccess(path), path).toBe("anon-only");
      }
    });

    it("treats everything else as public — no prefix collisions, no unprefixed matches", () => {
      for (const path of [
        "/",
        "/fr",
        "/en/guides",
        "/fr/comptes",
        "/en/accounts",
        "/fr/velo/demo",
        "/compte",
        "/connexion",
        "/fr/importer",
      ]) {
        expect(pathAccess(path), path).toBe("public");
      }
    });
  });
});
