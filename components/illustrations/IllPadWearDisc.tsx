import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `pad-wear-disc` — a disc brake pad seen edge-on above the rotor: the metal
 * backing plate with its retaining tab, the friction lining, and the 1 mm
 * line below which the pad is worn out.
 */
export function IllPadWearDisc(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="pad-wear-disc" placeholder={false} {...props}>
      {/* backing plate with its tab and pin hole */}
      <path d="M70 118 V96 H138 V62 Q160 48 182 62 V96 H250 V118 Z" />
      <circle cx={160} cy={72} r={7} />
      {/* friction lining */}
      <rect x={80} y={118} width={160} height={42} rx={3} {...tint} />
      {/* 1 mm wear limit */}
      <path d="M80 128 H240" {...leader} />
      <path d="M258 118 V128 M252 118 H264 M252 128 H264" {...fine} />
      {/* rotor surface */}
      <path d="M40 184 H280" strokeWidth={5} />
      <path d="M160 166 V176 M154 170 L160 177 L166 170" {...fine} />

      <path d="M51 100 H70" {...leader} />
      <circle data-callout="1" cx={40} cy={100} r={11} />
      <text x={40} y={100} {...calloutText}>
        1
      </text>
      <path d="M51 150 H80" {...leader} />
      <circle data-callout="2" cx={40} cy={150} r={11} />
      <text x={40} y={150} {...calloutText}>
        2
      </text>
      <path d="M279 123 H264" {...leader} />
      <circle data-callout="3" cx={290} cy={123} r={11} />
      <text x={290} y={123} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
