/**
 * Every reason the catalogue holds is a symptom some check question offers.
 *
 * `guides.reasons.*` (`messages/<locale>/guides.json`) is the vocabulary of a
 * KO's symptoms, and `content-check` holds one direction: every
 * `checkQuestion.ko[].reasonKey` has its label, in both locales. Nothing held
 * the other one. Until 2026-11-02 five labels — `chain-stiff-link`,
 * `freewheel-worn`, `spoke-broken`, `tire-damaged`, `valve-damaged` — were in
 * the catalogue with no finding naming them, while the questions' own prompts
 * asked about stiff links, spokes, cuts and valves: a symptom a visitor could
 * never pick. A key no finding names is either a question that should offer
 * it or a label that should go.
 *
 * The guides are read from disk, the way the other content tests read them.
 */
import { describe, expect, it } from "vitest";

import { GUIDE_LOCALES } from "@/lib/content/types";
import en from "@/messages/en/guides.json";
import fr from "@/messages/fr/guides.json";
import { diskGuides } from "@/tests/_helpers/guides";

const GUIDES = diskGuides();
const CATALOGUE = { fr: fr.reasons, en: en.reasons } as const;

describe.each(GUIDE_LOCALES)("guides.reasons in messages/%s/guides.json", (locale) => {
  it("holds no reason that no check question offers", () => {
    const offered = new Set(
      GUIDES.filter((guide) => guide.locale === locale).flatMap((guide) =>
        guide.steps.flatMap(
          (step) => step.checkQuestion?.ko.map((consequence) => consequence.reasonKey) ?? [],
        ),
      ),
    );
    // eslint-disable-next-line security/detect-object-injection -- `locale` is a GUIDE_LOCALES literal
    const unused = Object.keys(CATALOGUE[locale])
      .filter((key) => !offered.has(key))
      .sort();
    expect(unused).toEqual([]);
    expect(offered.size).toBeGreaterThan(0);
  });
});
