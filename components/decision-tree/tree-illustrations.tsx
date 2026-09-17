import { createElement, type ReactNode } from "react";

import { illustrationComponent } from "@/components/illustrations";
import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { ILLUSTRATIONS, type IllustrationId } from "@/lib/domain/data/illustrations";

/** Every drawing the tree can show, already rendered, keyed by illustration id. */
export type TreeIllustrations = Readonly<Partial<Record<IllustrationId, ReactNode>>>;

/** Class names of the two uses, shared with the tests. */
export const HELP_ILLUSTRATION_CLASS =
  "mx-auto h-auto w-full max-w-xs shrink-0 text-ink sm:mx-0 sm:w-56";
export const THUMBNAIL_ILLUSTRATION_CLASS = "mx-auto h-auto w-full max-w-[8rem]";

function render(id: IllustrationId, props: { className: string; decorative: boolean }): ReactNode {
  // eslint-disable-next-line security/detect-object-injection -- `id` is an IllustrationId, a key of the manifest
  const Drawing = illustrationComponent(ILLUSTRATIONS[id].component);
  // createElement: the component comes from a static registry, it is not created here.
  return Drawing === undefined ? null : createElement(Drawing, props);
}

/**
 * The decision tree's drawings, rendered on the SERVER and handed to the client
 * tree as React nodes (§5.3: the illustration registry is RSC-rendered and
 * ships zero client JS; `components/mdx/Illustration.tsx` follows the same
 * rule). The home page calls this and passes the result as a prop, so the SVG
 * markup travels in the RSC payload and none of the ~70 illustration
 * components lands in the `/[locale]` bundle.
 *
 * - each question's help drawing is **informative** (`role="img"` + `<title>`
 *   from `illustrations.<id>.alt`): it is what the help paragraph describes;
 * - option thumbnails are **decorative**: the card's label names the option.
 *
 * Whatever the registry holds is rendered — placeholders today, the finished
 * drawings once W2-T4c lands them.
 *
 * Never import this module from a `"use client"` file.
 */
export function renderTreeIllustrations(): TreeIllustrations {
  const nodes: Partial<Record<IllustrationId, ReactNode>> = {};
  for (const node of DECISION_TREE) {
    nodes[node.help.illustrationId] = render(node.help.illustrationId, {
      className: HELP_ILLUSTRATION_CLASS,
      decorative: false,
    });
    for (const option of node.options) {
      if (option.illustrationId === undefined) continue;
      nodes[option.illustrationId] = render(option.illustrationId, {
        className: THUMBNAIL_ILLUSTRATION_CLASS,
        decorative: true,
      });
    }
  }
  return nodes;
}
