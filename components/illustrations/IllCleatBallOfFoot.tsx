import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `cleat-ball-of-foot` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 2 numbered callouts `illustrations.cleat-ball-of-foot.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllCleatBallOfFoot(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="cleat-ball-of-foot" {...props}>
      <path d="M60 120 C100 80 220 80 270 120 L60 120 Z" />
      <path d="M80 150 H250" />
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
