/**
 * THREAT — Cross-site request forgery against a server action, and any action
 * that would touch the database before it knows who is calling.
 *
 * A server action is a POST to the page's own URL. A page on `evil.test` can
 * make a browser send that POST with the visitor's cookies attached. Next.js
 * already compares `Origin` with the host, but that check is one config line
 * (`experimental.serverActions.allowedOrigins`) away from being widened, so
 * `assertSameOrigin()` is our own copy of the same lock and this file is what
 * keeps it honest.
 *
 * CONTROLS PINNED
 *
 *   1. `next.config.ts` declares NO `allowedOrigins`. A future entry would make
 *      Next accept a foreign origin, and this test fails before it ships.
 *   2. Every action refuses a foreign, malformed or missing `Origin` with
 *      `FORBIDDEN` — **before** reading the session, so the answer is the same
 *      whether or not the forged request carried a valid cookie.
 *   3. An anonymous caller gets `UNAUTHORIZED` with an EMPTY Prisma call log:
 *      no lookup, no write, nothing that could be timed or observed.
 *   4. The order is origin-then-session. A cross-origin request with a valid
 *      session is `FORBIDDEN`, never `UNAUTHORIZED`, and never executed.
 *   5. **Every** server action is in a table — not the four `compte` actions
 *      this file started with in W1. The exports are read back from every
 *      `"use server"` module under `app/`, whatever its file name: a
 *      `withUser` export needs a row in `EVERY_WITH_USER_ACTION`, and any
 *      other export — sign-in, sign-up and sign-out cannot require a session —
 *      a row in `ANONYMOUS_ACTIONS`. An action added later without a row fails
 *      the run instead of shipping untested.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path read here is derived from `import.meta.url`, never from input */
import { readdirSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCALE_COOKIE } from "@/auth.config";
import { fakeDb } from "@/tests/_fakes/prisma";
import {
  authModule,
  authSpies,
  cookieJar,
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

const connexion = await import("@/app/[locale]/(auth)/connexion/actions");
const inscription = await import("@/app/[locale]/(auth)/inscription/actions");
const compte = await import("@/app/[locale]/(protected)/compte/actions");
const { updateProfileAction, changePasswordAction, setPasswordAction, deleteAccountAction } =
  compte;
const mesVelos = await import("@/app/[locale]/(protected)/mes-velos/actions");
const guestImport = await import("@/app/[locale]/(protected)/import/actions");
const velo = await import("@/app/[locale]/velo/[id]/actions");
const controle = await import("@/app/[locale]/velo/[id]/controle/actions");
const liste = await import("@/app/[locale]/velo/[id]/liste/actions");
const reglages = await import("@/app/[locale]/velo/[id]/reglages/actions");

const { IDLE } = await import("@/lib/actions/result");

type ActionResult<T> = import("@/lib/actions/result").ActionResult<T>;
type FormResult = import("@/lib/actions/result").FormResult;

const USER = {
  id: "00000000-0000-4000-8000-0000000000a1",
  email: "camille@velo-atelier.test",
  name: "Camille",
  locale: "fr" as const,
};

/** Every authenticated action of this task, with a payload that would succeed. */
const ACTIONS = [
  ["updateProfileAction", updateProfileAction, { name: "Camille", locale: "fr" }],
  [
    "changePasswordAction",
    changePasswordAction,
    { current: "Guidon-Tandem-47!", next: "Chaine-Cassette-58?" },
  ],
  ["setPasswordAction", setPasswordAction, { next: "Chaine-Cassette-58?" }],
  ["deleteAccountAction", deleteAccountAction, { confirmation: "SUPPRIMER" }],
] as const satisfies readonly (readonly [
  string,
  (previous: FormResult, formData: FormData) => Promise<ActionResult<boolean>>,
  Record<string, string>,
])[];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  setSession(null);
  setRequestHeaders(sameOriginHeaders());
  fakeDb.reset();
  vi.mocked(authModule().auth).mockClear();
  authSpies.signIn.mockClear();
  authSpies.signOut.mockClear();
});

describe("next.config.ts", () => {
  it("declares no serverActions.allowedOrigins — the Origin check has no exceptions", () => {
    const source = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
    // Comments are stripped first: the file explains *why* there is no
    // `allowedOrigins`, and that sentence must not be read as the setting.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(code).not.toMatch(/allowedOrigins/);
  });
});

describe.each(ACTIONS)("%s", (_name, action, payload) => {
  it("refuses a cross-origin POST with FORBIDDEN and touches no data", async () => {
    setSession(sessionFor(USER));
    setRequestHeaders({
      origin: "https://evil.test",
      host: "localhost:3100",
      "x-forwarded-host": "localhost:3100",
    });

    const result = await action(IDLE, form(payload));

    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it("refuses a POST with no Origin header at all", async () => {
    setSession(sessionFor(USER));
    setRequestHeaders({ host: "localhost:3100" });

    expect(await action(IDLE, form(payload))).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it("refuses a malformed Origin (not a URL)", async () => {
    setSession(sessionFor(USER));
    setRequestHeaders({ origin: "not a url", host: "localhost:3100" });

    expect(await action(IDLE, form(payload))).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it("refuses an Origin on a different port of the same hostname", async () => {
    setSession(sessionFor(USER));
    setRequestHeaders({ origin: "http://localhost:3000", host: "localhost:3100" });

    expect(await action(IDLE, form(payload))).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("answers UNAUTHORIZED to an anonymous caller before any query runs", async () => {
    setSession(null);

    expect(await action(IDLE, form(payload))).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it("checks the origin BEFORE the session — a forged POST cannot probe for one", async () => {
    setSession(null);
    setRequestHeaders({ origin: "https://evil.test", host: "localhost:3100" });

    // FORBIDDEN, not UNAUTHORIZED: the answer must not reveal that the forged
    // request's cookie was missing or invalid.
    expect(await action(IDLE, form(payload))).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});

/**
 * The server actions that run WITHOUT `withUser` — signing in, up or out
 * cannot require a session — each with the side effect a forged POST would be
 * after. They call `guardSameOrigin()` themselves, first.
 */
const ANONYMOUS_ACTIONS: ReadonlyArray<
  readonly [string, () => Promise<{ ok: boolean }>, () => void]
> = [
  [
    "loginAction",
    () => connexion.loginAction(IDLE, form({ email: "a@b.test", password: "whatever" })),
    () => expect(authSpies.signIn).not.toHaveBeenCalled(),
  ],
  [
    "googleSignInAction",
    () => connexion.googleSignInAction(IDLE, form({ locale: "en" })),
    () => {
      expect(authSpies.signIn).not.toHaveBeenCalled();
      // It writes NEXT_LOCALE before it leaves for Google. A forged POST must
      // not get that far either, or any page could switch a visitor's language.
      expect(cookieJar().has(LOCALE_COOKIE)).toBe(false);
    },
  ],
  [
    // Nobody can log a visitor out from a third-party page.
    "signOutAction",
    () => connexion.signOutAction(IDLE, form({ locale: "fr" })),
    () => expect(authSpies.signOut).not.toHaveBeenCalled(),
  ],
  [
    "signUpAction",
    () =>
      inscription.signUpAction(
        IDLE,
        form({ email: "victim@velo-atelier.test", password: "Guidon-Tandem-47!" }),
      ),
    () => expect(fakeDb.rows("User")).toHaveLength(0),
  ],
];

describe("anonymous auth actions", () => {
  describe.each(ANONYMOUS_ACTIONS)("%s", (_name, call, reachedNothing) => {
    it("refuses a cross-origin POST with FORBIDDEN and never reaches Auth.js or the database", async () => {
      setRequestHeaders({ origin: "https://evil.test", host: "localhost:3100" });

      expect(await call()).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(fakeDb.calls).toHaveLength(0);
      reachedNothing();
    });

    it("refuses a POST with no Origin at all", async () => {
      setRequestHeaders({ host: "localhost:3100" });

      expect(await call()).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(fakeDb.calls).toHaveLength(0);
      reachedNothing();
    });

    it("watches something real: a same-origin POST does reach it", async () => {
      // `beforeEach` made this request same-origin. Every success path leaves
      // through a thrown redirect, so the outcome is ignored and only the side
      // effect is read: if the probe passed here too, it could not fail above.
      await call().catch(() => undefined);

      expect(reachedNothing).toThrow();
    });
  });
});

// ── every `withUser` action ──────────────────────────────────────────────────

const BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ITEM = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";

/**
 * Each action with an input that WOULD run if the request were allowed — the
 * origin and session checks come first, so the payload never matters here, but
 * a payload that parses keeps the test honest if the order ever flips.
 */
const EVERY_WITH_USER_ACTION: ReadonlyArray<readonly [string, () => Promise<{ ok: boolean }>]> = [
  ["updateProfileAction", () => updateProfileAction(IDLE, form({ name: "C", locale: "fr" }))],
  [
    "changePasswordAction",
    () => changePasswordAction(IDLE, form({ current: "a", next: "Chaine-Cassette-58?" })),
  ],
  ["setPasswordAction", () => setPasswordAction(IDLE, form({ next: "Chaine-Cassette-58?" }))],
  ["deleteAccountAction", () => deleteAccountAction(IDLE, form({ confirmation: "SUPPRIMER" }))],
  ["reauthenticateWithGoogleAction", () => compte.reauthenticateWithGoogleAction()],
  ["createBikeAction", () => mesVelos.createBikeAction({ name: "Vélo", answers: {} })],
  ["updateBikeAction", () => mesVelos.updateBikeAction({ bikeId: BIKE, answers: {} })],
  ["renameBikeAction", () => mesVelos.renameBikeAction({ bikeId: BIKE, name: "Vélo" })],
  ["deleteBikeAction", () => mesVelos.deleteBikeAction({ bikeId: BIKE })],
  ["importGuestStateAction", () => guestImport.importGuestStateAction({ version: 1, bikes: [] })],
  ["updateBikePartAction", () => velo.updateBikePartAction({ bikeId: BIKE, partId: "chain" })],
  ["updateBikeFitAction", () => reglages.updateBikeFitAction({ bikeId: BIKE, fit: {} })],
  ["loadCheckupAction", () => controle.loadCheckupAction({ bikeId: BIKE })],
  ["listCheckupsAction", () => controle.listCheckupsAction({ bikeId: BIKE })],
  ["saveCheckupAction", () => controle.saveCheckupAction({ bikeId: BIKE, checkup: {} })],
  ["finishCheckupAction", () => controle.finishCheckupAction({ bikeId: BIKE, checkup: {} })],
  [
    "setBuildListItemDoneAction",
    () => liste.setBuildListItemDoneAction({ itemId: ITEM, done: true }),
  ],
  [
    "setBuildListItemRefinementAction",
    () => liste.setBuildListItemRefinementAction({ itemId: ITEM, refinement: {} }),
  ],
  [
    "clearDoneBuildListItemsAction",
    () => liste.clearDoneBuildListItemsAction({ buildListId: ITEM }),
  ],
  ["loadBuildListItemAction", () => liste.loadBuildListItemAction({ bikeId: BIKE, itemId: ITEM })],
];

/**
 * The exports of every `"use server"` module under `app/` — every one of them
 * is a callable endpoint, whatever the file is called — split into the
 * `export const <name> = withUser(` ones and all the others.
 */
function serverActionsInTheTree(): { withUser: string[]; other: string[] } {
  const app = new URL("../../app/", import.meta.url);
  const withUser: string[] = [];
  const other: string[] = [];
  for (const entry of readdirSync(app, { recursive: true, encoding: "utf8" })) {
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
    const source = readFileSync(new URL(entry, app), "utf8");
    // The module-level directive: a line of its own, before any code. A
    // function-level one would be an inline action this walk cannot see, so it
    // is refused outright rather than silently missed.
    if (!/^["']use server["'];?\s*$/m.test(source)) {
      expect(source, `${entry} declares an inline server action`).not.toMatch(
        /^\s+["']use server["']/m,
      );
      continue;
    }
    for (const [line] of source.matchAll(/^export\b.*$/gm)) {
      if (/^export\s+(type|interface)\s/.test(line)) continue; // erased: not an endpoint
      // Anything this cannot name — a default export, `export { … }`,
      // `export *` — fails here instead of escaping both tables. Single spaces
      // are safe to assume: `format:check` holds every file to Prettier.
      const named = /^export (?:async )?(?:function\*? ?|const |let |var )(\w+)/.exec(line);
      expect(named, `${entry}: cannot name the endpoint in "${line}"`).not.toBeNull();
      const name = named![1]!;
      (line.startsWith(`export const ${name} = withUser(`) ? withUser : other).push(name);
    }
  }
  return { withUser: withUser.sort(), other: other.sort() };
}

describe("every server action", () => {
  it("is in a table — an action added without a row fails here", () => {
    const tree = serverActionsInTheTree();
    expect(tree.withUser.length).toBeGreaterThanOrEqual(20);
    expect(EVERY_WITH_USER_ACTION.map(([name]) => name).sort()).toEqual(tree.withUser);
    expect(ANONYMOUS_ACTIONS.map(([name]) => name).sort()).toEqual(tree.other);
  });
});

describe("every withUser action", () => {
  describe.each(EVERY_WITH_USER_ACTION)("%s", (_name, call) => {
    it("refuses a cross-origin POST with FORBIDDEN before any query", async () => {
      setSession(sessionFor(USER));
      setRequestHeaders({ origin: "https://evil.test", host: "localhost:3100" });
      expect(await call()).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(fakeDb.calls).toHaveLength(0);
    });

    it("refuses a POST with no Origin at all", async () => {
      setSession(sessionFor(USER));
      setRequestHeaders({ host: "localhost:3100" });
      expect(await call()).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(fakeDb.calls).toHaveLength(0);
    });

    it("answers UNAUTHORIZED to an anonymous same-origin caller before any query", async () => {
      setSession(null);
      expect(await call()).toEqual({ ok: false, code: "UNAUTHORIZED" });
      expect(fakeDb.calls).toHaveLength(0);
    });
  });
});
