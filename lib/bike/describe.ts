/**
 * A bike in one sentence, for screen readers (§6.4): the 3D workspace puts
 * `describe(spec, locale)` in an `sr-only` paragraph next to the canvas, so a
 * visitor who cannot see the model still knows which bike is on screen.
 *
 * The sentence re-uses the decision tree's own words — each detail is
 * "<short question name>: <option label>" — so the description can never say
 * something the tree did not ask, and a new option is described the day its
 * label is written. Only the questions actually asked of this bike appear
 * (no "Batterie" on a muscular bike).
 *
 * Plain TS with an explicit locale (like `lib/domain/i18n.ts`), not next-intl:
 * it is data that server and client components alike can compute. Placeholders
 * are the plain `{name}` form; `tests/unit/i18n/messages-parity.test.ts` keeps
 * them identical in both locales.
 */
import enDecisionTree from "../../messages/en/decision-tree.json";
import frDecisionTree from "../../messages/fr/decision-tree.json";

import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { isNodeVisible, pruneAnswers } from "@/lib/domain/engine/decision";
import { domainMessage, type DomainLocale } from "@/lib/domain/i18n";
import type { BikeSpec } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";

const CHROME: Record<DomainLocale, typeof frDecisionTree> = {
  fr: frDecisionTree,
  en: enDecisionTree,
};

/**
 * The tree answers a spec corresponds to — the inverse of `buildBikeSpec` for
 * every question that is asked of this bike. Unasked questions are pruned, so
 * `answersFromSpec(buildBikeSpec(answerWithDefaults(a)))` equals
 * `answerWithDefaults(a)`.
 */
export function answersFromSpec(spec: BikeSpec): Answers {
  const { drivetrain } = spec;
  const answers: Answers = {
    drive: spec.drive,
    discipline: spec.discipline,
    "wheel-size": spec.wheel.label.replace(".", "-"),
    "brake-type": spec.brakes.type,
    cockpit: spec.cockpit.bar,
    drivetrain:
      drivetrain.kind === "derailleur" ? `derailleur-${drivetrain.chainrings}x` : drivetrain.kind,
    transmission: drivetrain.transmission,
    speeds: String(drivetrain.speeds),
    pedals: spec.pedals,
    suspension: spec.suspension.rear ? "full" : spec.suspension.front ? "front" : "rigid",
    seatpost: spec.seatpost.dropper ? "dropper" : "rigid",
    "tire-system": spec.tires.system,
  };
  if (spec.brakes.mount !== null) answers["brake-mount"] = spec.brakes.mount;
  if (drivetrain.shifter !== null) answers.shifter = drivetrain.shifter;
  if (spec.eSystem !== null) {
    answers["e-motor"] = spec.eSystem.motorPosition;
    answers["e-battery"] = spec.eSystem.batteryPosition;
  }
  return pruneAnswers(answers);
}

function fill(template: string, values: Record<string, string>): string {
  const known = new Map(Object.entries(values));
  return template.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) =>
    known.has(name) ? String(known.get(name)) : placeholder,
  );
}

/** One "<question>: <answer>" detail per question asked of this bike, in tree order. */
export function describeDetails(spec: BikeSpec, locale: DomainLocale): string[] {
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a DomainLocale, a key of CHROME
  const chrome = CHROME[locale];
  const answers = answersFromSpec(spec);
  const details: string[] = [];
  for (const node of DECISION_TREE) {
    const answer = answers[node.id];
    if (answer === undefined || !isNodeVisible(node, answers)) continue;
    details.push(
      fill(chrome.describe.item, {
        question: chrome.questions[node.id],
        answer: domainMessage(locale, `decision.${node.id}.options.${answer}.label`),
      }),
    );
  }
  return details;
}

/** The whole sentence: "Vélo décrit : Assistance : Musculaire ; Pratique : Gravel ; …." */
export function describe(spec: BikeSpec, locale: DomainLocale): string {
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a DomainLocale, a key of CHROME
  const chrome = CHROME[locale];
  return fill(chrome.describe.sentence, {
    details: describeDetails(spec, locale).join(chrome.describe.separator),
  });
}
