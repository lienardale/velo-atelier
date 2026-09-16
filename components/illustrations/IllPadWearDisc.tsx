import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `pad-wear-disc` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 3 numbered callouts `illustrations.pad-wear-disc.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllPadWearDisc(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="pad-wear-disc" {...props}>
      <rect x={70} y={70} width={180} height={30} rx={4} />
      <rect x={70} y={100} width={180} height={18} rx={2} strokeDasharray="4 3" />
      <path d="M70 124 H250" strokeOpacity={0.5} />
      <circle data-callout="1" cx={60} cy={40} r={11} />
      <text x={60} y={40} {...calloutText}>
        1
      </text>
      <circle data-callout="2" cx={260} cy={40} r={11} />
      <text x={260} y={40} {...calloutText}>
        2
      </text>
      <circle data-callout="3" cx={260} cy={200} r={11} />
      <text x={260} y={200} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
