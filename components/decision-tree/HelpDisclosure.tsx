"use client";

import { useTranslations } from "next-intl";

import { Disclosure } from "@/components/ui-ext/Disclosure";
import { DECISION_HELP_PERSIST_KEY } from "@/lib/bike/storage-keys";
import type { DecisionNode } from "@/lib/domain/schema/decision";

import { useDecisionText } from "./decision-text";
import type { TreeIllustrations } from "./tree-illustrations";

/**
 * "Comment le vérifier sur mon vélo ?" — the check-it-yourself aid of one
 * question (§6.3): a native `<details>` holding the question's drawing and its
 * help paragraph.
 *
 * The drawing is informative here (`role="img"` with the illustration's alt as
 * `<title>`), rendered on the server by `renderTreeIllustrations`: it is the answer key the
 * paragraph refers to. Whether the panel is open is remembered in
 * `localStorage` for every question at once, so someone who needs the help on
 * step 1 finds it open on step 2 — the parent remounts this component per
 * question (`key`), which re-applies the remembered state.
 */
export function HelpDisclosure({
  node,
  illustrations,
}: {
  node: DecisionNode;
  /** Server-rendered drawings (`renderTreeIllustrations`). */
  illustrations: TreeIllustrations;
}): React.JSX.Element {
  const t = useDecisionText();
  const tree = useTranslations("decision-tree");

  return (
    <Disclosure
      summary={tree("help.summary")}
      persistKey={DECISION_HELP_PERSIST_KEY}
      data-testid="decision-help"
      data-question={node.id}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {illustrations[node.help.illustrationId] ?? null}
        <p className="leading-relaxed text-ink">{t(node.help.textKey)}</p>
      </div>
    </Disclosure>
  );
}
