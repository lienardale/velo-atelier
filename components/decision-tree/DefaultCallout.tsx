"use client";

import { useTranslations } from "next-intl";

import { Callout } from "@/components/ui-ext/Callout";
import type { Answers, DecisionNode } from "@/lib/domain/schema/decision";

import { useDecisionText } from "./decision-text";
import { defaultChoice } from "./tree-state";

/**
 * Why "Je ne sais pas" picked what it picked (§6.3). The default is
 * context-dependent — V-brakes for a city bike, hydraulic discs for a gravel
 * bike — so the callout names the earlier answers it is based on, and says the
 * choice can be corrected later. It appears in response to the button, so it
 * is a polite live region; the visitor still presses "Continuer" themselves.
 */
export function DefaultCallout({
  node,
  answers,
}: {
  node: DecisionNode;
  answers: Answers;
}): React.JSX.Element {
  const t = useDecisionText();
  const tree = useTranslations("decision-tree");
  const { option, basedOn } = defaultChoice(node, answers);
  const optionLabel = t(`decision.${node.id}.options.${option}.label`);
  const context = basedOn
    .map((entry) => t(`decision.${entry.question}.options.${entry.option}.label`))
    .join(", ");

  return (
    <Callout
      tone="info"
      role="status"
      data-testid="default-callout"
      title={tree("default.title", { option: optionLabel })}
    >
      <p>
        {context === ""
          ? tree("default.reasonGeneral")
          : tree("default.reasonContext", { context })}
      </p>
      <p>{tree("default.later")}</p>
    </Callout>
  );
}
