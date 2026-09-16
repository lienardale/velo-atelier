import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import type { IllustrationProps } from "./placeholder";

/**
 * `ebike-battery-connector` — guide illustration placeholder (W1-T4): the frame, rough shapes
 * and the 2 numbered callouts `illustrations.ebike-battery-connector.callouts.*` describe.
 *
 * W2-T4a/b draw the real picture and flip `status` to `"final"` in
 * `lib/content/illustrations.ts`. Keep the exported name (the barrel and the
 * registry refer to it) and keep one literal `data-callout` per message key.
 */
export function IllEbikeBatteryConnector(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="ebike-battery-connector" {...props}>
      <rect x={70} y={70} width={180} height={100} rx={12} />
      <path d="M120 170 V190 M160 170 V190 M200 170 V190" />
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
