/**
 * The plan the SERVER computes for a build (§4.4, §5.4).
 *
 * `planCheckup` is pure and takes the guides as an argument; this is the one
 * place that says WHICH guides a server-side write is planned against, so the
 * two things that persist a checkup cannot drift apart:
 *
 *   - `saveCheckupAction` / `finishCheckupAction`
 *     (`app/[locale]/velo/[id]/controle/actions.ts`), for a saved bike;
 *   - `importGuestStateAction` (`app/[locale]/(protected)/import/actions.ts`),
 *     which hands this function to `importGuestState` for a checkup that was
 *     answered in a browser.
 *
 * The French corpus, always: both locales carry the same steps, and a plan's
 * keys are locale-independent, so the plan a bike gets does not depend on the
 * language its owner reads it in. (The checkup PAGE plans with the visitor's
 * own locale, because it also needs the titles; the keys are the same.)
 *
 * Server-side only: it reaches the compiled corpus through
 * `lib/content/collection.ts`.
 */
import { planCheckup, type PlannableGuide } from "@/lib/checkup/plan";
import type { CheckStepRef, CheckupScope } from "@/lib/checkup/types";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { routing } from "@/lib/i18n/routing";

import { GUIDES } from "./collection";

/** The questions `build` gets asked for `scope`, against the corpus on disk. */
export function planForBuild(build: BikeBuild, scope: CheckupScope): CheckStepRef[] {
  const guides = GUIDES.filter(
    (guide) => guide.locale === routing.defaultLocale,
  ) as unknown as PlannableGuide[];
  return planCheckup(build, scope, guides);
}
