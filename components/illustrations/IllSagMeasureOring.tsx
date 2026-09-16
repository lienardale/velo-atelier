import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `sag-measure-oring` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 2 numbered callouts `illustrations.sag-measure-oring.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllSagMeasureOring(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="sag-measure-oring" {...props}>
      <rect x={140} y={40} width={40} height={160} rx={18} />
      <path d="M130 120 H190" />
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
