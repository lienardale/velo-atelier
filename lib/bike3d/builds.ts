/**
 * Sample builds for tests and `npm run geom:report`: presets and the enumerated spec space the
 * solver invariants run over (§3.5). Plain Node, zod-free.
 */
import {
  answerWithDefaults,
  BIKE_PRESETS,
  buildBikeSpec,
  isNodeVisible,
  nodeFor,
  PRESET_IDS,
  visibleOptions,
  type Answers,
  type BikeBuild,
  type PresetId,
} from "@/lib/domain";
import { buildForSpec } from "@/lib/domain/engine/parts-for-spec";

import { hashOf } from "./hash";

export function presetBuild(id: PresetId): BikeBuild {
  return buildForSpec(buildBikeSpec(answerWithDefaults(BIKE_PRESETS[id])));
}

export function buildFromAnswers(answers: Answers): BikeBuild {
  return buildForSpec(buildBikeSpec(answerWithDefaults(answers)));
}

export const PRESET_BUILDS: ReadonlyArray<[PresetId, BikeBuild]> = PRESET_IDS.map((id) => [
  id,
  presetBuild(id),
]);

/** Every option of `question` visible after `answers`. */
function optionsOf(question: Parameters<typeof nodeFor>[0], answers: Answers): string[] {
  return visibleOptions(nodeFor(question), answers).map((option) => option.id);
}

/**
 * The enumerated spec space: every discipline × visible wheel size × drive ×
 * brake type × drivetrain × visible suspension × cockpit, defaults elsewhere,
 * deduplicated by spec. A few thousand builds.
 */
export function enumerateBuilds(): BikeBuild[] {
  const seen = new Set<string>();
  const builds: BikeBuild[] = [];
  const push = (answers: Answers) => {
    const build = buildFromAnswers(answers);
    const key = hashOf(build.spec);
    if (seen.has(key)) return;
    seen.add(key);
    builds.push(build);
  };
  for (const discipline of optionsOf("discipline", {})) {
    for (const wheel of optionsOf("wheel-size", { discipline })) {
      for (const drive of optionsOf("drive", {})) {
        for (const brake of optionsOf("brake-type", { discipline, drive })) {
          for (const drivetrain of optionsOf("drivetrain", { discipline, drive })) {
            const base: Answers = {
              discipline,
              "wheel-size": wheel,
              drive,
              "brake-type": brake,
              drivetrain,
            };
            const suspensions = isNodeVisible(nodeFor("suspension"), base)
              ? optionsOf("suspension", base)
              : [undefined];
            for (const suspension of suspensions) {
              for (const cockpit of optionsOf("cockpit", base)) {
                push({ ...base, cockpit, ...(suspension ? { suspension } : {}) });
              }
            }
          }
        }
      }
    }
  }
  return builds;
}
