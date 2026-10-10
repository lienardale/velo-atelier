import { act, fireEvent, screen } from "@testing-library/react";
import { Component, StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createViewerStore,
  ViewerStoreProvider,
  type ViewerStore,
} from "@/components/bike3d/store";
import { fail, ok, type ActionErrorCode } from "@/lib/actions/result";
import { readLocalBike, writeLocalBike, type KeyValueStorage } from "@/lib/bike/local-bike";
import { bikeRepoFor, localBikeRepo, type BikeRepo, type RemoteBikeActions } from "@/lib/bike/repo";
import { forgetWrites } from "@/lib/bike/own-writes";
import { hasMesh, partDefinition, type PartId } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { setAttribute } from "@/lib/domain/engine/validate-build";
import type { AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import type { Locale } from "@/lib/i18n/routing";
import { renderWithIntl } from "@/tests/_helpers/intl";
import {
  anotherValue,
  attributeOf,
  distinctBuild,
  formAttributes,
  isTyped,
  PRESET_IDS,
  presetBuild,
  sharedTypedPairs,
  sharedUntypedPairs,
} from "@/tests/_helpers/part-attributes";

import { PartsPanel, type PanelTab } from "./PartsPanel";

/**
 * The part edit form, THROUGH the panel that hosts it (`.debug/017` §5.8).
 *
 * `PartInfo.test.tsx` renders the "Infos" tab with a hand-set `partId`, which
 * is why it never saw the defect these tests exist for: the bug is in what
 * happens to the form when the SELECTION changes under a tab that stays open,
 * and that takes the real `PartsPanel` on the real viewer store. A part picked
 * on the bike is the store call the mesh makes (`components/bike3d/Part.tsx`,
 * held by `tests/bike3d/bike-model.test.tsx`); a hosted part, which no mesh
 * selects, is reached the way `?part=` reaches it (`components/bike3d/url-sync.ts`).
 * The click on a real canvas is `tests/e2e/part-panel.spec.ts`.
 *
 * Four properties, each for the guest bike (the real `localBikeRepo`) and for
 * a saved one (the real `remoteBikeRepo`, over an action that answers like
 * `updateBikePartAction` — the real one runs in `tests/integration/part-form.test.ts`):
 *
 *   P1  a part gets its OWN form: its stored values, and no status of another's;
 *   P2  nothing is ever written to a part other than the one it was typed for;
 *   P3  focusing a field and leaving it is not a write;
 *   P4  text typed and not left is committed, to its own part, when the field
 *       goes away — and a refusal that arrives after the field is gone is SAID.
 *
 * The blocks after P5, "what the review found", are one case per defect a
 * review of the first version of the fix reproduced (`.debug/017` §5.8,
 * "Review of the fix"), and "what the second review found" one per defect its
 * repair left reachable ("Second review").
 */

const notice = vi.hoisted(() => ({
  error:
    vi.fn<
      (
        title: string,
        options?: { description?: string; duration?: number; richColors?: boolean },
      ) => void
    >(),
}));
vi.mock("sonner", () => ({ toast: { error: notice.error } }));

class MemoryStorage implements KeyValueStorage {
  private value: string | null = null;
  /** A browser whose storage is full refuses the write, by throwing. */
  full = false;
  getItem(): string | null {
    return this.value;
  }
  setItem(_key: string, value: string): void {
    if (this.full) throw new DOMException("quota", "QuotaExceededError");
    this.value = value;
  }
  removeItem(): void {
    this.value = null;
  }
}

interface Write {
  partId: string;
  key: string;
  value: AttributeValue | null;
}

/** A bike somewhere, the repo that writes to it, and everything that was asked of that repo. */
interface World {
  kind: "guest" | "saved";
  /** The `[id]` segment the bike is addressed by: `local`, or a saved bike's id. */
  bikeParam: string;
  repo: BikeRepo;
  build: BikeBuild;
  writes: Write[];
  /** The truth: what the destination holds, whatever the page shows. */
  stored(partId: string, key: string): AttributeValue | undefined;
  /** Guest bike only: from now on the browser's storage is full. */
  fill?: () => void;
  /** A `held` saved bike only: let the oldest `count` writes in flight be answered. */
  answer?: (count?: number) => Promise<void>;
  /**
   * A saved bike only: this world again, behind a NEW repo object — the same
   * bike, the same server, the same writes in flight. It is what a workspace
   * mounted again after a route change is handed: `BikeWorkspace` builds its
   * repo when it mounts.
   */
  mountedAgain?: () => World;
}

function recording(inner: BikeRepo, writes: Write[]): BikeRepo {
  return {
    kind: inner.kind,
    bikeParam: inner.bikeParam,
    canEdit: inner.canEdit,
    setAttribute: (build, edit) => {
      writes.push({ partId: edit.partId, key: edit.key, value: edit.value });
      return inner.setAttribute(build, edit);
    },
    setFit: inner.setFit,
  };
}

function guestWorld(preset: PresetId, build: BikeBuild = presetBuild(preset)): World {
  const storage = new MemoryStorage();
  // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
  writeLocalBike({ answers: BIKE_PRESETS[preset], parts: build.parts }, { storage });
  const writes: Write[] = [];
  return {
    kind: "guest",
    bikeParam: "local",
    repo: recording(localBikeRepo({ storage }), writes),
    build,
    writes,
    fill: () => {
      storage.full = true;
    },
    stored: (partId, key) => {
      const bike = readLocalBike(storage);
      if (bike === null) throw new Error("the guest bike is gone");
      return attributeOf({ spec: bike.spec, parts: bike.parts }, partId, key);
    },
  };
}

const BIKE_ID = "3f0c1f0e-6f0a-4c56-9d3b-1c2d3e4f5a6b";
/** Another saved bike of the same account. */
const OTHER_BIKE_ID = "9b2d7c1a-5e3f-4a8b-b6c4-0d1e2f3a4b5c";

/**
 * Every write a `held` saved bike has not been told to answer yet, across the
 * file. A case that FAILS half-way leaves one behind, and React entangles
 * async transitions: with one that never settles, the cases after it wait for
 * ever on theirs and fail too, for no reason of their own (seen under
 * mutations). `afterEach` lets them all through.
 */
const stillHeld = new Set<() => void>();

/**
 * A saved bike: the real `remoteBikeRepo`, over an action that keeps the build
 * and answers as `updateBikePartAction` does — the domain's own `setAttribute`,
 * the refusal keyed by the field. `down` makes it not answer at all; `refuse`
 * makes it answer with that code, whatever is asked.
 *
 * `held` is what lets an answer arrive after its form is gone: every call
 * waits until the TEST lets it be answered (`world.answer()`), so "a write is
 * in flight" is a state the test is in, not a race against a timer. These
 * cases were timed at first — a 60 ms answer against the clicks that had to
 * fit before it — and one of them failed once under the load of the whole
 * suite (2026-10-09, `bash scripts/ci.sh`: the answer came first).
 *
 * `queued` makes it answer ONE CALL AT A TIME, in the order sent, which is
 * what Next's client does with server actions while the page stays put: two
 * writes of one field then land in the order they were typed.
 *
 * `bikeId` is which bike the form takes it for. Two worlds made with the same
 * id are that one bike behind two servers, each with a build of its own;
 * `mountedAgain()` is the same bike behind the SAME server.
 */
function savedWorld(
  preset: PresetId,
  build: BikeBuild = presetBuild(preset),
  {
    held = false,
    down = false,
    queued = false,
    refuse,
    bikeId = BIKE_ID,
  }: {
    held?: boolean;
    down?: boolean;
    queued?: boolean;
    refuse?: ActionErrorCode;
    bikeId?: string;
  } = {},
): World {
  let server = build;
  const writes: Write[] = [];
  let turn: Promise<unknown> = Promise.resolve();
  const inFlight: (() => void)[] = [];
  const answer = async (input: {
    partId: string;
    attributes: Record<string, AttributeValue | null>;
  }) => {
    if (held) {
      await new Promise<void>((resolve) => {
        inFlight.push(resolve);
        stillHeld.add(resolve);
      });
    }
    if (down) throw new Error("the action did not answer");
    if (refuse !== undefined) return fail(refuse);
    let next = server;
    for (const [key, value] of Object.entries(input.attributes)) {
      const change = setAttribute(next, input.partId, key, value);
      if (!change.ok) {
        return fail("VALIDATION", { fieldErrors: { [key]: `bike.errors.${change.code}` } });
      }
      next = change.build;
    }
    server = next;
    return ok(server);
  };
  const actions: RemoteBikeActions = {
    async updatePart(input) {
      if (input.bikeId !== bikeId) return fail("NOT_FOUND");
      for (const [key, value] of Object.entries(input.attributes)) {
        writes.push({ partId: input.partId, key, value });
      }
      if (!queued) return answer(input);
      const mine = turn.then(() => answer(input));
      turn = mine.catch(() => undefined);
      return mine;
    },
    updateFit: async () => fail("NOT_FOUND"),
  };
  const world: World = {
    kind: "saved",
    bikeParam: bikeId,
    repo: bikeRepoFor("db", { bikeId, actions }),
    build,
    writes,
    stored: (partId, key) => attributeOf(server, partId, key),
    answer: async (count = 1) => {
      for (let index = 0; index < count; index += 1) {
        const next = inFlight.shift();
        if (next === undefined) throw new Error("no write is in flight to be answered");
        stillHeld.delete(next);
        next();
        await settle();
      }
    },
    mountedAgain: () => ({ ...world, repo: bikeRepoFor("db", { bikeId, actions }) }),
  };
  return world;
}

const WORLDS = {
  guest: guestWorld,
  saved: (preset: PresetId, build?: BikeBuild) => savedWorld(preset, build),
} as const;
const KINDS = ["guest", "saved"] as const;

/** `PartsPanel` with its tab and its live build owned as `BikeWorkspace` owns them. */
function Harness({ world }: { world: World }): React.JSX.Element {
  const [tab, setTab] = useState<PanelTab>("parts");
  const [liveBuild, setLiveBuild] = useState<BikeBuild>(world.build);
  return (
    <PartsPanel
      build={liveBuild}
      repo={world.repo}
      guides={[]}
      bikeParam={world.bikeParam}
      tab={tab}
      onTabChange={setTab}
      onSaved={setLiveBuild}
    />
  );
}

/** Stands where the route's `error.tsx` stands: what an unanswered write ends in. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? <p data-testid="error-boundary">error.tsx</p> : this.props.children;
  }
}

async function open(world: World, locale: Locale = "fr", { strict = false } = {}) {
  const store: ViewerStore = createViewerStore({
    availablePartIds: world.build.parts.map((part) => part.partId as PartId),
  });
  const tree = (
    <ViewerStoreProvider store={store}>
      <Boundary>
        <Harness world={world} />
      </Boundary>
    </ViewerStoreProvider>
  );
  // `strict` is `npm run dev` (`next.config.ts`: `reactStrictMode`): every
  // effect runs, is cleaned up, and runs again on the same instance.
  const view = await renderWithIntl(strict ? <StrictMode>{tree}</StrictMode> : tree, { locale });
  return { ...view, store };
}

/** Let what is pending answer: a write, a transition, a timer of `ms`. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const row = (partId: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-part-row="${partId}"]`)!;
const form = (): HTMLElement | null => screen.queryByTestId("part-edit-form");
const field = (key: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-testid="part-edit-form"] [data-attr="${key}"]`)!;
const status = (key: string): string =>
  screen.queryByTestId(`attr-status-${key}`)?.textContent ?? "(no status line)";
const title = (): string => screen.queryByTestId("part-panel-title")?.textContent ?? "(no part)";
const statuses = (): string[] =>
  [...document.querySelectorAll('[data-testid^="attr-status-"]')].map(
    (line) => line.textContent ?? "",
  );

/**
 * Select a part ON THE BIKE: the tab does not change. A part with a mesh is
 * picked the way a tap on it does; a hosted one the way `?part=` does.
 */
function selectOnBike(store: ViewerStore, partId: string): void {
  const definition = partDefinition(partId);
  if (definition === undefined) throw new Error(`${partId} is not in the catalogue`);
  act(() => {
    if (hasMesh(definition)) store.api.getState().activate(partId as PartId, "canvas");
    else store.api.getState().select(partId as PartId, { source: "url", focus: false });
  });
}

/** What a control shows, as the value the build would hold for it. */
function shown(control: Element): string {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    return String(control.checked);
  }
  return (control as HTMLInputElement | HTMLSelectElement).value;
}

/** What the build holds, as a control would show it. */
function asShown(kind: string, value: AttributeValue | undefined): string {
  if (kind === "boolean") return String(value === true);
  return value === undefined ? "" : String(value);
}

type User = Awaited<ReturnType<typeof open>>["user"];

/** Replace what a field holds, and STAY in it. */
async function typeInto(user: User, key: string, text: string): Promise<void> {
  await user.clear(field(key));
  if (text !== "") await user.type(field(key), text);
  expect(document.activeElement).toBe(field(key));
}

/**
 * Put text a number input cannot read into the field of `key` — `45.` on the
 * way to 45.5, a lone minus, `4e` — the way Chromium reports it to a script:
 * an EMPTY value, with `validity.badInput` the only sign that the field holds
 * anything (measured, `tests/e2e/part-panel.spec.ts`). jsdom has no such
 * state, so it is given one; the real thing is in that spec.
 */
function typeUnreadableInto(key: string): void {
  const node = field(key);
  act(() => node.focus());
  Object.defineProperty(node, "validity", { configurable: true, value: { badInput: true } });
  fireEvent.change(node, { target: { value: "" } });
  expect(document.activeElement).toBe(node);
}

const UNSAVED_WIDTH = "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.";
const NOT_POSSIBLE = "Cette valeur n’est pas possible pour cette caractéristique.";

/** The stock gravel bike with one tyre's width set: what a page hands down after that write. */
function withWidth(partId: "tire-front" | "tire-rear", width: number): BikeBuild {
  const change = setAttribute(presetBuild("gravel-1x11"), partId, "etrto-width", width);
  if (!change.ok) throw new Error("the domain refused the seed");
  return change.build;
}

beforeEach(() => {
  notice.error.mockClear();
  // Each case is a document of its own, and the form's record of what it has
  // written is one document's: two cases share the bikes' NAMES (`local`,
  // `BIKE_ID`) and nothing else.
  forgetWrites();
});

afterEach(async () => {
  for (const release of stillHeld) release();
  stillHeld.clear();
  await settle();
});

// ── P1 ───────────────────────────────────────────────────────────────────────

describe("P1 — a part gets its own form", () => {
  it.each(KINDS)(
    "the fork's travel is neither shown nor written for the dropper post picked on the bike — %s bike, both ways round",
    async (kind) => {
      // The defect as it was live: nothing typed, a stock bike. 140 and 170.
      for (const [first, second] of [
        ["fork", "seatpost"],
        ["seatpost", "fork"],
      ] as const) {
        // eslint-disable-next-line security/detect-object-injection -- one of the two literals above
        const world = WORLDS[kind]("mtb-full-dropper-1x12");
        const own = world.stored(second, "travel-mm");
        const { user, store, unmount } = await open(world);

        await user.click(row(first));
        expect(field("travel-mm").value).toBe(String(world.stored(first, "travel-mm")));

        selectOnBike(store, second);
        expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Infos");
        expect(field("travel-mm").value, `${second}'s field`).toBe(String(own));
        expect(field("travel-mm").id).toBe(`attr-${second}-travel-mm`);

        // Click into the field and out, nothing typed.
        await user.click(field("travel-mm"));
        await user.tab();
        await settle();
        expect(world.writes).toEqual([]);
        expect(world.stored(second, "travel-mm")).toBe(own);
        unmount();
      }
    },
  );

  it.each(KINDS)(
    "a width typed for the front tyre is neither shown, nor flagged saved, nor written for the rear tyre — %s bike",
    async (kind) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11", distinctBuild("gravel-1x11"));
      const rear = world.stored("tire-rear", "etrto-width");
      const { user, store } = await open(world);

      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      await user.tab(); // the field is left: the front tyre is saved
      await settle();
      expect(status("etrto-width")).toBe("Enregistré");

      selectOnBike(store, "tire-rear");
      expect(title()).toBe("Pneu arrière");
      expect(field("etrto-width").value).toBe(String(rear));
      expect(status("etrto-width"), "no 'Enregistré' carried over").toBe("");

      await user.click(field("etrto-width"));
      await user.tab();
      await settle();
      expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
      expect(world.stored("tire-front", "etrto-width")).toBe(45);
      expect(world.stored("tire-rear", "etrto-width")).toBe(rear);
    },
  );

  /**
   * Every part of every preset, one after the other, without ever leaving
   * "Infos": each has to show ITS values under no status at all, and tabbing
   * through its form has to send nothing. `distinctBuild` gives every number
   * and text field a value of its own, so that a field showing the previous
   * part's value cannot pass for one showing the right one.
   */
  it.each(PRESET_IDS.flatMap((preset) => KINDS.map((kind) => [preset, kind] as const)))(
    "%s, %s bike: every part picked on the bike shows its own values, no status of the previous part, and sends nothing when its form is only visited",
    async (preset, kind) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind](preset, distinctBuild(preset));
      const attributes = formAttributes(world.build);
      const partIds = world.build.parts.map((part) => part.partId);
      const { user, store } = await open(world);
      const expected: Write[] = [];

      await user.click(row(partIds[0]));
      for (const [index, partId] of partIds.entries()) {
        if (index > 0) selectOnBike(store, partId);
        const own = attributes.filter((entry) => entry.partId === partId);
        expect(title().length, partId).toBeGreaterThan(0);
        if (own.length === 0) {
          expect(form(), `${partId} has nothing to edit`).toBeNull();
          continue;
        }

        const controls = [...form()!.querySelectorAll("[data-attr]")];
        expect(controls.map((control) => control.getAttribute("data-attr"))).toEqual(
          own.map((entry) => entry.attribute.key),
        );
        for (const [at, entry] of own.entries()) {
          // eslint-disable-next-line security/detect-object-injection -- the index of the loop
          expect(shown(controls[at]), `${partId}.${entry.attribute.key}`).toBe(
            asShown(entry.attribute.kind, world.stored(partId, entry.attribute.key)),
          );
        }
        expect(statuses(), `${partId}: a status line of the previous part`).toEqual(
          own.map(() => ""),
        );

        // Visit every control and change nothing.
        for (const control of controls) {
          fireEvent.focus(control);
          fireEvent.blur(control);
        }
        await settle();
        expect(world.writes, `${partId}: visiting its form wrote something`).toEqual(expected);

        // Then leave something behind for the NEXT part to inherit, if it could:
        // a saved value, and its "Enregistré".
        const typed = own.find((entry) => isTyped(entry.attribute));
        if (typed === undefined) continue;
        const key = typed.attribute.key;
        const value = anotherValue(
          typed.attribute,
          ...attributes
            .filter((entry) => entry.attribute.key === key)
            .map((entry) => world.stored(entry.partId, key)),
        );
        fireEvent.change(field(key), { target: { value: String(value) } });
        fireEvent.blur(field(key));
        await settle();
        expected.push({ partId, key, value });
        expect(status(key), `${partId}.${key}`).toBe("Enregistré");
      }

      expect(world.writes).toEqual(expected);
      for (const write of expected) {
        expect(world.stored(write.partId, write.key), `${write.partId}.${write.key}`).toBe(
          write.value,
        );
      }
    },
  );
});

// ── P2 ───────────────────────────────────────────────────────────────────────

describe("P2 — nothing is written to a part other than the one it was typed for", () => {
  const pairs = sharedTypedPairs();

  it("covers every pair of parts with a typed field of the same name, hosted ones included", () => {
    // From the catalogue, over the seven presets — never a hand-picked list.
    // The eleven keys known on 2026-10-09 are named so that an enumeration
    // that finds nothing cannot leave the cases below vacuously green.
    expect([...new Set(pairs.map((pair) => pair.key))]).toEqual(
      expect.arrayContaining([
        "seatpost-diameter",
        "seat-clamp-diameter",
        "max-tire-width",
        "max-rotor",
        "travel-mm",
        "etrto-width",
        "valve-length",
        "piston-count",
        "pad-model",
        "pad-thickness",
        "bar-clamp",
      ]),
    );
    expect(pairs.length).toBeGreaterThanOrEqual(22);
    // Both directions of each.
    for (const pair of pairs) {
      expect(
        pairs.some(
          (other) =>
            other.key === pair.key &&
            other.from.partId === pair.to.partId &&
            other.to.partId === pair.from.partId,
        ),
        `${pair.key}: ${pair.to.partId} -> ${pair.from.partId}`,
      ).toBe(true);
    }
  });

  const cases = pairs.flatMap((pair) =>
    KINDS.flatMap((kind) =>
      (["the field is left first", "the selection changes first"] as const).map(
        (order) => [pair.key, pair.from.partId, pair.to.partId, kind, order, pair] as const,
      ),
    ),
  );

  it.each(cases)(
    "%s typed for %s, then %s picked on the bike — %s bike, %s",
    async (key, from, to, kind, order, pair) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind](pair.preset, distinctBuild(pair.preset));
      const theirs = world.stored(to, key);
      const value = anotherValue(pair.from.attribute, world.stored(from, key), theirs);
      const { user, store } = await open(world);

      await user.click(row(from));
      await typeInto(user, key, String(value));
      if (order === "the field is left first") {
        await user.tab();
        await settle();
      }
      const typedIn = field(key);
      selectOnBike(store, to);
      await settle();

      // The other part's own form: a new field, its value, nothing reported.
      expect(field(key)).not.toBe(typedIn);
      expect(field(key).id).toBe(`attr-${to}-${key}`);
      expect(field(key).value).toBe(asShown(pair.to.attribute.kind, theirs));
      expect(status(key)).toBe("");

      // And everything a visitor can then do to it without typing.
      await user.click(field(key));
      await user.tab();
      for (const control of form()!.querySelectorAll("[data-attr]")) {
        fireEvent.focus(control);
        fireEvent.blur(control);
      }
      await settle();

      expect(world.writes).toEqual([{ partId: from, key, value }]);
      expect(world.stored(from, key)).toBe(value);
      expect(world.stored(to, key)).toBe(theirs);
      expect(notice.error).not.toHaveBeenCalled();
    },
  );
});

// ── P3 ───────────────────────────────────────────────────────────────────────

describe("P3 — focusing a field and leaving it is not a write", () => {
  it.each(KINDS)(
    "a number field entered and left unchanged sends nothing and reports nothing — %s bike",
    async (kind) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      const { user } = await open(world);
      await user.click(row("tire-front"));

      await user.click(field("etrto-width"));
      await user.tab();
      await settle();

      expect(world.writes).toEqual([]);
      expect(status("etrto-width")).toBe("");
      expect(field("etrto-width").value).toBe("42");
    },
  );

  it.each(KINDS)("tabbing through a whole form sends nothing — %s bike", async (kind) => {
    // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
    const world = WORLDS[kind]("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));

    const controls = [...form()!.querySelectorAll<HTMLElement>("[data-attr]")];
    expect(controls.length).toBeGreaterThan(1);
    act(() => controls[0].focus());
    for (let index = 0; index < controls.length; index += 1) await user.tab();
    await settle();

    expect(world.writes).toEqual([]);
    expect(statuses()).toEqual(controls.map(() => ""));
  });

  it("a number typed and put back, or the same number written another way, is not a write", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));

    await typeInto(user, "etrto-width", "45");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await typeInto(user, "etrto-width", "42.0");
    await user.tab();
    await settle();

    expect(world.writes).toEqual([]);
    expect(status("etrto-width")).toBe("");
  });

  it("a text field entered and left, or retyped as it was with a space after it, is not a write", async () => {
    const world = guestWorld("gravel-1x11", distinctBuild("gravel-1x11"));
    const model = String(world.stored("brake-pads-front", "pad-model"));
    const { user } = await open(world);
    await user.click(row("brake-pads-front"));
    expect(field("pad-model").value).toBe(model);

    await user.click(field("pad-model"));
    await user.tab();
    await typeInto(user, "pad-model", `${model} `);
    await user.tab();
    await settle();

    expect(world.writes).toEqual([]);
    expect(status("pad-model")).toBe("");
  });

  it.each(KINDS)(
    "a stored value the form would not have written that way is not rewritten by a visit — %s bike",
    async (kind) => {
      // The domain keeps a text as it is given; this form trims what is typed.
      // A reference stored with spaces around it — by an import, by another
      // writer — shows as it is, and comparing what the field holds with what
      // is stored would call it "changed" the first time the field is left.
      const spaced = setAttribute(
        presetBuild("gravel-1x11"),
        "brake-pads-front",
        "pad-model",
        " L05A ",
      );
      if (!spaced.ok) throw new Error("the domain refused the seed");
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11", spaced.build);
      const { user } = await open(world);
      await user.click(row("brake-pads-front"));
      expect(field("pad-model").value).toBe(" L05A ");

      await user.click(field("pad-model"));
      await user.tab();
      await settle();

      expect(world.writes).toEqual([]);
      expect(status("pad-model")).toBe("");
      expect(world.stored("brake-pads-front", "pad-model")).toBe(" L05A ");
    },
  );

  it.each(KINDS)(
    "text typed into a field that stores nothing, then deleted, is not a write — the field left, or the tab pressed — %s bike",
    async (kind) => {
      // "Nothing" compared with "nothing stored": the other arm of the
      // comparison, which no case held until the review.
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      expect(world.stored("brake-pads-front", "pad-model")).toBeUndefined();
      const { user } = await open(world);
      await user.click(row("brake-pads-front"));

      await typeInto(user, "pad-model", "L05A");
      await typeInto(user, "pad-model", "");
      await user.tab();
      await settle();
      expect(world.writes).toEqual([]);
      expect(status("pad-model")).toBe("");

      await typeInto(user, "pad-model", "L05A");
      await typeInto(user, "pad-model", "");
      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();
      expect(world.writes).toEqual([]);
      expect(world.stored("brake-pads-front", "pad-model")).toBeUndefined();
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  it("putting the stored value back after a refusal sends nothing, and takes the refusal away", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));

    await typeInto(user, "etrto-width", "999");
    await user.tab();
    await settle();
    expect(status("etrto-width")).toBe(
      "Cette valeur n’est pas possible pour cette caractéristique.",
    );
    expect(world.writes).toHaveLength(1);

    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();
    expect(world.writes).toHaveLength(1);
    expect(status("etrto-width")).toBe("");
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
  });
});

// ── P4 ───────────────────────────────────────────────────────────────────────

describe("P4 — text typed and not left is committed to its own part when the field goes away", () => {
  const tabs = ["Pièces", "Actions"] as const;

  it.each(KINDS.flatMap((kind) => tabs.map((tab) => [kind, tab] as const)))(
    "%s bike: a width typed and not left is saved when the next press is the '%s' tab",
    async (kind, tab) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      const { user } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");

      await user.click(screen.getByRole("tab", { name: tab }));
      await settle();

      expect(form()).toBeNull();
      expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
      expect(world.stored("tire-front", "etrto-width")).toBe(45);
      expect(world.stored("tire-rear", "etrto-width")).toBe(42);
      expect(notice.error).not.toHaveBeenCalled();

      // Back on the tyre, the field says what is stored — and is not a write waiting to happen.
      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await user.click(row("tire-front"));
      expect(field("etrto-width").value).toBe("45");
      await user.click(field("etrto-width"));
      await user.tab();
      await settle();
      expect(world.writes).toHaveLength(1);
    },
  );

  it.each(KINDS)(
    "%s bike: a pad reference typed and not left is saved, and an emptied field not left clears the attribute",
    async (kind) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      const { user } = await open(world);
      await user.click(row("brake-pads-front"));
      await typeInto(user, "pad-model", "L05A");
      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();
      expect(world.stored("brake-pads-front", "pad-model")).toBe("L05A");
      expect(world.stored("brake-pads-rear", "pad-model")).toBeUndefined();

      await user.click(row("brake-pads-front"));
      await typeInto(user, "pad-model", "");
      await user.click(screen.getByRole("tab", { name: "Actions" }));
      await settle();
      expect(world.writes).toEqual([
        { partId: "brake-pads-front", key: "pad-model", value: "L05A" },
        { partId: "brake-pads-front", key: "pad-model", value: null },
      ]);
      expect(world.stored("brake-pads-front", "pad-model")).toBeUndefined();
    },
  );

  it("a value committed by leaving the field is not committed a second time when the field goes away", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
  });

  it("what is committed on removal is compared with what is stored NOW, not with what the field mounted with", async () => {
    // 42 at mount; 45 saved; then 42 typed again and not left. Compared with
    // the value the field first rendered, that 42 would be "unchanged" and lost.
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();
    await typeInto(user, "etrto-width", "42");

    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(world.writes).toEqual([
      { partId: "tire-front", key: "etrto-width", value: 45 },
      { partId: "tire-front", key: "etrto-width", value: 42 },
    ]);
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
  });

  it("text typed, put back and not left is not a write when the field goes away", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await typeInto(user, "etrto-width", "42");

    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(world.writes).toEqual([]);
  });

  it("the guest bike is in storage before the removal returns — no answer is waited for", async () => {
    // What a route change relies on: the panel is torn down, and nothing after it runs for sure.
    const world = guestWorld("gravel-1x11");
    const { user, unmount } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");

    unmount();

    expect(world.stored("tire-front", "etrto-width")).toBe(45);
  });

  it("a saved bike's field follows the write that answers after the visitor came straight back to the part", async () => {
    // The removal's write is still in flight when the form is mounted again, on
    // the OLD stored value. Left to `defaultValue`, the field would go on
    // showing it after the answer, beside a read-only line saying 45.
    const world = savedWorld("gravel-1x11", undefined, { held: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");
    expect(world.stored("tire-front", "etrto-width")).toBe(42);

    await world.answer!();

    expect(world.stored("tire-front", "etrto-width")).toBe(45);
    expect(field("etrto-width").value).toBe("45");
    expect(document.querySelector('[data-attr-row="etrto-width"] dd')).toHaveTextContent("45 mm");
    await user.click(field("etrto-width"));
    await user.tab();
    await settle();
    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
  });

  it("does not replace what the visitor is typing when the stored value changes under the field", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "50"); // typed while 45 is still in flight

    await world.answer!();
    expect(world.stored("tire-front", "etrto-width")).toBe(45);
    expect(field("etrto-width").value).toBe("50");

    await user.tab();
    await world.answer!();
    expect(world.stored("tire-front", "etrto-width")).toBe(50);
  });

  describe("and when that write is refused, the visitor is told — the field that would have said so is gone", () => {
    it.each([
      ["fr", "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée."],
      ["en", "Front tyre · Tyre width: what you typed was not saved."],
    ] as const)("names the part and the field, with the reason (%s)", async (locale, sentence) => {
      const world = guestWorld("gravel-1x11");
      const { user } = await open(world, locale);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "999"); // out of the 18–130 the domain accepts

      await user.click(screen.getByRole("tab", { name: locale === "fr" ? "Pièces" : "Parts" }));
      await settle();

      expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 999 }]);
      expect(world.stored("tire-front", "etrto-width")).toBe(42);
      expect(notice.error).toHaveBeenCalledTimes(1);
      const [said, options] = notice.error.mock.calls[0];
      expect(said).toBe(sentence);
      expect(options?.description).toBe(
        locale === "fr"
          ? "Cette valeur n’est pas possible pour cette caractéristique."
          : "That value is not possible for this property.",
      );
      // Long enough to be read: sonner's default is four seconds.
      expect(options?.duration).toBeGreaterThanOrEqual(10_000);
      // Not sonner's "rich" error colours: 4.34:1, below AA (the e2e runs axe on it).
      expect(options?.richColors).toBe(false);
    });

    it("says it of a write that did not answer at all, with no reason invented", async () => {
      const world = savedWorld("gravel-1x11", undefined, { down: true });
      const { user } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");

      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();

      expect(world.stored("tire-front", "etrto-width")).toBe(42);
      expect(notice.error).toHaveBeenCalledTimes(1);
      const [said, options] = notice.error.mock.calls[0];
      expect(said).toBe("Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.");
      expect(options?.description).toBeUndefined();
    });

    it("says it of an ORDINARY save that is refused after the visitor picked another part — and not under that part's field", async () => {
      // The field was left, so this is the blur's write; the answer comes back
      // to a form that is no longer there.
      const world = savedWorld("gravel-1x11", undefined, { held: true });
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "999");
      await user.tab();
      expect(status("etrto-width")).toBe("Enregistrement…");

      selectOnBike(store, "tire-rear");
      await world.answer!();

      expect(title()).toBe("Pneu arrière");
      expect(status("etrto-width"), "the rear tyre did nothing wrong").toBe("");
      expect(field("etrto-width").value).toBe("42");
      expect(notice.error).toHaveBeenCalledTimes(1);
      expect(notice.error.mock.calls[0][0]).toBe(
        "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.",
      );
      expect(world.stored("tire-front", "etrto-width")).toBe(42);
      expect(world.stored("tire-rear", "etrto-width")).toBe(42);
    });

    it("says it of an ORDINARY save that does not answer after the visitor picked another part — and replaces nothing with the error page", async () => {
      const world = savedWorld("gravel-1x11", undefined, { held: true, down: true });
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      await user.tab();

      selectOnBike(store, "tire-rear");
      await world.answer!();

      expect(screen.queryByTestId("error-boundary")).toBeNull();
      expect(title()).toBe("Pneu arrière");
      expect(notice.error).toHaveBeenCalledTimes(1);
      const [said, options] = notice.error.mock.calls[0];
      expect(said).toBe("Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.");
      expect(options?.description).toBeUndefined();
    });

    it("says nothing when such a write succeeds: the build is handed up, and the part shows it", async () => {
      const world = savedWorld("gravel-1x11", undefined, { held: true });
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      await user.tab();

      selectOnBike(store, "tire-rear");
      await world.answer!();
      expect(notice.error).not.toHaveBeenCalled();
      expect(status("etrto-width")).toBe("");

      selectOnBike(store, "tire-front");
      expect(field("etrto-width").value).toBe("45");
      expect(document.querySelector('[data-attr-row="etrto-width"] dd')).toHaveTextContent("45 mm");
    });
  });
});

// ── P5 ───────────────────────────────────────────────────────────────────────

describe("P5 — what did not change", () => {
  it.each(KINDS)(
    "a select and a checkbox still save on change, each under its own status — %s bike",
    async (kind) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      const { user } = await open(world);
      await user.click(row("tire-front"));

      await user.selectOptions(field("tread"), "slick");
      await settle();
      expect(status("tread")).toBe("Enregistré");
      expect(world.stored("tire-front", "tread")).toBe("slick");
      expect(status("etrto-width")).toBe("");

      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await user.click(row("wheel-front"));
      const before = world.stored("wheel-front", "tubeless-ready");
      await user.click(field("tubeless-ready"));
      await settle();
      expect(status("tubeless-ready")).toBe("Enregistré");
      expect(world.stored("wheel-front", "tubeless-ready")).toBe(before !== true);
      expect(world.writes).toEqual([
        { partId: "tire-front", key: "tread", value: "slick" },
        { partId: "wheel-front", key: "tubeless-ready", value: before !== true },
      ]);
    },
  );

  it.each(KINDS)(
    "a refused number is said under its field, kept on screen, and sent again when the field is left again — %s bike",
    async (kind) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      const { user } = await open(world);
      await user.click(row("tire-front"));

      await typeInto(user, "etrto-width", "999");
      await user.tab();
      await settle();
      expect(status("etrto-width")).toBe(
        "Cette valeur n’est pas possible pour cette caractéristique.",
      );
      expect(field("etrto-width").value).toBe("999");
      expect(world.stored("tire-front", "etrto-width")).toBe(42);
      expect(notice.error).not.toHaveBeenCalled();

      // As before the fix: leaving the field again tries again.
      await user.click(field("etrto-width"));
      await user.tab();
      await settle();
      expect(world.writes).toEqual([
        { partId: "tire-front", key: "etrto-width", value: 999 },
        { partId: "tire-front", key: "etrto-width", value: 999 },
      ]);

      // …but a refused value is not sent a third time by the removal: the
      // visitor has been told, under the field, twice.
      await user.click(field("etrto-width"));
      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();
      expect(world.writes).toHaveLength(2);
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  it("a save that does not answer while its form is on screen still ends in the route's error page, not in a notice", async () => {
    // As before the fix: a thrown write is not an expected failure (`ActionResult`'s own rule).
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const world = savedWorld("gravel-1x11", undefined, { down: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    expect(notice.error).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it.each(KINDS)("a field emptied and left still clears the attribute — %s bike", async (kind) => {
    // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
    const world = WORLDS[kind]("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));

    await typeInto(user, "etrto-width", "");
    await user.tab();
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: null }]);
    expect(world.stored("tire-front", "etrto-width")).toBeUndefined();
    expect(status("etrto-width")).toBe("Enregistré");
  });

  it("an ordinary edit says 'Enregistrement…' and then 'Enregistré', under the field", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));

    await typeInto(user, "etrto-width", "45");
    await user.tab();
    expect(status("etrto-width")).toBe("Enregistrement…");
    expect(field("etrto-width")).toBeDisabled();
    await world.answer!();
    expect(status("etrto-width")).toBe("Enregistré");
    expect(field("etrto-width")).not.toBeDisabled();
    expect(field("etrto-width").value).toBe("45");
  });
});

// ── what the review found ────────────────────────────────────────────────────

describe("what the review found — text a number field cannot read is never a clear", () => {
  /**
   * `45.` typed on the way to 45.5 and the next press a tab: the browser
   * reports an empty value, the removal sent it as a clear, the write
   * succeeded and nothing was said. Before rule 3 the stored value survived.
   */
  const exits = [
    "the 'Pièces' tab is pressed",
    "the 'Actions' tab is pressed",
    "another part is picked on the bike",
  ] as const;

  it.each(KINDS.flatMap((kind) => exits.map((exit) => [kind, exit] as const)))(
    "%s bike: unreadable text typed and not left, then %s — nothing is sent, the stored width stays, and the visitor is told",
    async (kind, exit) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11", distinctBuild("gravel-1x11"));
      const own = world.stored("tire-front", "etrto-width");
      const rear = world.stored("tire-rear", "etrto-width");
      expect(own).not.toBe(42); // not the default a clear would give back
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      typeUnreadableInto("etrto-width");

      if (exit === "another part is picked on the bike") selectOnBike(store, "tire-rear");
      else
        await user.click(
          screen.getByRole("tab", { name: exit.includes("Actions") ? "Actions" : "Pièces" }),
        );
      await settle();

      expect(world.writes).toEqual([]);
      expect(world.stored("tire-front", "etrto-width")).toBe(own);
      expect(world.stored("tire-rear", "etrto-width")).toBe(rear);
      expect(notice.error).toHaveBeenCalledTimes(1);
      const [said, options] = notice.error.mock.calls[0];
      expect(said).toBe(UNSAVED_WIDTH);
      expect(options?.description).toBe(NOT_POSSIBLE);

      // Back on the tyre: its own value, and nothing waiting to be written.
      if (exit === "another part is picked on the bike") selectOnBike(store, "tire-front");
      else {
        await user.click(screen.getByRole("tab", { name: "Pièces" }));
        await user.click(row("tire-front"));
      }
      expect(field("etrto-width").value).toBe(String(own));
      await user.click(field("etrto-width"));
      await user.tab();
      await settle();
      expect(world.writes).toEqual([]);
    },
  );

  it.each(KINDS)(
    "%s bike: a field EMPTIED and then given unreadable text — the value React sees never moves — is not cleared by its removal either",
    async (kind) => {
      // "" (emptied) and "" (emptied, then a minus): one and the same value, so
      // React fires no `change` for the minus. Only the native `input` event
      // says a key was pressed; a record kept by `onChange` alone still read
      // "the visitor cleared the field" (seen in Chromium on the first repair).
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11", distinctBuild("gravel-1x11"));
      const own = world.stored("tire-front", "etrto-width");
      const { user } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "");
      const node = field("etrto-width");
      Object.defineProperty(node, "validity", { configurable: true, value: { badInput: true } });
      fireEvent.input(node);
      expect(node.value).toBe("");

      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();

      expect(world.writes).toEqual([]);
      expect(world.stored("tire-front", "etrto-width")).toBe(own);
      expect(notice.error).toHaveBeenCalledTimes(1);
      expect(notice.error.mock.calls[0][1]?.description).toBe(NOT_POSSIBLE);
    },
  );

  it("unreadable text DELETED again before the field goes — the value still never moves — is a field the visitor emptied: cleared", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    typeUnreadableInto("etrto-width");
    const node = field("etrto-width");
    Object.defineProperty(node, "validity", { configurable: true, value: { badInput: false } });
    fireEvent.input(node);

    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: null }]);
    expect(world.stored("tire-front", "etrto-width")).toBeUndefined();
    expect(notice.error).not.toHaveBeenCalled();
  });

  it("text that can be read again before the field goes is committed as usual: 45. and then 45.5", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    typeUnreadableInto("etrto-width");
    // The next keystroke makes it a number: the browser reports the value again.
    Object.defineProperty(field("etrto-width"), "validity", {
      configurable: true,
      value: { badInput: false },
    });
    fireEvent.change(field("etrto-width"), { target: { value: "45.5" } });

    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45.5 }]);
    expect(world.stored("tire-front", "etrto-width")).toBe(45.5);
    expect(notice.error).not.toHaveBeenCalled();
  });

  it.each(KINDS)(
    "%s bike: a NUMBER field the visitor emptied and did not leave is cleared by its removal, as leaving it clears it",
    async (kind) => {
      // The decision the case above is the exception to: an empty field with
      // nothing unreadable in it is the visitor's own doing.
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind]("gravel-1x11");
      const { user } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "");

      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();

      expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: null }]);
      expect(world.stored("tire-front", "etrto-width")).toBeUndefined();
      expect(notice.error).not.toHaveBeenCalled();
    },
  );
});

describe("what the review found — a value typed while an earlier write of the same field is in flight", () => {
  /**
   * 45 is on its way; the field, mounted again, still shows 42; the visitor
   * types 42 to be sure. Compared with the 42 the form was last told, that is
   * "unchanged" — and a moment later the bike holds 45.
   */
  it("45 typed and the tab pressed, back on the tyre, 42 typed again and the field LEFT: the bike ends at 42, and the field never shows the 45 it is not saving", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true, queued: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" })); // rule 3: 45 is in flight
    await user.click(row("tire-front"));

    // The whole case: the 45 has NOT answered when the 42 is typed and left.
    await typeInto(user, "etrto-width", "42");
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
    await user.tab();
    expect(status("etrto-width")).toBe("Enregistrement…");

    // The 45 answers first. The field goes on showing what it is saving.
    await world.answer!();
    expect(world.stored("tire-front", "etrto-width")).toBe(45);
    expect(field("etrto-width").value).toBe("42");
    expect(status("etrto-width")).toBe("Enregistrement…");

    await world.answer!();
    expect(world.writes).toEqual([
      { partId: "tire-front", key: "etrto-width", value: 45 },
      { partId: "tire-front", key: "etrto-width", value: 42 },
    ]);
    expect(world.stored("tire-front", "etrto-width"), "the last value typed and left").toBe(42);
    expect(field("etrto-width").value).toBe("42");
    expect(status("etrto-width")).toBe("Enregistré");
    expect(notice.error).not.toHaveBeenCalled();
  });

  it("the same with the field LEFT first (an ordinary save in flight), another part picked and the first picked again", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true, queued: true });
    const { user, store } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab(); // the blur's own save, in flight
    selectOnBike(store, "tire-rear");
    selectOnBike(store, "tire-front");
    expect(field("etrto-width").value).toBe("42");
    expect(field("etrto-width")).not.toBeDisabled();

    await typeInto(user, "etrto-width", "42");
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
    await user.tab();
    await world.answer!(2);

    expect(world.writes).toEqual([
      { partId: "tire-front", key: "etrto-width", value: 45 },
      { partId: "tire-front", key: "etrto-width", value: 42 },
    ]);
    expect(world.stored("tire-front", "etrto-width"), "the last value typed and left").toBe(42);
    expect(field("etrto-width").value).toBe("42");
  });

  it("the same with the 42 NOT left: the tab pressed twice, 45 then 42", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true, queued: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "42");
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await world.answer!(2);

    expect(world.writes).toEqual([
      { partId: "tire-front", key: "etrto-width", value: 45 },
      { partId: "tire-front", key: "etrto-width", value: 42 },
    ]);
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
  });

  it("once the earlier write has answered, a value typed back to what is stored is a no-op again", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true, queued: true });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await world.answer!();
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("45");

    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
    expect(status("etrto-width")).toBe("");
  });
});

describe("what the second review found — the write in flight was sent by a workspace that is gone", () => {
  /**
   * The removal's write on a ROUTE change (history back) is still on its way
   * when the visitor comes forward again. The workspace is mounted anew and
   * builds its repo anew, and the page the router kept still says 42. The
   * record of writes in flight was kept per repo OBJECT, so the new form knew
   * nothing of the 45: 42 typed and left was "unchanged", nothing was sent, and
   * the bike ended at 45 (`.debug/017` §5.8, "Second review" — in jsdom, and in
   * Chromium on a saved bike). The record is the BIKE's.
   *
   * What is held here is that the second write is SENT. The two are answered
   * in the order they were sent; after a navigation Next's client has both in
   * transit together, and which the bike ends on is then the order they reach
   * the server in — that note says what was measured of it.
   */
  const leaves = ["the field is LEFT", "the 'Pièces' tab is pressed"] as const;

  it.each(leaves)(
    "45 typed and not left, the route left and come back to — a new workspace, a NEW repo, the same bike — then 42 typed and %s: the 42 is sent, and the bike ends at 42",
    async (leave) => {
      const world = savedWorld("gravel-1x11", undefined, { held: true });
      const before = await open(world);
      await before.user.click(row("tire-front"));
      await typeInto(before.user, "etrto-width", "45");
      before.unmount(); // the route changes: the removal sends 45, which does not answer yet
      expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);

      const back = world.mountedAgain!();
      expect(back.repo).not.toBe(world.repo);
      const { user } = await open(back);
      await user.click(row("tire-front"));
      expect(field("etrto-width").value).toBe("42");
      expect(field("etrto-width")).not.toBeDisabled();

      // The whole case: the 45 has NOT answered when the 42 is typed.
      await typeInto(user, "etrto-width", "42");
      expect(world.stored("tire-front", "etrto-width")).toBe(42);
      if (leave === "the field is LEFT") {
        await user.tab();
        expect(status("etrto-width")).toBe("Enregistrement…");
      } else {
        await user.click(screen.getByRole("tab", { name: "Pièces" }));
      }
      // Sent, with the 45 still unanswered.
      expect(world.writes.map((write) => write.value)).toEqual([45, 42]);
      expect(world.stored("tire-front", "etrto-width")).toBe(42);

      await world.answer!(2);
      expect(world.writes).toEqual([
        { partId: "tire-front", key: "etrto-width", value: 45 },
        { partId: "tire-front", key: "etrto-width", value: 42 },
      ]);
      expect(world.stored("tire-front", "etrto-width"), "the last value typed").toBe(42);
      if (leave === "the field is LEFT") {
        expect(field("etrto-width").value).toBe("42");
        expect(status("etrto-width")).toBe("Enregistré");
      }
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  /**
   * The other half of the same absence. The 45 ANSWERS — while the visitor is
   * away, or just back — and its build is handed to the workspace that sent
   * it, which is gone. Nothing is in flight any more, and the page mounted
   * again still says 42 until Next has fetched it again: for as long as that
   * takes, 42 typed there was "unchanged" too (`.debug/017` §5.8, "Second
   * review": one run of twelve of the reviewer's own probe on the first
   * repair of this, and every run with that fetch held). What a write left
   * stays on record past its answer, and a page that does not say it is not
   * compared with.
   */
  it.each(leaves)(
    "the 45 ANSWERED while nobody was there to be told, the page mounted again still says 42, then 42 typed and %s: the 42 is sent, and the bike ends at 42",
    async (leave) => {
      const world = savedWorld("gravel-1x11", undefined, { held: true });
      const before = await open(world);
      await before.user.click(row("tire-front"));
      await typeInto(before.user, "etrto-width", "45");
      before.unmount();
      await world.answer!(); // the 45 is in the bike; the workspace it answers to is gone
      expect(world.stored("tire-front", "etrto-width")).toBe(45);

      // The page the router kept: it has not been fetched again yet.
      const { user } = await open(world.mountedAgain!());
      await user.click(row("tire-front"));
      expect(field("etrto-width").value).toBe("42");
      await typeInto(user, "etrto-width", "42");
      if (leave === "the field is LEFT") {
        await user.tab();
        expect(status("etrto-width")).toBe("Enregistrement…");
      } else {
        await user.click(screen.getByRole("tab", { name: "Pièces" }));
      }
      expect(world.writes.map((write) => write.value)).toEqual([45, 42]);

      await world.answer!();
      expect(world.stored("tire-front", "etrto-width"), "the last value typed").toBe(42);
      if (leave === "the field is LEFT") {
        expect(field("etrto-width").value).toBe("42");
        expect(status("etrto-width")).toBe("Enregistré");
      }
      expect(notice.error).not.toHaveBeenCalled();
    },
  );

  it("an untouched field of that page is still only visited: the 45 answered, the page says 42, the field entered and left — nothing is sent", async () => {
    // Rule 2's first half does not move: no edit, no write — whatever is on record.
    const world = savedWorld("gravel-1x11", undefined, { held: true });
    const before = await open(world);
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    await world.answer!();

    const { user } = await open(world.mountedAgain!());
    await user.click(row("tire-front"));
    await user.click(field("etrto-width"));
    await user.tab();
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
    expect(world.stored("tire-front", "etrto-width")).toBe(45);
  });

  it("once that write has answered, the new workspace's field is back to rule 2: a value typed back to what is stored is not a write", async () => {
    const world = savedWorld("gravel-1x11", undefined, { held: true });
    const before = await open(world);
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    await world.answer!();
    expect(world.stored("tire-front", "etrto-width")).toBe(45);

    // The page that comes back after the answer says 45.
    const { user } = await open({ ...world.mountedAgain!(), build: withWidth("tire-front", 45) });
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("45");
    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
    expect(status("etrto-width")).toBe("");
  });

  it("a write that did not answer at all is not in flight for ever: back on the bike, a value typed back to what is stored is not a write", async () => {
    const lost = savedWorld("gravel-1x11", undefined, { held: true, down: true });
    const before = await open(lost);
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    await lost.answer!(); // …with an error: the network went
    expect(notice.error).toHaveBeenCalledTimes(1);
    expect(notice.error.mock.calls[0][0]).toBe(UNSAVED_WIDTH);

    // The same bike, reachable again.
    const world = savedWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();

    expect(world.writes).toEqual([]);
    expect(status("etrto-width")).toBe("");
  });

  it("ANOTHER bike's write of the same part and field, still in flight, is not this bike's: a value typed back to what is stored is not a write", async () => {
    // The record is per bike, not per part: the visitor left bike A with 45 on
    // its way and opened bike B — whose front tyre nobody is writing.
    const other = savedWorld("gravel-1x11", undefined, { held: true, bikeId: OTHER_BIKE_ID });
    const before = await open(other);
    await before.user.click(row("tire-front"));
    await typeInto(before.user, "etrto-width", "45");
    before.unmount();
    expect(other.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);

    const world = savedWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "46");
    await typeInto(user, "etrto-width", "42");
    await user.tab();
    await settle();

    expect(world.writes).toEqual([]);
    expect(status("etrto-width")).toBe("");
    await other.answer!();
    expect(other.stored("tire-front", "etrto-width")).toBe(45);
  });
});

describe("what the review found — the form under StrictMode (`npm run dev`)", () => {
  /**
   * React mounts, unmounts and mounts every effect again on the same instance.
   * A form that did not put its "am I on screen" flag back up would raise
   * every refusal as a notice — under a field that is right there — and keep a
   * thrown write from the route's `error.tsx`.
   */
  it("visiting a form writes nothing; a typed value is written once when the tab is pressed; a refusal is said under its field, not in a notice", async () => {
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world, "fr", { strict: true });
    await user.click(row("tire-front"));
    await user.click(field("etrto-width"));
    await user.tab();
    await settle();
    expect(world.writes).toEqual([]);

    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();
    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);

    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "999");
    await user.tab();
    await settle();
    expect(status("etrto-width")).toBe(NOT_POSSIBLE);
    expect(notice.error).not.toHaveBeenCalled();
  });

  it("a write that does not answer while its form is on screen still ends in the route's error page", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const world = savedWorld("gravel-1x11", undefined, { down: true });
    const { user } = await open(world, "fr", { strict: true });
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();

    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    expect(notice.error).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("what the review found — a refusal that is not about the field", () => {
  const STORAGE_FULL =
    "Impossible d’enregistrer sur cet appareil : l’espace de stockage du navigateur est plein.";

  it("a guest bike whose storage is full is told THAT — under the field while it is there, in the notice once it is not", async () => {
    // The one failure a guest can act on. It used to read "Cette opération
    // entre en conflit avec des données existantes.": the repo answers
    // `fieldErrors.form`, and only the field's own key was looked up.
    const world = guestWorld("gravel-1x11");
    const { user } = await open(world);
    await user.click(row("tire-front"));
    world.fill!();

    await typeInto(user, "etrto-width", "45");
    await user.tab();
    await settle();
    expect(status("etrto-width")).toBe(STORAGE_FULL);
    expect(notice.error).not.toHaveBeenCalled();

    await typeInto(user, "etrto-width", "46");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await settle();
    expect(notice.error).toHaveBeenCalledTimes(1);
    const [said, options] = notice.error.mock.calls[0];
    expect(said).toBe(UNSAVED_WIDTH);
    expect(options?.description).toBe(STORAGE_FULL);
    expect(world.stored("tire-front", "etrto-width")).toBe(42);
  });

  it.each([
    ["UNAUTHORIZED", "Vous devez être connecté pour faire cela."],
    ["NOT_FOUND", "Introuvable."],
    ["RATE_LIMITED", "Trop de tentatives. Réessayez dans un instant."],
  ] as const)(
    "a late write refused %s has that reason for a description, in words",
    async (code, reason) => {
      const world = savedWorld("gravel-1x11", undefined, { refuse: code });
      const { user } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      await user.click(screen.getByRole("tab", { name: "Pièces" }));
      await settle();

      expect(notice.error).toHaveBeenCalledTimes(1);
      expect(notice.error.mock.calls[0][1]?.description).toBe(reason);
    },
  );
});

describe("what the review found — a select's or a checkbox's status is not carried to the next part either", () => {
  /**
   * They are controlled, so they never SHOWED another part's value — but their
   * "Enregistré" lived in the same per-key map as a typed field's. One pair
   * per shared key, enumerated from the catalogue.
   */
  const pairs = sharedUntypedPairs();

  it("covers every select and checkbox key two parts of a preset share", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(32);
    expect(pairs.map((pair) => pair.key)).toEqual(
      expect.arrayContaining(["tread", "etrto-diameter", "tubeless-ready", "lockout", "valve"]),
    );
    for (const pair of pairs) expect(isTyped(pair.from.attribute)).toBe(false);
  });

  it.each(
    pairs.flatMap((pair) =>
      KINDS.map((kind) => [pair.key, pair.from.partId, pair.to.partId, kind, pair] as const),
    ),
  )(
    "%s changed for %s, then %s picked on the bike — %s bike",
    async (key, from, to, kind, pair) => {
      // eslint-disable-next-line security/detect-object-injection -- "guest" | "saved"
      const world = WORLDS[kind](pair.preset);
      const { user, store } = await open(world);
      await user.click(row(from));

      const control = field(key);
      if (pair.from.attribute.kind === "boolean") {
        await user.click(control);
      } else {
        const other = (pair.from.attribute.values ?? []).find(
          (option) => option !== pair.from.value,
        );
        if (other === undefined) throw new Error(`${key} has no second option`);
        await user.selectOptions(control, String(other));
      }
      await settle();
      // "Enregistré", or the domain's refusal of that option: a status either way.
      expect(status(key), `${from}.${key} says how its change went`).not.toBe("");
      expect(world.writes).toHaveLength(1);
      expect(world.writes[0]).toMatchObject({ partId: from, key });
      const theirs = world.stored(to, key);

      selectOnBike(store, to);
      expect(field(key).id).toBe(`attr-${to}-${key}`);
      expect(status(key), `${to}.${key}: the status of ${from}'s`).toBe("");
      expect(shown(field(key))).toBe(asShown(pair.to.attribute.kind, theirs));
      expect(field(key)).not.toBeDisabled();

      // Visiting the other part's form sends nothing.
      for (const visited of form()!.querySelectorAll("[data-attr]")) {
        fireEvent.focus(visited);
        fireEvent.blur(visited);
      }
      await settle();
      expect(world.writes).toHaveLength(1);
      expect(world.stored(to, key)).toBe(theirs);
    },
  );
});
