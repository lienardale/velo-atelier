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
 *
 * W4 widened "free text" past the auth surface to everything else a visitor
 * types and gets shown again — a bike's name, a checkup note, a refinement
 * answer, a chosen product's brand and model — each written through its REAL
 * action (or the guest import, for the product), read back through its real
 * reader, and rendered by the component that shows it on the site.
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
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));

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

// ── the rest of what a visitor types ────────────────────────────────────────

const { renameBikeAction } = await import("@/app/[locale]/(protected)/mes-velos/actions");
const { saveCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
const { loadStoredCheckup } = await import("@/app/[locale]/velo/[id]/controle/load");
const { setBuildListItemRefinementAction } = await import("@/app/[locale]/velo/[id]/liste/actions");
const { loadBuildList } = await import("@/app/[locale]/velo/[id]/liste/load");
const { importGuestStateAction } = await import("@/app/[locale]/(protected)/import/actions");
const { BikeCard } = await import("@/components/account/BikeCard");
const { SymptomPicker } = await import("@/components/checkup/SymptomPicker");
const { BuildItemCard } = await import("@/components/build-list/BuildItemCard");
const { RefinementForm } = await import("@/components/build-list/RefinementForm");
const { NextIntlClientProvider } = await import("next-intl");
const { loadMessages } = await import("@/lib/i18n/request");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");
const { shopQuestionsFor } = await import("@/lib/shop/questions");
const { GUEST_STATE_VERSION } = await import("@/lib/guest/schema");

const FR = await loadMessages("fr");

/** Server-side render inside the provider the app uses, with the real catalogue. */
function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    // A `.ts` file has no JSX, and the provider's props type requires `children`.
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: "fr",
      messages: FR,
      timeZone: "Europe/Paris",
      children: node,
    }),
  );
}

/** What React's renderer does to text and attribute values (`escapeTextForBrowser`). */
function escaped(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** The tags a payload would try to smuggle in, counted per render. */
const TAGS = [/<script\b/gi, /<img\b/gi, /<svg\b/gi, /<iframe\b/gi] as const;
const tagCounts = (html: string) => TAGS.map((tag) => (html.match(tag) ?? []).length);

/**
 * The payload reached the page as TEXT: the component renders exactly the tags
 * it renders for a harmless value (its own icons included), the payload is
 * there in its escaped form, never raw, and no link points at script.
 */
function expectInert(html: string, benign: string, payload: string): void {
  expect(tagCounts(html)).toEqual(tagCounts(benign));
  expect(html).not.toMatch(/href="javascript:/i);
  expect(html).toContain(escaped(payload));
  if (/[<>"']/.test(payload)) expect(html).not.toContain(payload);
}

describe("stored verbatim, rendered as text — the rest of the site", () => {
  const PLANNED = "check-drivetrain#chain-wear";
  const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  let userId: string;
  let bikeId: string;

  beforeEach(async () => {
    const user = (await fakeDb.seed("User", {
      email: "camille@velo-atelier.test",
      name: "Camille",
      locale: "fr",
    })) as { id: string; email: string; name: string; locale: "fr" };
    userId = user.id;
    bikeId = (
      (await fakeDb.seed("Bike", {
        userId,
        name: "Gravel",
        answers: DERIVED.answers,
        spec: DERIVED.spec,
        parts: DERIVED.parts,
      })) as { id: string }
    ).id;
    setSession(sessionFor(user));
  });

  it.each(PAYLOADS)("a bike name %j, on its card", async (payload) => {
    expect((await renameBikeAction({ bikeId, name: payload })).ok).toBe(true);
    const stored = fakeDb.rows("Bike")[0]?.name as string;
    expect(stored).toBe(payload.trim());

    const view = (name: string) =>
      render(
        createElement(BikeCard, {
          id: bikeId,
          name,
          summary: "Gravel",
          updatedAt: "2026-09-21T08:00:00.000Z",
        }),
      );
    expectInert(view(stored), view("Gravel"), payload);
  });

  it.each(PAYLOADS)("a checkup note %j, in the symptom picker", async (payload) => {
    const checkup = {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "demo" },
      scope: { kind: "full" },
      locale: "fr",
      answers: { [PLANNED]: "ko" },
      symptoms: { [PLANNED]: ["chain-elongation"] },
      notes: { [PLANNED]: payload },
      toolsMissing: [],
      startedAt: "2026-09-21T08:00:00.000Z",
      contentVersion: CONTENT_VERSION,
    };
    expect((await saveCheckupAction({ bikeId, checkup })).ok).toBe(true);
    expect(fakeDb.rows("CheckupItem")[0]?.notes).toBe(payload);

    const restored = await loadStoredCheckup(bikeId, userId, "fr");
    const view = (note: string) =>
      render(
        createElement(SymptomPicker, {
          stepKey: PLANNED,
          options: [],
          value: "chain-elongation",
          onPick: () => undefined,
          note,
          onNoteChange: () => undefined,
          reasonLabel: (key: string) => key,
          guideTitle: () => null,
          isStub: () => false,
        }),
      );
    // eslint-disable-next-line security/detect-object-injection -- a literal step key
    expectInert(view(restored?.notes[PLANNED] ?? ""), view("elle saute"), payload);
  });

  it.each(PAYLOADS)("a refinement answer %j, back in its form", async (payload) => {
    const build = { spec: DERIVED.spec, parts: DERIVED.parts };
    // A part whose buying question is a free field, where the raw value is echoed.
    const [partId, key] = DERIVED.parts
      .map((part) => [part.partId, shopQuestionsFor(build, part.partId as never, "fr")] as const)
      .flatMap(([id, questions]) =>
        questions.filter((q) => q.options === null && q.partId === id).map((q) => [id, q.key]),
      )[0];
    const list = (await fakeDb.seed("BuildList", { bikeId, name: "" })) as { id: string };
    const item = (await fakeDb.seed("BuildListItem", {
      buildListId: list.id,
      partId,
      action: "REPLACE",
      reasonKey: "chain-elongation",
    })) as { id: string };

    expect(
      await setBuildListItemRefinementAction({ itemId: item.id, refinement: { [key]: payload } }),
    ).toEqual({ ok: true, data: null });
    const [loaded] = (await loadBuildList(bikeId, userId)).items;
    // eslint-disable-next-line security/detect-object-injection -- `key` is an attribute key from the catalogue
    expect(loaded.refinement?.[key]).toBe(payload);

    const view = (refinement: Readonly<Record<string, string>>) =>
      render(
        createElement(RefinementForm, {
          build,
          partId,
          refinement,
          locale: "fr",
          itemId: loaded.id,
          onChange: () => undefined,
        }),
      );
    expectInert(view(loaded.refinement ?? {}), view({ [key]: "42" }), payload);
  });

  it.each(PAYLOADS)("a chosen product's brand and model %j, on the list", async (payload) => {
    const imported = await importGuestStateAction({
      version: GUEST_STATE_VERSION,
      bikes: [
        {
          localId: "11111111-2222-4333-8444-555555555555",
          name: "Mon vélo",
          answers: BIKE_PRESETS["gravel-1x11"],
          parts: DERIVED.parts,
          fit: null,
          updatedAt: "2026-09-14T09:00:00.000Z",
          checkups: [],
          lists: [
            {
              name: "Révision",
              items: [
                {
                  partId: "chain",
                  action: "replace",
                  reasonKey: "chain-elongation",
                  guideSlug: "replace-chain",
                  done: false,
                  sortOrder: 0,
                  chosenProduct: {
                    brand: payload,
                    model: payload,
                    size: "11v",
                    vendor: "alltricks",
                    url: "https://www.alltricks.fr/C-40598-toutes-les-chaines",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(imported.ok).toBe(true);
    const importedBike = fakeDb.rows("Bike").find((row) => row.name === "Mon vélo");
    const [line] = (await loadBuildList(importedBike?.id as string, userId)).items;
    expect(line.chosenProduct).toMatchObject({ brand: payload, model: payload });

    const view = (item: typeof line) =>
      render(
        createElement(BuildItemCard, {
          item,
          build: null,
          locale: "fr",
          bikeParam: importedBike?.id as string,
          onChange: () => undefined,
        }),
      );
    const html = view(line);
    expect(html).toContain('data-testid="build-item-chosen"');
    const benign = view({
      ...line,
      chosenProduct: { ...line.chosenProduct!, brand: "KMC", model: "X11" },
    });
    expectInert(html, benign, payload);
  });
});
