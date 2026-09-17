/**
 * The public prop API of `BikeViewer` (§3.3) — what W2-T3's `BikeWorkspace`
 * and every other host builds on. Documented in `docs/bike3d.md`.
 */
import type { ReactNode } from "react";

import type { PartStatus, QualityTier, SelectSource, ViewerMode } from "@/lib/bike3d/types";
import type { BikeBuild, BikeSpec } from "@/lib/domain";
import type { PartId } from "@/lib/domain/data/parts";
import type { Locale } from "@/lib/i18n/routing";

export interface BikeViewerProps {
  spec: BikeSpec;
  build: BikeBuild;
  locale: Locale;
  /** `pick` = multi-select for a partial checkup. Default `browse`. */
  mode?: ViewerMode;
  /** From server-read `searchParams`, validated with `lib/bike3d/query.ts`. */
  initialPartId?: PartId | null;
  initialPickedIds?: PartId[];
  onSelect?(id: PartId | null, source: SelectSource): void;
  onPickedChange?(ids: ReadonlySet<PartId>): void;
  /** Tints parts after a checkup (a hosted part tints its host). */
  status?: Partial<Record<PartId, PartStatus>>;
  /** Side panel slot owned by the host (§6). Receives the selected part id. */
  renderPanel?(id: PartId | null): ReactNode;
  /** Mounts PerfProbe (only in a NEXT_PUBLIC_TEST_HOOKS=1 build); only dev pages pass it. */
  probe?: boolean;
  /**
   * Saddle height for the solver (`Bike.fit`, §4). Optional; the geometry
   * row's default otherwise.
   */
  fit?: { saddleHeightMm?: number } | null;
  /** Forces the starting tier (dev and perf pages). Default: capabilities + persisted tier. */
  initialQuality?: QualityTier | null;
  className?: string;
}
