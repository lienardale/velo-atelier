/**
 * The checkup's verdicts, as the 3D viewer tints them (§6.4 `status`).
 *
 * `BikePartState.status` is what a finished checkup left on a saved bike;
 * `PartStatus` is what the viewer understands. The mapping is deliberately
 * lossy in one direction only: `UNKNOWN` produces NO entry rather than a
 * `todo` tint, because a bike that has never been checked would otherwise come
 * up entirely orange, and "nothing is known" is not a finding.
 *
 * `ATTENTION` and `BROKEN` both read as `ko`: the viewer has two colours for a
 * verdict, and a part that needs attention is a part the checkup wants the
 * visitor to look at.
 */
import type { PartStatusValue } from "@/lib/bike/load-bike";
import type { PartStatus } from "@/lib/bike3d/types";
import { isPartId, type PartId } from "@/lib/domain/data/parts";

/** The tint for one stored status, or `null` when there is nothing to say. */
export function toneOf(status: PartStatusValue): PartStatus | null {
  if (status === "OK") return "ok";
  if (status === "UNKNOWN") return null;
  return "ko";
}

/** `BikeWorkspace`'s `statuses` prop, as `BikeViewer`'s `status` prop. */
export function viewerStatus(
  statuses: Partial<Record<string, PartStatusValue>> | undefined,
): Partial<Record<PartId, PartStatus>> | undefined {
  if (statuses === undefined) return undefined;
  const tinted: Partial<Record<PartId, PartStatus>> = {};
  let any = false;
  for (const [partId, status] of Object.entries(statuses)) {
    if (status === undefined || !isPartId(partId)) continue;
    const tone = toneOf(status);
    if (tone === null) continue;
    // eslint-disable-next-line security/detect-object-injection -- `partId` passed isPartId
    tinted[partId] = tone;
    any = true;
  }
  return any ? tinted : undefined;
}
