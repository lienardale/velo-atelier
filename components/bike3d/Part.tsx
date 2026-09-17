/**
 * `Part` — the clickable `<group>` every rendered part lives in — and the two
 * mesh primitives the declarative `parts/*` components compose.
 *
 *   <group name={partId} userData={{ partId, system }}>   tap-vs-drag: e.delta ≤ 8
 *     <PartMesh …/>      one merged geometry = one draw call; material by precedence;
 *                        <Outlines> only on the selected part at the high tier
 *     <SpokeMesh …/>     one InstancedMesh, never outlined
 *
 * Geometry is built with `useDisposable`, keyed on the plan hash and the
 * geometry tier, so a spec change rebuilds only what changed and frees the old
 * buffers (§3.4: `gl.info.memory.geometries` returns to baseline).
 */
"use client";

import { Outlines } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { InstancedMesh } from "three";

import { frameGeometry } from "@/lib/bike3d/builders/frame";
import { geometryTierFor } from "@/lib/bike3d/builders/lod";
import { spokeGeometry, spokeMatrices } from "@/lib/bike3d/builders/wheel";
import { resolveMaterialKey } from "@/lib/bike3d/highlight";
import { materialFor } from "@/lib/bike3d/materials";
import { outlinesFor } from "@/lib/bike3d/quality";
import type { MeshDescriptor, ScenePart, SpokeDescriptor } from "@/lib/bike3d/types";
import type { PartId } from "@/lib/domain/data/parts";

import { outlineTargetOf, useViewerStore, useViewerStoreApi } from "./store";
import { useDisposable } from "./use-disposable";

/** Pointer travel (px) above which a press is a camera drag, not a tap. */
export const TAP_MAX_DELTA = 8;

export interface PartProps {
  part: ScenePart;
  hash: string;
}

export function Part({
  part,
  children,
}: {
  part: ScenePart;
  children: ReactNode;
}): React.JSX.Element {
  const { api } = useViewerStoreApi();
  const { partId, system } = part;

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > TAP_MAX_DELTA) return;
    event.stopPropagation();
    api.getState().activate(partId, "canvas");
  };
  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    api.getState().hover(partId);
  };
  const onPointerOut = () => {
    if (api.getState().hoveredPartId === partId) api.getState().hover(null);
  };

  return (
    <group
      name={partId}
      userData={{ partId, system }}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {children}
    </group>
  );
}

export function PartMesh({
  partId,
  descriptor,
  hash,
}: {
  partId: PartId;
  descriptor: MeshDescriptor;
  hash: string;
}): React.JSX.Element {
  const quality = useViewerStore((state) => state.quality);
  const tier = geometryTierFor(quality);
  // The descriptor is derived from the plan hash; its key separates meshes of one part.
  const geometry = useDisposable(
    () => frameGeometry(descriptor, tier),
    `${hash}:${descriptor.key}:${tier}`,
  );
  const materialKey = useViewerStore((state) =>
    resolveMaterialKey(descriptor.material, partId, state),
  );
  const outlined = useViewerStore(
    (state) => outlinesFor(state.quality) && outlineTargetOf(state.selectedPartId) === partId,
  );

  return (
    <mesh
      name={descriptor.key}
      geometry={geometry}
      material={materialFor(materialKey)}
      userData={{ partId, materialKey }}
    >
      {outlined ? <Outlines thickness={0.0035} color="#ffffff" /> : null}
    </mesh>
  );
}

export function SpokeMesh({
  partId,
  descriptor,
  hash,
}: {
  partId: PartId;
  descriptor: SpokeDescriptor;
  hash: string;
}): React.JSX.Element {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useDisposable(() => spokeGeometry(), "spoke");
  const matricesKey = `${hash}:${descriptor.key}`;
  // `descriptor` is derived from the plan hash, which the key encodes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matrices = useMemo(() => spokeMatrices(descriptor), [matricesKey]);
  const materialKey = useViewerStore((state) =>
    resolveMaterialKey(descriptor.material, partId, state),
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  return (
    <instancedMesh
      ref={ref}
      name={descriptor.key}
      args={[geometry, materialFor(materialKey), descriptor.count]}
      material={materialFor(materialKey)}
      userData={{ partId, materialKey }}
    />
  );
}

/** Every mesh of a part — what the declarative `parts/*` components render. */
export function PartMeshes({ part, hash }: PartProps): React.JSX.Element {
  return (
    <Part part={part}>
      {part.meshes.map((descriptor) => (
        <PartMesh key={descriptor.key} partId={part.partId} descriptor={descriptor} hash={hash} />
      ))}
      {part.spokes.map((descriptor) => (
        <SpokeMesh key={descriptor.key} partId={part.partId} descriptor={descriptor} hash={hash} />
      ))}
    </Part>
  );
}
