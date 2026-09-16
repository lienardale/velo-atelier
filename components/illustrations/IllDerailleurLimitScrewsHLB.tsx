import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `derailleur-limit-screws-h-l-b` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 3 numbered callouts `illustrations.derailleur-limit-screws-h-l-b.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllDerailleurLimitScrewsHLB(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="derailleur-limit-screws-h-l-b" {...props}>
      <path d="M110 60 L210 60 L230 140 L150 190 Z" />
      <circle cx={170} cy={170} r={14} />
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
