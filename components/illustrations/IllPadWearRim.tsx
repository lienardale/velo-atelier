import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `pad-wear-rim` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 2 numbered callouts `illustrations.pad-wear-rim.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllPadWearRim(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="pad-wear-rim" {...props}>
      <rect x={80} y={80} width={160} height={40} rx={8} />
      <path d="M100 90 V110 M130 90 V110 M160 90 V110" />
      <path d="M40 160 H280" />
      <circle data-callout="1" cx={60} cy={40} r={11} />
      <text x={60} y={40} {...calloutText}>
        1
      </text>
      <circle data-callout="2" cx={260} cy={40} r={11} />
      <text x={260} y={40} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
