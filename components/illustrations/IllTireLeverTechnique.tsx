import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `tire-lever-technique` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 2 numbered callouts `illustrations.tire-lever-technique.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllTireLeverTechnique(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="tire-lever-technique" {...props}>
      <path d="M40 170 C110 60 210 60 280 170" />
      <path d="M110 150 L140 70 M190 150 L180 70" />
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
