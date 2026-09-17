/**
 * Which material a mesh wears (pure — the three.js singletons live in
 * `materials.ts`, loaded only by the lazy scene).
 *
 * Precedence (§3.3): hover > selected > status > picked > base.
 *
 * A hosted part (pads, tube, chainring…) has no mesh of its own, so its
 * selection, pick and checkup status show on its host: a KO on the front pads
 * tints the front caliper.
 */
import { clickTargetOf, isPartId, type PartId } from "@/lib/domain/data/parts";

import type { BaseMaterialKey, MaterialKey, PartStatus } from "./types";

export interface HighlightState {
  hoveredPartId: PartId | null;
  selectedPartId: PartId | null;
  pickedPartIds: ReadonlySet<PartId>;
  status: Partial<Record<PartId, PartStatus>> | undefined;
}

/** The mesh-bearing part a (possibly hosted) id lights up. */
export function highlightTarget(id: PartId | null): PartId | null {
  return id === null ? null : clickTargetOf(id);
}

/** Worst status among a mesh part and the parts it hosts: ko > ok; todo is no tint. */
export function meshStatus(
  meshPartId: PartId,
  status: Partial<Record<PartId, PartStatus>> | undefined,
): "ok" | "ko" | null {
  if (!status) return null;
  let result: "ok" | "ko" | null = null;
  for (const [id, value] of Object.entries(status)) {
    if (!isPartId(id) || clickTargetOf(id) !== meshPartId) continue;
    if (value === "ko") return "ko";
    if (value === "ok") result = "ok";
  }
  return result;
}

export function isPickedMesh(meshPartId: PartId, picked: ReadonlySet<PartId>): boolean {
  for (const id of picked) if (clickTargetOf(id) === meshPartId) return true;
  return false;
}

export function resolveMaterialKey(
  base: BaseMaterialKey,
  meshPartId: PartId,
  state: HighlightState,
): MaterialKey {
  if (highlightTarget(state.hoveredPartId) === meshPartId) return "highlightHover";
  if (highlightTarget(state.selectedPartId) === meshPartId) return "highlightSelected";
  const status = meshStatus(meshPartId, state.status);
  if (status === "ko") return "statusKo";
  if (status === "ok") return "statusOk";
  if (isPickedMesh(meshPartId, state.pickedPartIds)) return "highlightPicked";
  return base;
}
