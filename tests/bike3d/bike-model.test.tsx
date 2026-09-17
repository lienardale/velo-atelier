/**
 * `BikeModel` under `@react-three/test-renderer` (§3.5, §3.6 AC2): no WebGL
 * context, the real scene graph.
 */
import ReactThreeTestRenderer from "@react-three/test-renderer";
import type { ReactNode } from "react";
import { act } from "react";
import type { Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";

import { BikeModel } from "@/components/bike3d/BikeModel";
import {
  createViewerStore,
  ViewerStoreProvider,
  type ViewerStore,
} from "@/components/bike3d/store";
import { presetBuild } from "@/lib/bike3d/builds";
import { resetMaterials } from "@/lib/bike3d/materials";
import { planScene } from "@/lib/bike3d/scene";
import { PRESET_IDS, type BikeBuild } from "@/lib/domain";
import { isPartId, RENDERED_PART_IDS, type PartId } from "@/lib/domain/data/parts";

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
type TestInstance = Renderer["scene"];

function storeFor(
  build: BikeBuild,
  patch: Partial<Parameters<typeof createViewerStore>[0]> = {},
): ViewerStore {
  return createViewerStore({
    availablePartIds: build.parts.map((p) => p.partId).filter(isPartId),
    quality: "high",
    ...patch,
  });
}

function wrap(store: ViewerStore, children: ReactNode) {
  return <ViewerStoreProvider store={store}>{children}</ViewerStoreProvider>;
}

/** Every `<group>` that carries a partId (one per rendered part). */
function partGroups(renderer: Renderer): TestInstance[] {
  return renderer.scene.findAll(
    (node) => node.type === "Group" && typeof node.instance.userData?.partId === "string",
  );
}

function groupOf(renderer: Renderer, partId: PartId): TestInstance {
  return renderer.scene.find(
    (node) => node.type === "Group" && node.instance.userData?.partId === partId,
  );
}

function meshesOf(renderer: Renderer, partId: PartId): Mesh[] {
  return renderer.scene
    .findAll((node) => node.type === "Mesh" && node.instance.userData?.partId === partId)
    .map((node) => node.instance as Mesh);
}

const click = (delta: number) => ({ delta, stopPropagation: () => {} });

afterEach(() => resetMaterials());

describe("BikeModel", () => {
  it.each(PRESET_IDS)("%s contains each rendered part of the spec exactly once", async (id) => {
    const build = presetBuild(id);
    const plan = planScene(build);
    const renderer = await ReactThreeTestRenderer.create(
      wrap(storeFor(build), <BikeModel plan={plan} />),
    );

    const ids = partGroups(renderer).map((node) => node.instance.userData.partId as string);
    const expected = build.parts
      .map((p) => p.partId)
      .filter((partId) => RENDERED_PART_IDS.includes(partId as PartId));
    expect(ids.sort()).toEqual([...expected].sort());

    const spec = build.spec;
    const has = (partId: string) => ids.includes(partId);
    expect(has("rotor-front")).toBe(spec.brakes.isDisc);
    expect(has("front-derailleur")).toBe(spec.drivetrain.chainrings >= 2);
    expect(has("rear-shock")).toBe(spec.suspension.rear);
    expect(has("e-motor")).toBe(spec.eSystem !== null);
    expect(has("e-battery")).toBe(spec.eSystem !== null);
    // The dropper is drawn on the seatpost: its extra tube is in the merged geometry.
    const seatpost = meshesOf(renderer, "seatpost")[0]!;
    expect(seatpost.geometry.getAttribute("position").count).toBeGreaterThan(0);
    await renderer.unmount();
  });

  it("draws spokes as ONE instanced mesh of 32 per wheel", async () => {
    const build = presetBuild("gravel-1x11");
    const renderer = await ReactThreeTestRenderer.create(
      wrap(storeFor(build), <BikeModel plan={planScene(build)} />),
    );
    const spokes = renderer.scene.findAll(
      (node) => (node.instance as { isInstancedMesh?: boolean }).isInstancedMesh === true,
    );
    expect(spokes).toHaveLength(2);
    expect(spokes.map((node) => (node.instance as { count: number }).count)).toEqual([32, 32]);
    await renderer.unmount();
  });

  it("a tap selects; a drag does not", async () => {
    const build = presetBuild("gravel-1x11");
    const store = storeFor(build);
    const renderer = await ReactThreeTestRenderer.create(
      wrap(store, <BikeModel plan={planScene(build)} />),
    );

    await renderer.fireEvent(groupOf(renderer, "saddle"), "click", click(0));
    expect(store.api.getState()).toMatchObject({ selectedPartId: "saddle", lastSource: "canvas" });

    await renderer.fireEvent(groupOf(renderer, "chain"), "click", click(30));
    expect(store.api.getState().selectedPartId).toBe("saddle");
    expect(meshesOf(renderer, "saddle")[0]!.material).toMatchObject({ name: "highlightSelected" });
    await renderer.unmount();
  });

  it("outlines the selected part at the high tier only", async () => {
    const build = presetBuild("gravel-1x11");
    const store = storeFor(build, { selectedPartId: "saddle" });
    const renderer = await ReactThreeTestRenderer.create(
      wrap(store, <BikeModel plan={planScene(build)} />),
    );
    const outlineCount = () =>
      renderer.scene.findAll((node) => node.type === "Group" && node.parent?.type === "Mesh")
        .length;
    expect(outlineCount()).toBe(1);
    await act(async () => store.api.getState().setQuality("med"));
    expect(outlineCount()).toBe(0);
    await renderer.unmount();
  });

  it("hover swaps the material and a hosted selection lights its host", async () => {
    const build = presetBuild("road-disc-2x12");
    const store = storeFor(build);
    const renderer = await ReactThreeTestRenderer.create(
      wrap(store, <BikeModel plan={planScene(build)} />),
    );

    await renderer.fireEvent(groupOf(renderer, "frame"), "pointerOver", click(0));
    expect(meshesOf(renderer, "frame")[0]!.material).toMatchObject({ name: "highlightHover" });
    await renderer.fireEvent(groupOf(renderer, "frame"), "pointerOut", click(0));
    expect(meshesOf(renderer, "frame")[0]!.material).toMatchObject({ name: "paint" });
    // pointerOut from a part that is not hovered leaves the hover alone.
    await act(async () => store.api.getState().hover("saddle"));
    await renderer.fireEvent(groupOf(renderer, "frame"), "pointerOut", click(0));
    expect(store.api.getState().hoveredPartId).toBe("saddle");

    await act(async () => store.api.getState().select("brake-pads-front", { source: "list" }));
    expect(meshesOf(renderer, "brake-caliper-front")[0]!.material).toMatchObject({
      name: "highlightSelected",
    });
    await renderer.unmount();
  });

  it("pick mode toggles picks on tap", async () => {
    const build = presetBuild("gravel-1x11");
    const store = storeFor(build, { mode: "pick" });
    const renderer = await ReactThreeTestRenderer.create(
      wrap(store, <BikeModel plan={planScene(build)} />),
    );
    await renderer.fireEvent(groupOf(renderer, "chain"), "click", click(0));
    await renderer.fireEvent(groupOf(renderer, "saddle"), "click", click(0));
    expect([...store.api.getState().pickedPartIds]).toEqual(["chain", "saddle"]);
    await renderer.fireEvent(groupOf(renderer, "chain"), "click", click(2));
    expect([...store.api.getState().pickedPartIds]).toEqual(["saddle"]);
    await act(async () => store.api.getState().select(null, { source: "list" }));
    expect(meshesOf(renderer, "saddle")[0]!.material).toMatchObject({ name: "highlightPicked" });
    await renderer.unmount();
  });

  it("status swaps the material (a hosted KO tints its host)", async () => {
    const build = presetBuild("road-disc-2x12");
    const store = storeFor(build, { status: { chain: "ok", "brake-pads-rear": "ko" } });
    const renderer = await ReactThreeTestRenderer.create(
      wrap(store, <BikeModel plan={planScene(build)} />),
    );
    expect(meshesOf(renderer, "chain")[0]!.material).toMatchObject({ name: "statusOk" });
    expect(meshesOf(renderer, "brake-caliper-rear")[0]!.material).toMatchObject({
      name: "statusKo",
    });
    expect(meshesOf(renderer, "saddle")[0]!.material).toMatchObject({ name: "rubber" });
    await renderer.unmount();
  });

  it("keeps geometry stable across updates and rebuilds (and frees) it on a spec change", async () => {
    const gravel = presetBuild("gravel-1x11");
    const store = storeFor(gravel);
    const renderer = await ReactThreeTestRenderer.create(
      wrap(store, <BikeModel plan={planScene(gravel)} />),
    );
    const before = meshesOf(renderer, "frame")[0]!.geometry;
    const count = renderer.scene.findAll((node) => node.type === "Mesh").length;

    await renderer.update(wrap(store, <BikeModel plan={planScene(presetBuild("gravel-1x11"))} />));
    expect(meshesOf(renderer, "frame")[0]!.geometry).toBe(before);
    expect(renderer.scene.findAll((node) => node.type === "Mesh")).toHaveLength(count);

    let disposed = false;
    before.addEventListener("dispose", () => {
      disposed = true;
    });
    const road = presetBuild("road-rim-2x11");
    await renderer.update(wrap(store, <BikeModel plan={planScene(road)} />));
    expect(meshesOf(renderer, "frame")[0]!.geometry).not.toBe(before);
    expect(disposed).toBe(true);

    // Tier change rebuilds too.
    const high = meshesOf(renderer, "frame")[0]!.geometry;
    await act(async () => store.api.getState().setQuality("low"));
    expect(meshesOf(renderer, "frame")[0]!.geometry).not.toBe(high);
    await renderer.unmount();
  });
});
