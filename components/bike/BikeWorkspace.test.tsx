import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readLocalBike, writeLocalBike } from "@/lib/bike/local-bike";
import { resetLocalBikeSnapshotCache } from "@/lib/bike/repo";
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
    await new Promise((resolve) => setTimeout(resolve, server.latencyMs));
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
  setMediaQuery(MEDIA.desktop, desktop);
  // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
  writeLocalBike({ answers: BIKE_PRESETS[preset], parts: build.parts });
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
  setMediaQuery(MEDIA.desktop, true);
  server.build = build;
  window.history.replaceState(null, "", `/fr/velo/${BIKE_ID}`);
  const view = await renderWithIntl(<BikeWorkspace {...savedProps(preset)} />);
  await settle();
  /** What `revalidatePath` makes Next do after a write: the page runs again. */
  const refreshPage = async (): Promise<void> => {
    const selected = new URL(window.location.href).searchParams.get("part") as PartId | null;
    view.rerender(<BikeWorkspace {...savedProps(preset, selected)} />);
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
  notice.error.mockClear();
  notice.unavailable = false;
  server.payloads.length = 0;
  server.latencyMs = 0;
  server.down = false;
  server.build = null;
  window.localStorage.clear();
  resetLocalBikeSnapshotCache();
  setMediaQuery(MEDIA.shortViewport, false);
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
    await settle();

    expect(notice.error).not.toHaveBeenCalled();
    const said = screen.getByTestId("unsaved-notices");
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
    await settle();

    expect(notice.error).toHaveBeenCalledTimes(1);
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
    await settle(20);

    expect(title()).toBe("Pneu arrière");
    expect(screen.getByTestId("unsaved-notices")).toHaveTextContent(UNSAVED_WIDTH);
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
