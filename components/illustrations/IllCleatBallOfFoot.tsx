import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `cleat-ball-of-foot` — a cycling shoe clipped onto a pedal, seen from the
 * side: the joint at the base of the big toe sits straight above the pedal
 * axle.
 */
export function IllCleatBallOfFoot(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="cleat-ball-of-foot" placeholder={false} {...props}>
      {/* shoe upper and sole */}
      <path d="M44 150 V92 Q48 70 76 72 L112 78 Q150 96 196 110 Q262 124 272 140 Q276 152 262 154 H44 Z" />
      <path d="M40 154 H266 Q272 160 262 166 H48 Q40 164 40 154 Z" {...tint} />
      {/* foot inside: heel and first metatarsal head */}
      <path d="M62 132 Q90 120 150 124 Q176 126 188 132" {...fine} strokeOpacity={0.6} />
      <circle cx={188} cy={132} r={8} {...solid} />
      {/* cleat and pedal body with its axle */}
      <rect x={168} y={166} width={40} height={10} rx={2} />
      <rect x={150} y={176} width={76} height={22} rx={8} />
      <circle cx={188} cy={187} r={5} {...solid} />
      {/* vertical alignment */}
      <path d="M188 20 V228" {...fine} strokeDasharray="4 4" strokeOpacity={0.6} />

      <path d="M251 50 L194 126" {...leader} />
      <circle data-callout="1" cx={260} cy={40} r={11} />
      <text x={260} y={40} {...calloutText}>
        1
      </text>
      <path d="M259 214 L193 190" {...leader} />
      <circle data-callout="2" cx={270} cy={218} r={11} />
      <text x={270} y={218} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
