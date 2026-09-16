/**
 * THREAT — Stored cross-site scripting through a form field.
 *
 * The auth surface takes three free-text values that are later rendered back:
 * the display name (in the header menu and on the account page), the e-mail
 * address, and the delete-account confirmation. A payload stored verbatim and
 * rendered as HTML would run with the victim's session.
 *
 * React escapes text children, which is the real defence; this file pins the
 * two things that would defeat it:
 *
 *   1. **nothing is sanitised on the way in.** A name is stored exactly as
 *      typed. Stripping tags server-side looks safer and is not: it produces a
 *      second, different string that the next renderer has to be trusted with,
 *      and it silently corrupts legitimate names (`<3`, `Ren & Stimpy`).
 *   2. **`dangerouslySetInnerHTML` exists nowhere outside `components/mdx/`**,
 *      which is where compiled MDX is rendered and the only place where the
 *      input is authored in-repo rather than typed by a visitor. A grep test,
 *      because this is a property of the tree, not of one module.
 *
 * The rendering assertions go through `react-dom/server` rather than a DOM:
 * this tier runs in node, and escaping is a property of the renderer, not of
 * jsdom.
 *
 * CONTROLS PINNED — plus the length cap (a name is `VARCHAR(80)` and the schema
 * refuses 81 characters, so a payload cannot be smuggled in by being long), and
 * the rule that a rendered message is always a KEY from a closed set, never
 * text the visitor supplied.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path read here is derived from `import.meta.url`, never from input */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_ERROR_CODES, IDLE } from "@/lib/actions/result";
import { hashPassword } from "@/lib/auth/password";
import { fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { updateProfileAction } = await import("@/app/[locale]/(protected)/compte/actions");

const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg/onload=alert(1)>',
  "javascript:alert(1)",
  "<iframe src=javascript:alert(1)>",
  "</textarea><script>alert(1)</script>",
  "{{constructor.constructor('alert(1)')()}}",
] as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const ROOT = new URL("../../", import.meta.url).pathname;

/** Every source file under the given roots, excluding generated trees. */
function sourceFiles(roots: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  return files;
}

beforeEach(() => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
});

describe("storage", () => {
  beforeEach(async () => {
    const user = await fakeDb.seed("User", {
      email: "camille@velo-atelier.test",
      name: "Camille",
      locale: "fr",
      passwordHash: await hashPassword("Guidon-Tandem-47!", 4),
    });
    setSession(sessionFor(user as unknown as { id: string; email: string }));
  });

  it.each(PAYLOADS)("stores %j verbatim — sanitising on the way in is the bug", async (payload) => {
    const result = await updateProfileAction(IDLE, form({ name: payload, locale: "fr" }));

    expect(result).toEqual({ ok: true, data: true });
    expect(fakeDb.rows("User")[0]?.name).toBe(payload.trim());
  });

  it("caps a name at the column width, so no payload arrives by being long", async () => {
    const result = await updateProfileAction(
      IDLE,
      form({ name: "<script>".padEnd(81, "a"), locale: "fr" }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { name: "errors.nameTooLong" },
    });
  });

  it("keeps a legitimate name with angle brackets and ampersands intact", async () => {
    await updateProfileAction(IDLE, form({ name: "Ren & Stimpy <3", locale: "fr" }));

    expect(fakeDb.rows("User")[0]?.name).toBe("Ren & Stimpy <3");
  });
});

describe("rendering", () => {
  it.each(PAYLOADS)("escapes %j into text, never markup", (payload) => {
    const html = renderToStaticMarkup(createElement("p", null, payload));

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<iframe");
    // `onerror=` may well appear — as inert text inside the escaped string.
    // What must not appear is a tag boundary, which is what the checks above
    // look for: `<` survives only as an entity.
    if (payload.includes("<")) expect(html).toContain("&lt;");
  });

  it("escapes a payload used as an attribute value too", () => {
    const html = renderToStaticMarkup(
      createElement("a", { href: "/fr/compte", title: '"><script>alert(1)</script>' }, "compte"),
    );

    expect(html).not.toContain("<script");
    expect(html).toContain("&quot;");
  });
});

describe("the tree as a whole", () => {
  it("uses dangerouslySetInnerHTML nowhere outside components/mdx/", () => {
    const offenders = sourceFiles(["app", "lib", "components"])
      .filter((file) => readFileSync(file, "utf8").includes("dangerouslySetInnerHTML"))
      .filter((file) => !file.includes("/components/mdx/"))
      .map((file) => file.slice(ROOT.length));

    expect(offenders).toEqual([]);
  });

  it("never calls eval, new Function or document.write in application code", () => {
    const offenders = sourceFiles(["app", "lib", "components"])
      .filter((file) => {
        const source = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .map((line) => line.replace(/\/\/.*$/, ""))
          .join("\n");
        return /\bnew Function\s*\(|\beval\s*\(|document\.write\s*\(/.test(source);
      })
      .map((file) => file.slice(ROOT.length));

    expect(offenders).toEqual([]);
  });

  it("keeps the failure codes a closed set, so no code renders visitor text", () => {
    // A form renders `t(result.code)`; if `code` could be an arbitrary string
    // it would be a key lookup on attacker input. It cannot: it is one of seven.
    expect(ACTION_ERROR_CODES).toEqual([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION",
      "RATE_LIMITED",
      "TOO_MANY",
      "CONFLICT",
    ]);
  });
});
