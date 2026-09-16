import { Bike } from "lucide-react";
import { useTranslations } from "next-intl";

import { describeCondition, type AppliesToNode } from "@/lib/content/applies-to";
import type { SpecCondition } from "@/lib/domain/schema/condition";

type Translate = (key: string, values?: Record<string, string>) => string;

/** A condition as one readable sentence fragment, from `guides.appliesTo.*`. */
export function describeAppliesTo(node: AppliesToNode, t: Translate): string {
  switch (node.kind) {
    case "leaf": {
      const values = node.values
        .map((value) =>
          value.numeric ? value.raw : t(`appliesTo.values.${node.pathKey}.${value.key}`),
        )
        .join(", ");
      const label = t(`appliesTo.paths.${node.pathKey}`);
      return t(node.negated ? "appliesTo.leafNegated" : "appliesTo.leaf", { label, values });
    }
    case "not":
      return t("appliesTo.negation", { condition: describeAppliesTo(node.child, t) });
    default: {
      const key = node.kind === "all" ? "appliesTo.joinAll" : "appliesTo.joinAny";
      return node.children
        .map((child) => describeAppliesTo(child, t))
        .reduce((left, right) => t(key, { left, right }));
    }
  }
}

/**
 * "Pour quels vélos ?" (§6.2): which bikes the guide is written for, from its
 * `appliesTo` condition — "Freins à disque : oui". A guide without a condition
 * is for every bike, and says so.
 */
export function AppliesToBanner({
  appliesTo,
}: {
  appliesTo?: SpecCondition<string>;
}): React.JSX.Element {
  const t = useTranslations("guides");
  // Keys under `appliesTo.paths` / `appliesTo.values` are derived from spec
  // paths and validated by `npm run content:check`, not by the message types.
  const translate = t as unknown as Translate;
  const text = appliesTo
    ? describeAppliesTo(describeCondition(appliesTo), translate)
    : t("appliesTo.all");

  return (
    <aside
      aria-labelledby="applies-to-title"
      data-testid="applies-to"
      className="flex items-start gap-3 rounded-lg border border-rule bg-paper-2/60 px-4 py-3 text-sm"
    >
      <Bike aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <div>
        <h2 id="applies-to-title" className="font-sans text-sm font-semibold">
          {t("appliesTo.title")}
        </h2>
        <p className="text-ink-muted">{text}</p>
      </div>
    </aside>
  );
}
