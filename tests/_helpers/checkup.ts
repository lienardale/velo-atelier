/**
 * Hand-shaped checkup fixtures.
 *
 * The corpus-driven assertions live in `tests/unit/checkup/plan-corpus.test.ts`
 * and read `content/guides/**`; everything that is about the ENGINE rather than
 * about the guides uses these three builders, so a test says what it is testing
 * instead of hunting for a real guide that happens to have the shape it needs.
 */
import { createCheckupState } from "@/lib/checkup/reducer";
import type { CheckStepRef, CheckupScope, CheckupState } from "@/lib/checkup/types";
import type { PartId } from "@/lib/domain/data/parts";
import type { KoConsequence } from "@/lib/domain/schema/procedure";

/** A planned step, with just enough of a guide behind it to be plausible. */
export function makeStep(overrides: Partial<CheckStepRef> = {}): CheckStepRef {
  const guideSlug = overrides.guideSlug ?? "check-brakes-disc";
  const stepId = overrides.stepId ?? "pad-wear";
  return {
    guideSlug,
    stepId,
    partIds: ["brake-caliper-front"] as PartId[],
    ko: [
      {
        action: "replace",
        partId: "brake-pads-front",
        reasonKey: "pad-worn",
        guideSlug: "replace-brake-pads-disc",
      },
    ] satisfies KoConsequence[],
    skippable: true,
    tools: [],
    title: "Mesurer l’usure des plaquettes",
    prompt: "Reste-t-il au moins 1 mm de garniture ?",
    number: 1,
    ...overrides,
    key: overrides.key ?? `${guideSlug}#${stepId}`,
  };
}

/** A checkup over `steps`, nothing answered. */
export function makeState(
  steps: readonly CheckStepRef[],
  overrides: Partial<CheckupState> = {},
): CheckupState {
  const scope: CheckupScope = overrides.scope ?? { kind: "full" };
  return {
    ...createCheckupState({
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "demo" },
      scope,
      locale: "fr",
      steps,
      contentVersion: "content-v1",
      startedAt: "2026-09-19T08:00:00.000Z",
    }),
    ...overrides,
  };
}

/** Three steps that exercise the merge, the skip and the recheck rules. */
export function threeStepPlan(): CheckStepRef[] {
  return [
    makeStep(),
    makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "caliper-alignment",
      number: 4,
      title: "Contrôler l’alignement",
      partIds: ["brake-caliper-front"] as PartId[],
      skippable: true,
      ko: [
        {
          action: "fix",
          partId: "brake-caliper-front",
          reasonKey: "caliper-rub",
          guideSlug: "adjust-disc-caliper-alignment",
        },
      ],
    }),
    makeStep({
      guideSlug: "check-drivetrain",
      stepId: "chain-wear",
      number: 1,
      title: "Mesurer l’allongement de la chaîne",
      partIds: ["chain"] as PartId[],
      skippable: false,
      ko: [
        {
          action: "replace",
          partId: "chain",
          reasonKey: "chain-elongation",
          guideSlug: "replace-chain",
        },
        { action: "clean", partId: "chain", reasonKey: "chain-dirty", guideSlug: "clean-chain" },
      ],
    }),
  ];
}
