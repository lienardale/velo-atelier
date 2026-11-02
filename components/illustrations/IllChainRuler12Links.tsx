import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `chain-ruler-12-links` — NOT DRAWN YET: a placeholder with its numbered callouts in
 * place, so guides and the build list can reference the id. The drawing
 * replaces this body and passes `placeholder={false}`.
 */
export function IllChainRuler12Links(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="chain-ruler-12-links" {...props}>
      <circle data-callout="1" cx={40} cy={40} r={11} />
      <text x={40} y={40} {...calloutText}>
        1
      </text>
      <circle data-callout="2" cx={100} cy={40} r={11} />
      <text x={100} y={40} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
