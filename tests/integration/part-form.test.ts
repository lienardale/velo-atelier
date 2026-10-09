/**
 * The part edit form of a SAVED bike, client and server and database in one
 * process (`.debug/017` §5.8).
 *
 * The form's four properties are held on the panel and on the workspace by
 * `components/bike/{PartsPanel,BikeWorkspace}.test.tsx`, against an action
 * that answers LIKE `updateBikePartAction`. Here it is the real one:
 *
 *   - the props are what the real page function
 *     (`app/[locale]/velo/[id]/page.tsx`) computes for the address bar, from
 *     the real `_test` PostgreSQL;
 *   - the real `BikeWorkspace` is rendered in jsdom and driven with pointer and
 *     keyboard only;
 *   - every write is the real `updateBikePartAction`, called by the real
 *     `remoteBikeRepo` the workspace builds. It is SPIED, not replaced: each
 *     call is recorded and goes on to the real action and the real database;
 *   - after a write the page function is run again for the URL as the viewer
 *     left it and the workspace re-rendered with the result — what the
 *     action's `revalidatePath("/[locale]/velo/[id]", "page")` makes Next do.
 *
 * What is asserted is what PostgreSQL holds. Before 2026-10-09 the first case
 * ended with the owner's 38 mm rear tyre at 45, and the second with a stock
 * dropper post at 140 mm of travel — nothing typed, the server answering ok.
 *
 * NOT real: HTTP and the flight serialisation of props and action calls (the
 * action is a plain function here, so nothing queues two calls the way Next's
 * client does); the browser — jsdom has no WebGL, so a part is picked on the
 * silhouette the site serves before the 3D is up; `next/dynamic` (the lazy 3D
 * chunk and the guest resume banner render nothing). A real browser, a real
 * canvas and a real server are `tests/e2e/part-panel.spec.ts`.
 *
 * jsdom is installed by hand on the node environment: a per-file environment
 * docblock would switch Vite to its client transform, where
 * `import "server-only"` does not resolve.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import { prisma } from "@/lib/db/prisma";
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
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const notice = vi.hoisted(() => ({
  error: vi.fn<(title: string, options?: { description?: string; duration?: number }) => void>(),
}));
vi.mock("sonner", () => ({ toast: { error: notice.error } }));

interface Posted {
  input: unknown;
  /** `ok`, or `refused:<code>` — absent while the action has not answered. */
  result?: string;
}
const { posted } = vi.hoisted(() => ({ posted: [] as Posted[] }));

// Spied, NOT replaced.
vi.mock("@/app/[locale]/velo/[id]/actions", async (original) => {
  const real = await original<typeof import("@/app/[locale]/velo/[id]/actions")>();
  return {
    ...real,
    updateBikePartAction: async (input: unknown) => {
      const entry: Posted = { input: structuredClone(input) };
      posted.push(entry);
      const result = await real.updateBikePartAction(input);
      entry.result = result.ok ? "ok" : `refused:${result.code}`;
      return result;
    },
  };
});

const dom = await builtinEnvironments.jsdom.setup(globalThis, {
  jsdom: { url: "http://localhost:3100/" },
});
afterAll(async () => {
  await dom.teardown(globalThis);
});

await import("@/tests/setup.dom");
const { act, cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithIntl } = await import("@/tests/_helpers/intl");

const { default: BikePage } = await import("@/app/[locale]/velo/[id]/page");
const { createBikeAction } = await import("@/app/[locale]/(protected)/mes-velos/actions");
const { updateBikePartAction: realUpdateBikePart } = await vi.importActual<
  typeof import("@/app/[locale]/velo/[id]/actions")
>("@/app/[locale]/velo/[id]/actions");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");

async function signedInUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Camille", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

/** A bike of this user's, made by the real action. `rear` is an edit the owner made earlier. */
async function ownBike(preset: keyof typeof BIKE_PRESETS, rear?: number): Promise<string> {
  // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
  const created = await createBikeAction({ name: "Mon vélo", answers: BIKE_PRESETS[preset] });
  if (!created.ok) throw new Error("createBikeAction refused the setup");
  if (rear !== undefined) {
    const seeded = await realUpdateBikePart({
      bikeId: created.data.id,
      partId: "tire-rear",
      attributes: { "etrto-width": rear },
    });
    if (!seeded.ok) throw new Error("updateBikePartAction refused the setup");
  }
  return created.data.id;
}

/** What PostgreSQL holds for one attribute of one part of the bike. */
async function inDatabase(bikeId: string, partId: string, key: string): Promise<unknown> {
  const { parts } = await prisma.bike.findUniqueOrThrow({
    where: { id: bikeId },
    select: { parts: true },
  });
  const stored = parts as unknown as { partId: string; attributes: Record<string, unknown> }[];
  // eslint-disable-next-line security/detect-object-injection -- an attribute key written by this file
  return stored.find((part) => part.partId === partId)?.attributes[key];
}

/** The real page function, for the address bar as it is now. */
async function pageElement(bikeId: string): Promise<React.ReactElement> {
  const query = Object.fromEntries(new URLSearchParams(window.location.search));
  return BikePage({
    params: Promise.resolve({ locale: "fr", id: bikeId }),
    searchParams: Promise.resolve(query),
  });
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function open(bikeId: string) {
  window.history.replaceState(null, "", `/fr/velo/${bikeId}`);
  const view = await renderWithIntl(await pageElement(bikeId));
  await settle();
  expect(screen.getByTestId("bike-workspace")).toHaveAttribute("data-ref", "db");
  return {
    ...view,
    /** Wait until `count` writes have been answered by the real action. */
    answered: async (count: number): Promise<void> => {
      await waitFor(
        () => expect(posted.filter((entry) => entry.result !== undefined)).toHaveLength(count),
        { timeout: 8000, interval: 25 },
      );
      await settle();
    },
    /** What `revalidatePath` causes: the page runs again, the same tree gets new props. */
    refreshPage: async (): Promise<void> => {
      await settle(150); // the viewer writes `?part=` after a 100 ms debounce
      view.rerender(await pageElement(bikeId));
      await settle();
    },
  };
}

const row = (partId: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-part-row="${partId}"]`)!;
const field = (key: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-testid="part-edit-form"] [data-attr="${key}"]`)!;
const status = (key: string): string =>
  screen.queryByTestId(`attr-status-${key}`)?.textContent ?? "(no status line)";
const title = (): string => screen.queryByTestId("part-panel-title")?.textContent ?? "(no part)";
const drawn = (partId: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-testid="bike3d-svg"] [data-part-id="${partId}"]`)!;

beforeEach(() => {
  posted.length = 0;
  notice.error.mockClear();
  setRequestHeaders(sameOriginHeaders());
});

afterEach(() => {
  cleanup();
});

describe("the part form of a saved bike, through the real action, on PostgreSQL", () => {
  it("the rear tyre holds 38: 45 typed for the front, the rear pressed on the bike, its form tabbed through — the front is 45, the rear still 38", async () => {
    await signedInUser("part-form-1@velo-atelier.test");
    const bikeId = await ownBike("gravel-1x11", 38);
    const { user, answered, refreshPage } = await open(bikeId);

    await user.click(row("tire-front"));
    await user.clear(field("etrto-width"));
    await user.type(field("etrto-width"), "45");

    // ONE press on the rear tyre: it leaves the field (the front is saved), then selects.
    await user.click(drawn("tire-rear"));
    await answered(1);
    await refreshPage();
    expect(title()).toBe("Pneu arrière");
    expect(field("etrto-width").value).toBe("38");
    expect(status("etrto-width")).toBe("");

    // Keyboard only, nothing typed: every control of the rear tyre's form.
    const controls = [
      ...screen.getByTestId("part-edit-form").querySelectorAll<HTMLElement>("[data-attr]"),
    ];
    act(() => controls[0].focus());
    for (let index = 0; index < controls.length; index += 1) await user.tab();
    await settle(300);

    expect(posted).toEqual([
      {
        input: { bikeId, partId: "tire-front", attributes: { "etrto-width": 45 } },
        result: "ok",
      },
    ]);
    expect(await inDatabase(bikeId, "tire-front", "etrto-width")).toBe(45);
    expect(await inDatabase(bikeId, "tire-rear", "etrto-width")).toBe(38);
  }, 60_000);

  it("a stock bike, nothing typed: the fork from the list, the dropper post pressed on the bike, its travel field entered and left — no write at all", async () => {
    await signedInUser("part-form-2@velo-atelier.test");
    const bikeId = await ownBike("mtb-full-dropper-1x12");
    const { user } = await open(bikeId);

    await user.click(row("fork"));
    expect(field("travel-mm").value).toBe("140");
    await user.click(drawn("seatpost"));
    await settle();
    expect(title()).toBe("Tige de selle");
    expect(field("travel-mm").value).toBe("170");

    await user.click(field("travel-mm"));
    await user.click(screen.getByRole("heading", { level: 1 }));
    await settle(300);

    expect(posted).toEqual([]);
    expect(await inDatabase(bikeId, "fork", "travel-mm")).toBe(140);
    expect(await inDatabase(bikeId, "seatpost", "travel-mm")).toBe(170);
  }, 60_000);

  it.each([
    ["the next press is the 'Pièces' tab", "tab"],
    ["a history move changes ?part= under the focused field", "history"],
  ] as const)(
    "45 typed for the front tyre and not left, then %s: the front is 45, the rear still 38",
    async (_, exit) => {
      await signedInUser(`part-form-3-${exit}@velo-atelier.test`);
      const bikeId = await ownBike("gravel-1x11", 38);
      const { user, answered, refreshPage } = await open(bikeId);

      await user.click(row("tire-front"));
      await user.clear(field("etrto-width"));
      await user.type(field("etrto-width"), "45");
      expect(document.activeElement).toBe(field("etrto-width"));

      if (exit === "tab") {
        await user.click(screen.getByRole("tab", { name: "Pièces" }));
      } else {
        act(() => {
          window.history.pushState(null, "", `/fr/velo/${bikeId}?part=tire-rear`);
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
      }
      await answered(1);
      await refreshPage();

      expect(posted).toEqual([
        {
          input: { bikeId, partId: "tire-front", attributes: { "etrto-width": 45 } },
          result: "ok",
        },
      ]);
      expect(await inDatabase(bikeId, "tire-front", "etrto-width")).toBe(45);
      expect(await inDatabase(bikeId, "tire-rear", "etrto-width")).toBe(38);
      expect(notice.error).not.toHaveBeenCalled();
      if (exit === "history") {
        expect(title()).toBe("Pneu arrière");
        expect(field("etrto-width").value).toBe("38");
      }
    },
    60_000,
  );

  it("999 typed for the front tyre and not left: the real action refuses it, nothing is stored, and the visitor is told which tyre and which field", async () => {
    await signedInUser("part-form-4@velo-atelier.test");
    const bikeId = await ownBike("gravel-1x11");
    const { user, answered } = await open(bikeId);

    await user.click(row("tire-front"));
    await user.clear(field("etrto-width"));
    await user.type(field("etrto-width"), "999");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await answered(1);

    expect(posted).toEqual([
      {
        input: { bikeId, partId: "tire-front", attributes: { "etrto-width": 999 } },
        result: "refused:VALIDATION",
      },
    ]);
    expect(await inDatabase(bikeId, "tire-front", "etrto-width")).toBe(42);
    expect(notice.error).toHaveBeenCalledTimes(1);
    expect(notice.error.mock.calls[0][0]).toBe(
      "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.",
    );
    expect(notice.error.mock.calls[0][1]?.description).toBe(
      "Cette valeur n’est pas possible pour cette caractéristique.",
    );
  }, 60_000);
});
