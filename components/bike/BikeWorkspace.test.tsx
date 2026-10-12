import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readLocalBike, writeLocalBike, type LocalBike } from "@/lib/bike/local-bike";
import { forkDemoToLocal, resetLocalBikeSnapshotCache } from "@/lib/bike/repo";
import { buildOf, deriveBike } from "@/lib/bike/rules";
import { LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import type { PartId } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { setAttribute } from "@/lib/domain/engine/validate-build";
import type { AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import { MEDIA } from "@/lib/hooks/use-media";
import { renderWithIntl } from "@/tests/_helpers/intl";
import { attributeOf, presetBuild } from "@/tests/_helpers/part-attributes";
import { setMediaQuery } from "@/tests/setup.dom";

/**
 * The part edit form through the REAL `BikeWorkspace` (`.debug/017` §5.8) —
 * the component `/velo/local` and `/velo/<uuid>` both render, in its two
 * layouts: the panel docked beside the viewer, and inside the bottom sheet.
 *
 * `PartsPanel.test.tsx` holds the form's four properties on the panel, where a
 * selection made on the bike is a call on the viewer store. Here that call is
 * reached the way a visitor reaches it, and through everything the workspace
 * adds around the panel — the viewer and its URL sync, the sheet, the two
 * layouts, the live-build re-seed, the guest bike read out of `localStorage`:
 *
 *   - a pointer press on a part of the bike drawing (jsdom has no WebGL, so
 *     the viewer stays on the interactive silhouette — what the site serves
 *     before the 3D is ready, without WebGL and after a lost context; the
 *     click on a real canvas is `tests/e2e/part-panel.spec.ts`);
 *   - the same part with the keyboard, Enter and Space;
 *   - `?part=` on a history move — the one route that changes the selection
 *     WITHOUT taking the focus out of the field first.
 *
 * Replaced: `next/dynamic` (the lazy 3D scene and the guest resume banner,
 * neither of them the subject), and the two `"use server"` modules, which
 * cannot be evaluated in jsdom. `updateBikePartAction` is a recorder that
 * answers as the real one does; the real one, on PostgreSQL, is
 * `tests/integration/part-form.test.ts`.
 */

const server = vi.hoisted(() => ({
  payloads: [] as unknown[],
  build: null as unknown,
  latencyMs: 0,
  /** The action does not answer at all: the network went, the function crashed. */
  down: false,
  /**
   * Every call waits until the CASE lets it be answered (`answerHeld`): "a
   * write is in flight" as a state the case is in, never a timer against the
   * clicks that have to fit before it.
   */
  hold: false,
  held: [] as (() => void)[],
}));

const notice = vi.hoisted(() => ({
  error: vi.fn<(title: string, options?: { description?: string; duration?: number }) => void>(),
  /** The toast library cannot be had: its chunk was never fetched, and the network is gone. */
  unavailable: false,
}));
vi.mock("sonner", () => ({
  get toast() {
    if (notice.unavailable) throw new Error("Failed to load chunk /_next/static/chunks/sonner.js");
    return { error: notice.error };
  },
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));

vi.mock("@/app/[locale]/velo/[id]/actions", () => ({
  updateBikePartAction: async (input: {
    bikeId: string;
    partId: string;
    attributes: Record<string, AttributeValue | null>;
  }) => {
    server.payloads.push(structuredClone(input));
    if (server.hold) await new Promise<void>((resolve) => server.held.push(resolve));
    else await new Promise((resolve) => setTimeout(resolve, server.latencyMs));
    if (server.down) throw new TypeError("Failed to fetch");
    let build = server.build as BikeBuild;
    for (const [key, value] of Object.entries(input.attributes)) {
      const change = setAttribute(build, input.partId, key, value);
      if (!change.ok) {
        return {
          ok: false,
          code: "VALIDATION",
          fieldErrors: { [key]: `bike.errors.${change.code}` },
        };
      }
      build = change.build;
    }
    server.build = build;
    return { ok: true, data: build };
  },
}));

vi.mock("@/app/[locale]/velo/[id]/reglages/actions", () => ({
  updateBikeFitAction: async () => ({ ok: false, code: "NOT_FOUND" }),
}));

const { BikeWorkspace } = await import("./BikeWorkspace");
const { forgetWrites } = await import("@/lib/bike/own-writes");

const BIKE_ID = "3f0c1f0e-6f0a-4c56-9d3b-1c2d3e4f5a6b";

/** `preset`'s build with the rear tyre at 38 mm: a value of its own to keep. */
function withRear38(preset: PresetId): BikeBuild {
  const change = setAttribute(presetBuild(preset), "tire-rear", "etrto-width", 38);
  if (!change.ok) throw new Error("the domain refused the seed");
  return change.build;
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const row = (partId: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-part-row="${partId}"]`)!;
const field = (key: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-testid="part-edit-form"] [data-attr="${key}"]`)!;
const status = (key: string): string =>
  screen.queryByTestId(`attr-status-${key}`)?.textContent ?? "(no status line)";
const title = (): string => screen.queryByTestId("part-panel-title")?.textContent ?? "(no part)";
/** A part of the bike drawing: the silhouette's own button. */
const drawn = (partId: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-testid="bike3d-svg"] [data-part-id="${partId}"]`)!;
const local = (partId: string, key: string): AttributeValue | undefined => {
  const bike = readLocalBike();
  if (bike === null) throw new Error("no guest bike in storage");
  return attributeOf({ spec: bike.spec, parts: bike.parts }, partId, key);
};
const saved = (partId: string, key: string): AttributeValue | undefined =>
  attributeOf(server.build as BikeBuild, partId, key);

/** Let the oldest held write be answered (`server.hold`). */
async function answerHeld(): Promise<void> {
  const next = server.held.shift();
  if (next === undefined) throw new Error("no write is in flight to be answered");
  next();
  await settle();
}

/** `?part=` as a history move delivers it: no press, no focus change. */
function historyMoveTo(partId: PartId): void {
  act(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("part", partId);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

async function openGuest(preset: PresetId, desktop: boolean, build = presetBuild(preset)) {
  // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
  writeLocalBike({ answers: BIKE_PRESETS[preset], parts: build.parts });
  return mountGuest(desktop);
}

/** `/velo/local` over whatever guest bike the browser's storage holds. */
async function mountGuest(desktop: boolean) {
  setMediaQuery(MEDIA.desktop, desktop);
  resetLocalBikeSnapshotCache();
  window.history.replaceState(null, "", "/fr/velo/local");
  const view = await renderWithIntl(
    <BikeWorkspace
      locale="fr"
      refKind="local"
      bikeParam="local"
      bikeId={null}
      name={null}
      build={null}
      answers={null}
      guides={[]}
      resume={null}
      description={null}
    />,
  );
  await settle();
  expect(screen.getByTestId("bike-workspace")).toHaveAttribute("data-docked", String(desktop));
  return view;
}

function savedProps(preset: PresetId, initialPartId: PartId | null = null) {
  return {
    locale: "fr" as const,
    refKind: "db" as const,
    bikeParam: BIKE_ID,
    bikeId: BIKE_ID,
    name: "Mon vélo",
    // A new object every time, as a page that runs again hands one down.
    build: structuredClone(server.build) as BikeBuild,
    // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
    answers: BIKE_PRESETS[preset],
    guides: [],
    resume: null,
    description: "un vélo",
    initialPartId,
  };
}

async function openSaved(preset: PresetId, build = presetBuild(preset)) {
  server.build = build;
  return mountSaved(preset, build);
}

/**
 * The saved bike's workspace over a page that says `shown` — whatever the
 * server holds. A page the router KEPT across a route change is one that says
 * what the bike held when it was rendered; `refreshPage()` is Next fetching it
 * again.
 */
async function mountSaved(preset: PresetId, shown: BikeBuild) {
  setMediaQuery(MEDIA.desktop, true);
  window.history.replaceState(null, "", `/fr/velo/${BIKE_ID}`);
  const view = await renderWithIntl(
    <BikeWorkspace {...savedProps(preset)} build={structuredClone(shown)} />,
  );
  await settle();
  /**
   * What `revalidatePath` makes Next do after a write: the page runs again.
   * Given `rendered`, it is a page that ran EARLIER which is delivered now —
   * a fetch that left before a write and comes back after it.
   */
  const refreshPage = async (rendered?: BikeBuild): Promise<void> => {
    const selected = new URL(window.location.href).searchParams.get("part") as PartId | null;
    const props = savedProps(preset, selected);
    view.rerender(
      <BikeWorkspace {...props} build={rendered ? structuredClone(rendered) : props.build} />,
    );
    await settle();
  };
  return { ...view, refreshPage };
}

type User = Awaited<ReturnType<typeof openGuest>>["user"];

/** Replace what a field holds, and STAY in it. */
async function typeInto(user: User, key: string, text: string): Promise<void> {
  await user.clear(field(key));
  await user.type(field(key), text);
  expect(document.activeElement).toBe(field(key));
}

/** Text a number input cannot read, as Chromium reports it: an empty value and `badInput`. */
function typeUnreadableInto(key: string): void {
  const node = field(key);
  act(() => node.focus());
  Object.defineProperty(node, "validity", { configurable: true, value: { badInput: true } });
  fireEvent.change(node, { target: { value: "" } });
  expect(document.activeElement).toBe(node);
}

const UNSAVED_WIDTH = "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.";
const NOT_POSSIBLE = "Cette valeur n’est pas possible pour cette caractéristique.";

beforeEach(() => {
  // Each case is a document of its own: see `lib/bike/own-writes.ts`.
  forgetWrites();
  notice.error.mockClear();
  notice.unavailable = false;
  server.payloads.length = 0;
  server.latencyMs = 0;
  server.down = false;
  server.hold = false;
  server.build = null;
  window.localStorage.clear();
  resetLocalBikeSnapshotCache();
  setMediaQuery(MEDIA.shortViewport, false);
});

// A case that failed half-way leaves its held writes unanswered, and React
// entangles async transitions: the cases after it would wait on theirs for ever.
afterEach(async () => {
  for (const release of server.held.splice(0)) release();
  await settle();
});

const LAYOUTS = [
  { layout: "docked beside the viewer", desktop: true },
  { layout: "in the bottom sheet", desktop: false },
] as const;

describe.each(LAYOUTS)("the guest bike, panel $layout", ({ desktop }) => {
  it("a part pressed on the bike drawing gets its own form: nothing of the front tyre is shown, flagged or written for the rear", async () => {
    const { user } = await openGuest("gravel-1x11", desktop, withRear38("gravel-1x11"));
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    // ONE press on the rear tyre: it leaves the field, then selects.
    await user.click(drawn("tire-rear"));
    await settle();

    expect(screen.getByTestId("bike3d-viewer")).toHaveAttribute("data-selected", "tire-rear");
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Infos");
    expect(title()).toBe("Pneu arrière");
    expect(field("etrto-width").value).toBe("38");
    expect(status("etrto-width")).toBe("");
    expect(local("tire-front", "etrto-width")).toBe(45);

    await user.click(field("etrto-width"));
    await user.click(screen.getByRole("heading", { level: 1 }));
    await settle();
    expect(local("tire-rear", "etrto-width")).toBe(38);
    expect(local("tire-front", "etrto-width")).toBe(45);
  });

  it.each([
    ["Enter", "fork", "seatpost", 140, 170],
    [" ", "seatpost", "fork", 170, 140],
  ] as const)(
    "a part chosen on the drawing with the keyboard (%j) gets its own form: %s's travel is not %s's",
    async (key, first, second, theirs, own) => {
      const { user } = await openGuest("mtb-full-dropper-1x12", desktop);
      await user.click(row(first));
      expect(field("travel-mm").value).toBe(String(theirs));

      act(() => drawn(second).focus());
      await user.keyboard(key === " " ? " " : "{Enter}");
      await settle();

      expect(screen.getByTestId("bike3d-viewer")).toHaveAttribute("data-selected", second);
      expect(field("travel-mm").value).toBe(String(own));
      const before = window.localStorage.getItem(LOCAL_BIKE_KEY);

      // Tab through the form, changing nothing.
      const controls = [
        ...screen.getByTestId("part-edit-form").querySelectorAll<HTMLElement>("[data-attr]"),
      ];
      act(() => controls[0].focus());
      for (let index = 0; index < controls.length; index += 1) await user.tab();
      await settle();

      // Not one byte of the stored bike moved — `updatedAt` included.
      expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(before);
      expect(local(second, "travel-mm")).toBe(own);
      expect(local(first, "travel-mm")).toBe(theirs);
    },
  );

  it("a history move to ?part= while the field still has focus: what was typed goes to the tyre it was typed for", async () => {
    const { user } = await openGuest("gravel-1x11", desktop, withRear38("gravel-1x11"));
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    const typedIn = field("etrto-width");

    historyMoveTo("tire-rear");
    await settle();

    expect(title()).toBe("Pneu arrière");
    expect(typedIn.isConnected).toBe(false);
    expect(field("etrto-width").value).toBe("38");
    expect(status("etrto-width")).toBe("");
    expect(local("tire-front", "etrto-width")).toBe(45);
    expect(local("tire-rear", "etrto-width")).toBe(38);
    expect(notice.error).not.toHaveBeenCalled();
  });

  it.each(["Pièces", "Actions"] as const)(
    "a width typed and not left is saved for its own tyre when the next press is the '%s' tab",
    async (tab) => {
      const { user } = await openGuest("gravel-1x11", desktop);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");

      await user.click(screen.getByRole("tab", { name: tab }));
      await settle();

      expect(screen.queryByTestId("part-edit-form")).toBeNull();
      expect(local("tire-front", "etrto-width")).toBe(45);
      expect(local("tire-rear", "etrto-width")).toBe(42);

      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await user.click(row("tire-front"));
      expect(field("etrto-width").value).toBe("45");
    },
  );

  it("a form that is only visited leaves the stored bike exactly as it was", async () => {
    const { user } = await openGuest("gravel-1x11", desktop);
    await user.click(row("tire-front"));
    const before = window.localStorage.getItem(LOCAL_BIKE_KEY);

    await user.click(field("etrto-width"));
    await user.click(screen.getByRole("heading", { level: 1 }));
    await settle();

    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(before);
    expect(status("etrto-width")).toBe("");
  });

  it("the workspace torn down by a route change: the typed width is in storage before the teardown returns", async () => {
    const { user, unmount } = await openGuest("gravel-1x11", desktop);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    unmount();

    expect(local("tire-front", "etrto-width")).toBe(45);
  });
});

describe("the guest bike, when the panel itself goes away or moves", () => {
  it("pressing the sheet's handle leaves the field: the width is saved, and the form is still there", async () => {
    const { user } = await openGuest("gravel-1x11", false);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    const typedIn = field("etrto-width");
    const sheet = screen.getByTestId("parts-sheet");
    const snap = sheet.getAttribute("data-snap");

    await user.click(sheet.querySelector<HTMLElement>("[data-slot=mobile-sheet-handle]")!);
    await settle();

    // The sheet moved; it never unmounts what it holds.
    expect(sheet.getAttribute("data-snap")).not.toBe(snap);
    expect(typedIn.isConnected).toBe(true);
    expect(status("etrto-width")).toBe("Enregistré");
    expect(local("tire-front", "etrto-width")).toBe(45);
  });

  it.each([
    ["the window grows past 1024 px: the sheet becomes the docked panel", false, true],
    ["the window shrinks below 1024 px: the docked panel becomes the sheet", true, false],
  ] as const)("%s — the width typed and not left is saved", async (_, from, to) => {
    const { user } = await openGuest("gravel-1x11", from);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    const typedIn = field("etrto-width");

    act(() => setMediaQuery(MEDIA.desktop, to));
    await settle();

    expect(screen.getByTestId("bike-workspace")).toHaveAttribute("data-docked", String(to));
    // The panel was rebuilt in its new place: the field the visitor typed in is gone…
    expect(typedIn.isConnected).toBe(false);
    // …what they typed is not, and the tab they were on is still showing it.
    expect(local("tire-front", "etrto-width")).toBe(45);
    expect(title()).toBe("Pneu avant");
    expect(field("etrto-width").value).toBe("45");
  });
});

describe("a saved bike — what the client sends to updateBikePartAction", () => {
  it("one write, for the tyre it was typed for: the rear tyre pressed on the drawing, the page run again, the form tabbed through", async () => {
    server.latencyMs = 40;
    const { user, refreshPage } = await openSaved("gravel-1x11", withRear38("gravel-1x11"));
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    await user.click(drawn("tire-rear"));
    // The front tyre's write is still in flight, and the page runs again around it.
    await refreshPage();
    await settle(120);
    await refreshPage();

    expect(title()).toBe("Pneu arrière");
    expect(field("etrto-width").value).toBe("38");
    expect(status("etrto-width")).toBe("");

    const controls = [
      ...screen.getByTestId("part-edit-form").querySelectorAll<HTMLElement>("[data-attr]"),
    ];
    act(() => controls[0].focus());
    for (let index = 0; index < controls.length; index += 1) await user.tab();
    await settle(120);

    expect(server.payloads).toEqual([
      { bikeId: BIKE_ID, partId: "tire-front", attributes: { "etrto-width": 45 } },
    ]);
    expect(saved("tire-front", "etrto-width")).toBe(45);
    expect(saved("tire-rear", "etrto-width")).toBe(38);
    expect(notice.error).not.toHaveBeenCalled();
  });

  it("nothing at all on a stock bike: the fork from the list, the dropper post on the drawing, the travel field entered and left", async () => {
    const { user } = await openSaved("mtb-full-dropper-1x12");
    await user.click(row("fork"));
    await user.click(drawn("seatpost"));
    await settle();
    expect(field("travel-mm").value).toBe("170");

    await user.click(field("travel-mm"));
    await user.click(screen.getByRole("heading", { level: 1 }));
    await settle();

    expect(server.payloads).toEqual([]);
    expect(saved("seatpost", "travel-mm")).toBe(170);
    expect(saved("fork", "travel-mm")).toBe(140);
  });

  it.each([
    ["the next press is the 'Pièces' tab", "tab"],
    ["a history move changes ?part= under the focused field", "history"],
  ] as const)(
    "a width typed and not left, then %s: one write, for the front tyre",
    async (_, exit) => {
      server.latencyMs = 40;
      const { user, refreshPage } = await openSaved("gravel-1x11", withRear38("gravel-1x11"));
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");

      if (exit === "tab") await user.click(screen.getByRole("tab", { name: "Pièces" }));
      else historyMoveTo("tire-rear");
      await settle(120);
      await refreshPage();

      expect(server.payloads).toEqual([
        { bikeId: BIKE_ID, partId: "tire-front", attributes: { "etrto-width": 45 } },
      ]);
      expect(saved("tire-front", "etrto-width")).toBe(45);
      expect(saved("tire-rear", "etrto-width")).toBe(38);
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  it("a page that runs again while the visitor is typing — with another value for that very field — replaces nothing of what is typed", async () => {
    const { user, refreshPage } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    const typedIn = field("etrto-width");

    // The same bike, edited from another device meanwhile: the page that runs
    // again hands down 40 for the field the visitor is in the middle of.
    const elsewhere = setAttribute(server.build as BikeBuild, "tire-front", "etrto-width", 40);
    if (!elsewhere.ok) throw new Error("the domain refused the seed");
    server.build = elsewhere.build;
    await refreshPage();

    expect(field("etrto-width")).toBe(typedIn);
    expect(typedIn.value).toBe("45");
    expect(document.querySelector('[data-attr-row="etrto-width"] dd')).toHaveTextContent("40 mm");
    await user.tab();
    await settle();
    expect(saved("tire-front", "etrto-width")).toBe(45);
  });

  it("an untouched field follows the page that runs again with another value for it", async () => {
    const { user, refreshPage } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");

    const elsewhere = setAttribute(server.build as BikeBuild, "tire-front", "etrto-width", 40);
    if (!elsewhere.ok) throw new Error("the domain refused the seed");
    server.build = elsewhere.build;
    await refreshPage();

    expect(field("etrto-width").value).toBe("40");
    await user.click(field("etrto-width"));
    await user.tab();
    await settle();
    expect(server.payloads).toEqual([]);
  });

  it("a width the server refuses, typed and not left: the visitor is told which tyre and which field", async () => {
    const { user } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "999");

    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(server.payloads).toEqual([
      { bikeId: BIKE_ID, partId: "tire-front", attributes: { "etrto-width": 999 } },
    ]);
    expect(saved("tire-front", "etrto-width")).toBe(42);
    expect(notice.error).toHaveBeenCalledTimes(1);
    expect(notice.error.mock.calls[0][0]).toBe(
      "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.",
    );
    expect(notice.error.mock.calls[0][1]?.description).toBe(
      "Cette valeur n’est pas possible pour cette caractéristique.",
    );
  });
});

describe.each(LAYOUTS)("what the review found, panel $layout", ({ desktop }) => {
  it.each([
    ["the 'Pièces' tab is pressed", "tab"],
    ["a history move changes ?part= under the focused field", "history"],
    ["the panel is rebuilt in its other layout", "layout"],
  ] as const)(
    "text a number field cannot read, typed and not left, then %s: the stored width is not deleted, and the visitor is told",
    async (_, exit) => {
      const { user } = await openGuest("gravel-1x11", desktop, withRear38("gravel-1x11"));
      await user.click(row("tire-rear"));
      expect(field("etrto-width").value).toBe("38");
      const before = window.localStorage.getItem(LOCAL_BIKE_KEY);
      typeUnreadableInto("etrto-width");

      if (exit === "tab") await user.click(screen.getByRole("tab", { name: "Pièces" }));
      else if (exit === "history") historyMoveTo("tire-front");
      else act(() => setMediaQuery(MEDIA.desktop, !desktop));
      await settle();

      // Not one byte of the stored bike moved: a clear would have given 42 back.
      expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(before);
      expect(local("tire-rear", "etrto-width")).toBe(38);
      expect(notice.error).toHaveBeenCalledTimes(1);
      expect(notice.error.mock.calls[0][0]).toBe(
        "Pneu arrière · Largeur du pneu : votre saisie n’a pas été enregistrée.",
      );
      expect(notice.error.mock.calls[0][1]?.description).toBe(NOT_POSSIBLE);
    },
  );

  /**
   * The notice is a toast, and a toast is a library to download. When it
   * cannot be had the sentence is said by the workspace itself — it used to be
   * lost with the import's rejection, which nothing handled.
   */
  it("the toast cannot be had: a refused width, typed and not left, is said on the page itself", async () => {
    const { user } = await openGuest("gravel-1x11", desktop);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "999");
    notice.unavailable = true;

    await user.click(screen.getByRole("tab", { name: "Pièces" }));

    const said = await screen.findByTestId("unsaved-notices");
    expect(notice.error).not.toHaveBeenCalled();
    expect(said).toHaveAttribute("role", "alert");
    expect(said).toHaveTextContent(`${UNSAVED_WIDTH} ${NOT_POSSIBLE}`);
    // Outside the panel: it is still there when the panel is rebuilt in its other layout.
    expect(said.closest("[data-testid=parts-panel]")).toBeNull();
    act(() => setMediaQuery(MEDIA.desktop, !desktop));
    await settle();
    expect(screen.getByTestId("unsaved-notices")).toHaveTextContent(UNSAVED_WIDTH);
    expect(local("tire-front", "etrto-width")).toBe(42);
  });
});

describe("what the review found — a saved bike whose write does not answer", () => {
  it("offline, the toast in memory: the visitor is told, with no reason invented", async () => {
    server.down = true;
    const { user } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    await user.click(screen.getByRole("tab", { name: "Pièces" }));

    await waitFor(() => expect(notice.error).toHaveBeenCalledTimes(1));
    expect(notice.error.mock.calls[0][0]).toBe(UNSAVED_WIDTH);
    expect(notice.error.mock.calls[0][1]?.description).toBeUndefined();
    expect(screen.queryByTestId("unsaved-notices")).toBeNull();
  });

  it("offline, and the toast cannot be had either: the workspace says it, and nothing is left unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    server.down = true;
    notice.unavailable = true;
    const { user } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    historyMoveTo("tire-rear");

    expect(await screen.findByTestId("unsaved-notices")).toHaveTextContent(UNSAVED_WIDTH);
    expect(title()).toBe("Pneu arrière");
    expect(screen.getByTestId("unsaved-notices")).not.toHaveTextContent(NOT_POSSIBLE);
    expect(notice.error).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("the workspace itself gone (a route change) and no toast: nothing to say it in, nothing thrown, and nothing left for the next bike's page", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    server.down = true;
    notice.unavailable = true;
    const { user, unmount } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    unmount();
    await settle(20);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();

    server.down = false;
    await openSaved("gravel-1x11");
    expect(screen.queryByTestId("unsaved-notices")).toBeNull();
  });
});

describe("what the second review found — the workspace mounted again before it could be told of its own write", () => {
  const STOCK = presetBuild("gravel-1x11");
  const SENT_45 = { bikeId: BIKE_ID, partId: "tire-front", attributes: { "etrto-width": 45 } };
  const SENT_42 = { bikeId: BIKE_ID, partId: "tire-front", attributes: { "etrto-width": 42 } };

  /**
   * A route change and straight back, as the real workspace lives it: it is
   * unmounted with 45 typed and not left (the removal sends it), and mounted
   * again — which builds its repo again (`useMemo`) — over the page the router
   * kept, which still says 42. The form's record of writes in flight was kept
   * per repo OBJECT: 42 typed and left compared as "unchanged", nothing was
   * sent, and the bike ended at 45 (`.debug/017` §5.8, "Second review").
   * The two writes are answered here in the order they were sent.
   */
  it("45 typed and not left, the route left and come back to at once, 42 typed and the field left: the 42 is sent too, and the bike ends at 42", async () => {
    server.hold = true;
    const before = await openSaved("gravel-1x11");
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    expect(server.payloads).toEqual([SENT_45]);
    expect(saved("tire-front", "etrto-width")).toBe(42);

    const { user } = await mountSaved("gravel-1x11", STOCK);
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    expect(status("etrto-width")).toBe("Enregistrement…");

    await answerHeld();
    expect(saved("tire-front", "etrto-width")).toBe(45);
    await answerHeld();

    expect(server.payloads).toEqual([SENT_45, SENT_42]);
    expect(saved("tire-front", "etrto-width"), "the last value typed and left").toBe(42);
    expect(field("etrto-width").value).toBe("42");
    expect(status("etrto-width")).toBe("Enregistré");
    expect(notice.error).not.toHaveBeenCalled();
  });

  /**
   * The same absence once the 45 has ANSWERED. Its build is handed to the
   * workspace that sent it, which is gone; the one mounted again goes on
   * saying 42 until the page has been fetched again, and with nothing in
   * flight any more the 42 typed there was "unchanged" too — for a whole
   * request, on the connection that made the first write slow.
   */
  it("the 45 ANSWERED to a workspace that is gone, the page mounted again still says 42, 42 typed and the field left: the 42 is sent, and the bike ends at 42", async () => {
    server.hold = true;
    const before = await openSaved("gravel-1x11");
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    await answerHeld();
    expect(saved("tire-front", "etrto-width")).toBe(45);

    const { user, refreshPage } = await mountSaved("gravel-1x11", STOCK);
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    expect(status("etrto-width")).toBe("Enregistrement…");
    await answerHeld();

    expect(server.payloads).toEqual([SENT_45, SENT_42]);
    expect(saved("tire-front", "etrto-width"), "the last value typed and left").toBe(42);
    expect(field("etrto-width").value).toBe("42");
    expect(status("etrto-width")).toBe("Enregistré");

    // The page runs again and says 42, as the form does: from here a value
    // typed back to what is stored is not a write any more.
    server.hold = false;
    await refreshPage();
    await typeInto(user, "etrto-width", "43");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();
    expect(server.payloads).toEqual([SENT_45, SENT_42]);
    expect(notice.error).not.toHaveBeenCalled();
  });

  it("…and when nothing is typed there, the page fetched again says 45: the untouched field follows it, and 45 typed back is not a write", async () => {
    server.hold = true;
    const before = await openSaved("gravel-1x11");
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    await answerHeld();

    const { user, refreshPage } = await mountSaved("gravel-1x11", STOCK);
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");

    await refreshPage(); // Next has fetched the page again
    expect(field("etrto-width").value).toBe("45");
    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    expect(server.payloads).toEqual([SENT_45]);
    expect(status("etrto-width")).toBe("");
  });

  /**
   * Why the record is KEPT once the page has said what a write left, and not
   * dropped there: a page rendered before the write can be delivered after
   * the one rendered after it. The field then says 42 again over a bike that
   * holds 45 — and 42 typed there is the same "unchanged" a third time.
   */
  it("a page rendered BEFORE the write, delivered after the form was told of it: the field follows it, and what is typed back to it is sent", async () => {
    const { user, refreshPage } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();
    expect(status("etrto-width")).toBe("Enregistré");
    expect(saved("tire-front", "etrto-width")).toBe(45);
    await refreshPage(); // the page run after the write: 45, as the form says
    // A value typed back to that is not a write — and having agreed once
    // takes nothing off the record.
    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();
    expect(server.payloads).toEqual([SENT_45]);

    await refreshPage(STOCK); // …and then the page that ran before the write
    expect(field("etrto-width").value).toBe("42");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();

    expect(server.payloads).toEqual([SENT_45, SENT_42]);
    expect(saved("tire-front", "etrto-width"), "the last value typed and left").toBe(42);
    expect(status("etrto-width")).toBe("Enregistré");
  });

  /**
   * What the record costs, pinned so that it stays a decision: when the page
   * does not say what this document's last write of a field left — the field
   * was changed by something else since — the first value typed back to what
   * the page shows is SENT, although it changes nothing. Sending is the safe
   * side. Its own answer is what the page says, and the doubt ends there.
   */
  it("the field changed by another device since this document wrote it: a value typed back to what the page says is sent once, and not twice", async () => {
    const { user, refreshPage } = await openSaved("gravel-1x11");
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" })); // the removal writes 45
    await settle();
    expect(saved("tire-front", "etrto-width")).toBe(45);

    const elsewhere = setAttribute(server.build as BikeBuild, "tire-front", "etrto-width", 50);
    if (!elsewhere.ok) throw new Error("the domain refused the seed");
    server.build = elsewhere.build;
    await refreshPage();
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("50");

    const SENT_50 = { ...SENT_45, attributes: { "etrto-width": 50 } };
    await typeInto(user, "etrto-width", "51");
    await typeInto(user, "etrto-width", "50");
    await user.tab();
    await settle();
    expect(server.payloads).toEqual([SENT_45, SENT_50]);
    expect(status("etrto-width")).toBe("Enregistré");

    await typeInto(user, "etrto-width", "51");
    await typeInto(user, "etrto-width", "50");
    await user.tab();
    await settle();
    expect(server.payloads).toEqual([SENT_45, SENT_50]);
    expect(saved("tire-front", "etrto-width")).toBe(50);
  });

  /**
   * A CLEAR leaves nothing in the field, and pages say that in two ways: the
   * build the write answers with has no such attribute; a page rendered later
   * shows the catalogue's default, the bike being derived again from its
   * answers. Either says what the clear left (the real page is
   * `tests/integration/part-form.test.ts`).
   */
  it("the owner's 45 emptied and not left, the tab pressed: cleared. The page run again shows the default there — and the default typed back is not a write", async () => {
    const own = setAttribute(STOCK, "tire-front", "etrto-width", 45);
    if (!own.ok) throw new Error("the domain refused the seed");
    const { user, refreshPage } = await openSaved("gravel-1x11", own.build);
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("45");
    await user.clear(field("etrto-width"));
    expect(document.activeElement).toBe(field("etrto-width"));
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();
    const CLEARED = { ...SENT_45, attributes: { "etrto-width": null } };
    expect(server.payloads).toEqual([CLEARED]);
    expect(saved("tire-front", "etrto-width")).toBeUndefined();

    // The build the clear answered with: no width at all. Text typed there and
    // deleted again leaves the field as the clear left it — not a write.
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("");
    await typeInto(user, "etrto-width", "43");
    await user.clear(field("etrto-width"));
    await user.tab();
    await settle();
    expect(server.payloads).toEqual([CLEARED]);
    await user.click(screen.getByRole("tab", { name: "Pièces" }));

    // As the real page hands it down: the bike derived again, the default back.
    server.build = buildOf(
      deriveBike(BIKE_PRESETS["gravel-1x11"], (server.build as BikeBuild).parts),
    );
    await refreshPage();
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");
    await typeInto(user, "etrto-width", "43");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();

    expect(server.payloads).toEqual([CLEARED]);
    expect(status("etrto-width")).toBe("");
  });

  it("the guest bike after a route change and back: the field says what the removal wrote, and typing it back writes nothing", async () => {
    // Its write is in storage before the teardown returns, and the workspace
    // mounted again reads storage: it is told at once, whatever is on record.
    const before = await openGuest("gravel-1x11", true);
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();

    const { user } = await mountGuest(true);
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("45");
    const stored = window.localStorage.getItem(LOCAL_BIKE_KEY);
    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    // Not one byte of the stored bike moved — `updatedAt` included.
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(stored);
    expect(status("etrto-width")).toBe("");
  });
});

describe("what the third review found — the guest bike under `/velo/local` replaced by another, in one document", () => {
  /**
   * `/velo/local` names a slot. The bike in it has an id of its own, and is
   * replaced by a NEW one — `writeLocalBike` with no id — when the visitor
   * takes the demo's local copy or generates a bike again from the tree;
   * neither loads the document again, and the workspace itself is keyed on
   * that id. The form's record of its own writes was keyed by the word
   * `local`: bike B inherited what this document had written to bike A, its
   * 42 was "in doubt" against A's 45, and 42 typed back into B was SENT —
   * "Enregistré", `updatedAt` moved, on a bike this document had never
   * written (`.debug/017` §5.8, "Third review"; in jsdom here, and in
   * Chromium). The record is the bike's: `repo.bikeKey()`.
   *
   * No `forgetWrites()` between the two bikes — that is the whole case.
   */

  /** Guest bike A: its front width set to 45, the field left, then the route. */
  async function setTo45AndLeaveTheRoute(): Promise<string> {
    const first = await openGuest("gravel-1x11", true);
    await first.user.click(row("tire-front"));
    await typeInto(first.user, "etrto-width", "45");
    await first.user.tab();
    await settle();
    expect(status("etrto-width")).toBe("Enregistré");
    expect(local("tire-front", "etrto-width")).toBe(45);
    const id = readLocalBike()!.id;
    first.unmount();
    return id;
  }

  /** "Modifier ce vélo", by the demo bike's own button: `forkDemoToLocal`, then `router.push`. */
  async function takeTheDemosLocalCopy(): Promise<void> {
    setMediaQuery(MEDIA.desktop, true);
    window.history.replaceState(null, "", "/fr/velo/demo");
    const demo = await renderWithIntl(
      <BikeWorkspace
        locale="fr"
        refKind="demo"
        bikeParam="demo"
        bikeId={null}
        name={null}
        build={presetBuild("gravel-1x11")}
        answers={BIKE_PRESETS["gravel-1x11"]}
        guides={[]}
        resume={null}
        description="un vélo"
      />,
    );
    await settle();
    await demo.user.click(row("tire-front"));
    await demo.user.click(
      screen.getByTestId("part-panel-fork").querySelector<HTMLButtonElement>("button")!,
    );
    await settle();
    demo.unmount();
  }

  /** What the tree's summary stores once the visitor has confirmed: answers, and no id. */
  async function generateAgainFromTheTree(): Promise<void> {
    expect(writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] })).not.toBeNull();
  }

  /** Every write of the guest bike from here on: each is exactly one `setItem`. */
  function guestWrites(): () => number {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    restore.push(() => spy.mockRestore());
    return () => spy.mock.calls.filter(([key]) => key === LOCAL_BIKE_KEY).length;
  }
  const restore: (() => void)[] = [];
  afterEach(() => {
    for (const undo of restore.splice(0)) undo();
  });

  const REPLACED = [
    { how: 'the demo\'s local copy is taken ("Modifier ce vélo")', replace: takeTheDemosLocalCopy },
    { how: "a bike is generated again from the tree", replace: generateAgainFromTheTree },
  ] as const;
  const EXITS = ["the field is left", "the 'Pièces' tab is pressed"] as const;

  it.each(REPLACED.flatMap((replaced) => EXITS.map((exit) => ({ ...replaced, exit }))))(
    "guest bike A's width set to 45; $how — guest bike B, a fresh id, stock 42; on B, 43 and then 42 typed and $exit: not one write",
    async ({ replace, exit }) => {
      const idOfA = await setTo45AndLeaveTheRoute();
      await replace();
      const b = readLocalBike()!;
      expect(b.id, "a NEW guest bike").not.toBe(idOfA);
      expect(local("tire-front", "etrto-width"), "B is the stock bike").toBe(42);

      const { user } = await mountGuest(true);
      await user.click(row("tire-front"));
      expect(field("etrto-width").value).toBe("42");
      const writes = guestWrites();

      // Entered and left: never a write, whatever is on record.
      await user.click(field("etrto-width"));
      await user.tab();
      await settle();
      expect(writes(), "entered and left").toBe(0);

      // Typed away, and back to what B holds. This document never wrote B.
      await typeInto(user, "etrto-width", "43");
      await typeInto(user, "etrto-width", "42");
      if (exit === "the field is left") {
        await user.tab();
        await settle();
        expect(status("etrto-width"), "42 typed back into a bike that holds 42").toBe("");
      } else {
        await user.click(screen.getByRole("tab", { name: "Pièces" }));
        await settle();
      }

      expect(writes()).toBe(0);
      // Not one byte of B moved — `updatedAt` included.
      expect(readLocalBike()).toEqual(b);
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  /**
   * The other side of the same key: a guest bike IS on its own record, by its
   * id, for as long as it is that bike — and so pays what a saved bike pays
   * (the case two blocks up), pinned here so that it stays a decision: its
   * field changed by ANOTHER TAB since this document wrote it, the first
   * value typed back to what the page shows is sent, although it changes
   * nothing. With guest bikes on no record at all, this case fails.
   */
  it("the SAME guest bike stays on its own record: its width changed in another tab since this document wrote it, a value typed back to what the page says is sent once, and not twice", async () => {
    const { user } = await openGuest("gravel-1x11", true);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();
    expect(local("tire-front", "etrto-width")).toBe(45);

    // Another tab: the same bike — its id kept — and the width at 50.
    const bike = readLocalBike()!;
    const elsewhere = setAttribute(
      { spec: bike.spec, parts: bike.parts },
      "tire-front",
      "etrto-width",
      50,
    );
    if (!elsewhere.ok) throw new Error("the domain refused the seed");
    writeLocalBike({
      id: bike.id,
      answers: bike.answers,
      parts: elsewhere.build.parts,
      fit: bike.fit,
    });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_BIKE_KEY }));
    });
    await settle();
    expect(readLocalBike()!.id).toBe(bike.id);
    expect(field("etrto-width").value, "the untouched field follows the other tab").toBe("50");

    const writes = guestWrites();
    await typeInto(user, "etrto-width", "51");
    await typeInto(user, "etrto-width", "50");
    await user.tab();
    await settle();
    expect(writes()).toBe(1);
    expect(status("etrto-width")).toBe("Enregistré");
    expect(local("tire-front", "etrto-width")).toBe(50);

    await typeInto(user, "etrto-width", "51");
    await typeInto(user, "etrto-width", "50");
    await user.tab();
    await settle();
    expect(writes()).toBe(1);
    expect(notice.error).not.toHaveBeenCalled();
  });
});

describe("what the review of the third repair found — the guest bike replaced UNDER a form that is on screen", () => {
  /**
   * The third review's cases replace the guest bike once the first one's
   * workspace is gone: one document, one page after the other. Here the bike
   * is replaced while its form is ON SCREEN — by another page of the same
   * browser, which is the only thing that can do it: the two controls that
   * store a new guest bike (the demo's "Modifier ce vélo", the tree's
   * "Générer mon vélo") are on other routes.
   *
   * This page is told by the `storage` event. Its workspace is keyed on the
   * guest bike's id, so it is mounted again for bike B, and the field that
   * held text typed for bike A is removed — which commits that text (rule 3
   * of `PartEditForm`). The guest repo read the slot before every write and
   * wrote back under whatever id it found there: A's 45 went to B's front
   * tyre, B's own 42 was gone, and nothing was said (`.debug/017` §5.8,
   * "Fourth review"; here, and in Chromium with two pages of one context).
   * On `main` that text was dropped: rule 3 is what made it a write.
   *
   * A guest repo is now built for ONE bike (`localBikeRepo(bikeId)`), and a
   * write through it answers `NOT_FOUND` once the slot holds another: nothing
   * is written, and the removal's write ends where every refused late write
   * ends — the notice naming the part and the field.
   */

  /** What another page of this browser does: it stores a guest bike, and THIS page is sent the event. */
  function storedByAnotherPage(store: () => LocalBike | null): { bike: LocalBike; bytes: string } {
    const bike = store();
    if (bike === null) throw new Error("storage refused the new guest bike");
    const bytes = window.localStorage.getItem(LOCAL_BIKE_KEY)!;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_BIKE_KEY }));
    });
    return { bike, bytes };
  }

  /** The two calls that put a NEW guest bike in the slot — answers, and no id. */
  const STORES = [
    {
      how: 'takes the demo\'s local copy ("Modifier ce vélo")',
      store: () => forkDemoToLocal({ answers: BIKE_PRESETS["gravel-1x11"] }),
    },
    {
      how: "generates a bike again from the tree",
      store: () => writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }),
    },
  ] as const;

  const NOT_FOUND = "Introuvable.";

  it.each(LAYOUTS.flatMap((layout) => STORES.map((stored) => ({ ...layout, ...stored }))))(
    "panel $layout: guest bike A on screen, 45 typed for its front tyre and NOT left; another page $how — guest bike B: not one byte of B moves, and the visitor is told what was not saved",
    async ({ desktop, store }) => {
      const { user } = await openGuest("gravel-1x11", desktop);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      const typedIn = field("etrto-width");
      const a = readLocalBike()!;

      const b = storedByAnotherPage(store);
      await settle(20);

      expect(b.bike.id, "a NEW guest bike").not.toBe(a.id);
      // The workspace is B's now: the field A's text was typed in is gone.
      expect(typedIn.isConnected).toBe(false);
      expect(readLocalBike()!.id).toBe(b.bike.id);
      expect(
        local("tire-front", "etrto-width"),
        "B's front tyre, which nobody typed anything for",
      ).toBe(42);
      // Not one byte of B moved — `updatedAt` included.
      expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(b.bytes);
      // Told once, of the part and the field the text was typed for.
      await waitFor(() => expect(notice.error).toHaveBeenCalledTimes(1));
      expect(notice.error.mock.calls[0][0]).toBe(UNSAVED_WIDTH);
      expect(notice.error.mock.calls[0][1]?.description).toBe(NOT_FOUND);

      // And B starts from a record of its own: nothing of A's refused write is
      // on it. Its width typed away and back, and the field left: not a write.
      await user.click(row("tire-front"));
      expect(title()).toBe("Pneu avant");
      expect(field("etrto-width").value).toBe("42");
      await typeInto(user, "etrto-width", "43");
      await typeInto(user, "etrto-width", "42");
      await user.tab();
      await settle();
      expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(b.bytes);
      expect(status("etrto-width")).toBe("");
      expect(notice.error).toHaveBeenCalledTimes(1);
    },
  );

  // The control: the same replacement under a form nothing was typed in. It
  // passed before the repair too — it is what shows that the difference above
  // is the typed text, and nothing else the replacement does.
  it.each(STORES)(
    "nothing typed (the control); another page $how: B is as it was stored, and nothing is said",
    async ({ store }) => {
      const { user } = await openGuest("gravel-1x11", true);
      await user.click(row("tire-front"));
      await user.click(field("etrto-width"));
      const typedIn = field("etrto-width");

      const b = storedByAnotherPage(store);
      await settle(20);

      expect(typedIn.isConnected).toBe(false);
      expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(b.bytes);
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  /**
   * The same bike replaced, and this page NOT told yet: a `storage` event is
   * delivered some time after the other page's write. A field left in that
   * window is an ordinary save, by a form that is still there — to a bike
   * that is not. It is refused under its own field.
   */
  it("the bike replaced and the event not delivered yet; 45 typed and the field LEFT: refused under the field, B untouched — and nothing more once the event arrives", async () => {
    const { user } = await openGuest("gravel-1x11", true);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    const typedIn = field("etrto-width");

    const b = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] })!;
    const bytes = window.localStorage.getItem(LOCAL_BIKE_KEY);
    await user.tab();
    await settle();

    expect(typedIn.isConnected, "the form of A is still on screen").toBe(true);
    expect(status("etrto-width")).toBe(NOT_FOUND);
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(bytes);
    expect(notice.error).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_BIKE_KEY }));
    });
    await settle(20);
    expect(typedIn.isConnected).toBe(false);
    expect(readLocalBike()!.id).toBe(b.id);
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(bytes);
    expect(notice.error).not.toHaveBeenCalled();
  });

  /**
   * The record of the form's own writes across a replacement that arrives
   * this way (the third review's cases unmount the first workspace first):
   * what this document wrote to A is not B's. It is the THIRD review's repair
   * this holds — it passed before the fourth's, and fails with a guest bike's
   * key put back to the word `local`.
   */
  it("A's width written (45) by this document; another page stores a NEW bike B; on B, 43 and then 42 typed and the field left: not a write", async () => {
    const { user } = await openGuest("gravel-1x11", true);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();
    expect(status("etrto-width")).toBe("Enregistré");
    expect(local("tire-front", "etrto-width")).toBe(45);

    const b = storedByAnotherPage(() => writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }));
    await settle();
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");
    await typeInto(user, "etrto-width", "43");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();

    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(b.bytes);
    expect(status("etrto-width")).toBe("");
    expect(notice.error).not.toHaveBeenCalled();
  });
});

describe("the demo bike", () => {
  it("still shows no form, on whichever part is picked on the drawing", async () => {
    setMediaQuery(MEDIA.desktop, true);
    window.history.replaceState(null, "", "/fr/velo/demo");
    const { user } = await renderWithIntl(
      <BikeWorkspace
        locale="fr"
        refKind="demo"
        bikeParam="demo"
        bikeId={null}
        name={null}
        build={presetBuild("gravel-1x11")}
        answers={BIKE_PRESETS["gravel-1x11"]}
        guides={[]}
        resume={null}
        description="un vélo"
      />,
    );
    await settle();
    await user.click(row("tire-front"));
    expect(screen.getByTestId("part-panel-fork")).toBeInTheDocument();
    await user.click(drawn("tire-rear"));
    await settle();

    expect(title()).toBe("Pneu arrière");
    expect(screen.queryByTestId("part-edit-form")).toBeNull();
    expect(screen.getByTestId("part-panel-fork")).toBeInTheDocument();
  });
});
