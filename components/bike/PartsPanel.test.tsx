import { act, fireEvent, screen } from "@testing-library/react";
import { Component, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createViewerStore,
  ViewerStoreProvider,
  type ViewerStore,
} from "@/components/bike3d/store";
import { fail, ok } from "@/lib/actions/result";
import { readLocalBike, writeLocalBike, type KeyValueStorage } from "@/lib/bike/local-bike";
import { bikeRepoFor, localBikeRepo, type BikeRepo } from "@/lib/bike/repo";
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
 */

const notice = vi.hoisted(() => ({
  error: vi.fn<(title: string, options?: { description?: string; duration?: number }) => void>(),
}));
vi.mock("sonner", () => ({ toast: { error: notice.error } }));

class MemoryStorage implements KeyValueStorage {
  private value: string | null = null;
  getItem(): string | null {
    return this.value;
  }
  setItem(_key: string, value: string): void {
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
  repo: BikeRepo;
  build: BikeBuild;
  writes: Write[];
  /** The truth: what the destination holds, whatever the page shows. */
  stored(partId: string, key: string): AttributeValue | undefined;
}

function recording(inner: BikeRepo, writes: Write[]): BikeRepo {
  return {
    kind: inner.kind,
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
    repo: recording(localBikeRepo({ storage }), writes),
    build,
    writes,
    stored: (partId, key) => {
      const bike = readLocalBike(storage);
      if (bike === null) throw new Error("the guest bike is gone");
      return attributeOf({ spec: bike.spec, parts: bike.parts }, partId, key);
    },
  };
}

const BIKE_ID = "3f0c1f0e-6f0a-4c56-9d3b-1c2d3e4f5a6b";

/**
 * A saved bike: the real `remoteBikeRepo`, over an action that keeps the build
 * and answers as `updateBikePartAction` does — the domain's own `setAttribute`,
 * the refusal keyed by the field. `latencyMs` is how long it takes to answer,
 * which is what lets an answer arrive after its form is gone; `down` makes it
 * not answer at all.
 */
function savedWorld(
  preset: PresetId,
  build: BikeBuild = presetBuild(preset),
  { latencyMs = 0, down = false }: { latencyMs?: number; down?: boolean } = {},
): World {
  let server = build;
  const writes: Write[] = [];
  const repo = bikeRepoFor("db", {
    bikeId: BIKE_ID,
    actions: {
      async updatePart(input) {
        if (input.bikeId !== BIKE_ID) return fail("NOT_FOUND");
        for (const [key, value] of Object.entries(input.attributes)) {
          writes.push({ partId: input.partId, key, value });
        }
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        if (down) throw new Error("the action did not answer");
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
      },
      updateFit: async () => fail("NOT_FOUND"),
    },
  });
  return {
    kind: "saved",
    repo,
    build,
    writes,
    stored: (partId, key) => attributeOf(server, partId, key),
  };
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
      bikeParam={world.kind === "guest" ? "local" : BIKE_ID}
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

async function open(world: World, locale: Locale = "fr") {
  const store: ViewerStore = createViewerStore({
    availablePartIds: world.build.parts.map((part) => part.partId as PartId),
  });
  const view = await renderWithIntl(
    <ViewerStoreProvider store={store}>
      <Boundary>
        <Harness world={world} />
      </Boundary>
    </ViewerStoreProvider>,
    { locale },
  );
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

beforeEach(() => {
  notice.error.mockClear();
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
    const world = savedWorld("gravel-1x11", undefined, { latencyMs: 60 });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await user.click(row("tire-front"));
    expect(field("etrto-width").value).toBe("42");
    expect(world.stored("tire-front", "etrto-width")).toBe(42);

    await settle(120);

    expect(world.stored("tire-front", "etrto-width")).toBe(45);
    expect(field("etrto-width").value).toBe("45");
    expect(document.querySelector('[data-attr-row="etrto-width"] dd')).toHaveTextContent("45 mm");
    await user.click(field("etrto-width"));
    await user.tab();
    await settle(120);
    expect(world.writes).toEqual([{ partId: "tire-front", key: "etrto-width", value: 45 }]);
  });

  it("does not replace what the visitor is typing when the stored value changes under the field", async () => {
    const world = savedWorld("gravel-1x11", undefined, { latencyMs: 60 });
    const { user } = await open(world);
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "45");
    await user.click(screen.getByRole("tab", { name: "Pièces" }));
    await user.click(row("tire-front"));
    await typeInto(user, "etrto-width", "50"); // typed while 45 is still in flight

    await settle(120);
    expect(world.stored("tire-front", "etrto-width")).toBe(45);
    expect(field("etrto-width").value).toBe("50");

    await user.tab();
    await settle(120);
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
      const world = savedWorld("gravel-1x11", undefined, { latencyMs: 60 });
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "999");
      await user.tab();
      expect(status("etrto-width")).toBe("Enregistrement…");

      selectOnBike(store, "tire-rear");
      await settle(120);

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
      const world = savedWorld("gravel-1x11", undefined, { latencyMs: 60, down: true });
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      await user.tab();

      selectOnBike(store, "tire-rear");
      await settle(120);

      expect(screen.queryByTestId("error-boundary")).toBeNull();
      expect(title()).toBe("Pneu arrière");
      expect(notice.error).toHaveBeenCalledTimes(1);
      const [said, options] = notice.error.mock.calls[0];
      expect(said).toBe("Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.");
      expect(options?.description).toBeUndefined();
    });

    it("says nothing when such a write succeeds: the build is handed up, and the part shows it", async () => {
      const world = savedWorld("gravel-1x11", undefined, { latencyMs: 60 });
      const { user, store } = await open(world);
      await user.click(row("tire-front"));
      await typeInto(user, "etrto-width", "45");
      await user.tab();

      selectOnBike(store, "tire-rear");
      await settle(120);
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
    const world = savedWorld("gravel-1x11", undefined, { latencyMs: 60 });
    const { user } = await open(world);
    await user.click(row("tire-front"));

    await typeInto(user, "etrto-width", "45");
    await user.tab();
    expect(status("etrto-width")).toBe("Enregistrement…");
    expect(field("etrto-width")).toBeDisabled();
    await settle(120);
    expect(status("etrto-width")).toBe("Enregistré");
    expect(field("etrto-width")).not.toBeDisabled();
    expect(field("etrto-width").value).toBe("45");
  });
});
