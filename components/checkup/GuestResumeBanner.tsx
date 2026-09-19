"use client";

import { ResumeBanner } from "@/components/bike/ResumeBanner";
import { answeredCount } from "@/lib/checkup/storage";
import type { BikeRefKind } from "@/lib/bike/resolve-bike-ref";

import { STORED_CHECKUP_PENDING, useStoredCheckup } from "./use-stored-checkup";

/**
 * "You left a checkup unfinished" — for the two bikes that live in the browser.
 *
 * A saved bike's unfinished checkup is a row, read by `loadBikeForRequest` and
 * handed to `BikeWorkspace` as a prop. `demo` and `local` have no row: the only
 * copy is `va:checkup:<ref>`, which the server cannot see and this component
 * reads after hydration. Hence one small client component rather than a prop —
 * `/velo/demo` has to stay a server render that reads nothing about the request
 * (§6.2), and a banner that appears a frame later is a better trade than a
 * dynamic page.
 *
 * A COMPLETED checkup is not resumable: finishing one is exactly what makes the
 * banner disappear (§6.8 AC6). Neither is one with no answers yet — opening the
 * page and leaving is not something to come back to.
 */
export interface GuestResumeBannerProps {
  refKind: BikeRefKind;
  bikeParam: string;
  specCode?: string | null;
}

export function GuestResumeBanner({
  refKind,
  bikeParam,
  specCode,
}: GuestResumeBannerProps): React.JSX.Element | null {
  const stored = useStoredCheckup(refKind === "db" ? null : refKind);

  if (stored === STORED_CHECKUP_PENDING || stored === null) return null;
  if (stored.completedAt !== undefined) return null;
  const answered = answeredCount(stored);
  if (answered === 0) return null;

  return (
    <ResumeBanner
      bikeParam={bikeParam}
      startedAt={stored.startedAt}
      scope={stored.scope.kind === "full" ? "FULL" : "PARTIAL"}
      answered={answered}
      specCode={specCode}
    />
  );
}
