/**
 * What a visitor really pastes into "Référence des plaquettes", and the guest
 * work around it (`.debug/017` §5.9).
 *
 * The field asks for a manufacturer's reference — "J04C". What gets pasted is
 * the product's TITLE, copied off a shop's page, or its address: 99 and 138
 * characters in the run that found the defect, against a cap of 64 that the
 * form did not have and every reader did. The two strings below are those two
 * lengths, and the lengths are the point: 99 is over the cap every reader of a
 * refinement holds an entry to, and 138 is also over the 120 the guest
 * import's contract allowed until 2026-10-13.
 *
 * No Vitest import: `tests/e2e/build-list-long-answer.spec.ts` uses it from
 * Playwright.
 */
import type { CheckupState } from "@/lib/checkup/types";
import type { BikeBuild } from "@/lib/domain/schema/part";

import { guestRun, partsScope, planFromDisk, type GuestVerdict } from "./guest-work";

/** A French shop's product title, as its page shows it. */
export const PRODUCT_TITLE =
  "Plaquettes de frein à disque Shimano J04C métal fritté avec ailettes de refroidissement Ice-Tech x2";

/** The same product's address. */
export const PRODUCT_URL =
  "https://www.alltricks.fr/F-11946-plaquettes-de-frein/P-235711-plaquettes_de_frein_shimano_j04c_metal_fritte_ailettes_ice_tech_xtr_xt_slx_2";

// A fixture whose length has drifted proves nothing about a length.
if (PRODUCT_TITLE.length !== 99 || PRODUCT_URL.length !== 138) {
  throw new Error(
    `long-answers.ts: the title is ${PRODUCT_TITLE.length} characters (99 expected) and the address ${PRODUCT_URL.length} (138 expected)`,
  );
}

export const PAD_WEAR = "check-brakes-disc#pad-wear";
export const CHAIN_WEAR = "check-drivetrain#chain-wear";
export const HANGER = "check-drivetrain#derailleur-hanger";

/** The three lines the checkup below leaves, as `(action, partId)`. */
export const FRONT_PADS = { action: "replace", partId: "brake-pads-front" } as const;
export const REAR_PADS = { action: "replace", partId: "brake-pads-rear" } as const;
export const CHAIN = { action: "replace", partId: "chain" } as const;

/**
 * The parts whose questions the checkups of this file ask: BOTH brakes' pads,
 * because the first checkup below puts both on the list. Until 2026-10-22
 * this scope named the rear pads only, and the front pads' line came from the
 * defect `.debug/017` §5.11 records — a checkup limited to one side derived
 * the other's lines too.
 */
const SCOPE = partsScope("brake-pads-front", "brake-pads-rear", "chain", "rear-derailleur");

/**
 * A FINISHED checkup of the brake pads, the chain and the rear derailleur, the
 * real plan answered through the real reducer: KO with the named symptom for
 * the keys of `ko`, OK for every other question the plan asks.
 */
export function partialCheckup(options: {
  id: string;
  build: BikeBuild;
  ko: Readonly<Record<string, string>>;
  at: string;
}): CheckupState {
  const plan = planFromDisk(options.build, SCOPE);
  for (const key of Object.keys(options.ko)) {
    if (!plan.some((step) => step.key === key)) {
      throw new Error(`partialCheckup(): "${key}" is not a question of this bike's plan`);
    }
  }
  const verdicts: Record<string, GuestVerdict> = Object.fromEntries(
    plan.map((step): [string, GuestVerdict] => [
      step.key,
      Object.hasOwn(options.ko, step.key) ? { ko: [options.ko[step.key]] } : "ok",
    ]),
  );
  return guestRun({
    id: options.id,
    build: options.build,
    scope: SCOPE,
    verdicts,
    startedAt: options.at,
    completedAt: options.at,
  });
}

/**
 * The first checkup: the pads are worn (front and rear — one symptom, two
 * parts to buy) and so is the chain. Three lines to replace.
 */
export function wornPadsAndChain(build: BikeBuild, id: string): CheckupState {
  return partialCheckup({
    id,
    build,
    ko: { [PAD_WEAR]: "pad-worn", [CHAIN_WEAR]: "chain-elongation" },
    at: "2026-09-14T08:00:00.000Z",
  });
}
