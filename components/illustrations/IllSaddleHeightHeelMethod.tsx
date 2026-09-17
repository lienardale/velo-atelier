import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `saddle-height-heel-method` — a rider seated on a road bike, seen from the
 * side, with the heel on the pedal at the bottom of the stroke: the leg is
 * straight, and the crank points down in line with the seat tube (dashed).
 */
export function IllSaddleHeightHeelMethod(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="saddle-height-heel-method" placeholder={false} {...props}>
      {/* wheels */}
      <circle cx={70} cy={184} r={48} />
      <circle cx={262} cy={184} r={48} />
      {/* frame: seat tube, top tube, down tube, stays, fork */}
      <path d="M150 178 L126 86 L238 94 L150 178 L70 184 L126 86" />
      <path d="M238 94 L262 184" />
      {/* saddle, stem and drop bar */}
      <path d="M126 86 V78 M106 76 H148" strokeWidth={4} />
      <path d="M238 94 L250 80 H270 Q282 82 280 94 Q278 104 268 102" />
      {/* seat-tube line carried on past the bottom bracket */}
      <path d="M126 86 L162 226" {...fine} strokeDasharray="4 4" strokeOpacity={0.6} />
      {/* crank and pedal at the bottom of the stroke */}
      <circle cx={150} cy={178} r={6} />
      <path d="M150 178 L159 211" strokeWidth={4} />
      <rect x={150} y={211} width={20} height={5} rx={2} {...solid} />
      {/* rider: straight leg, heel on the pedal, torso, arm, head */}
      <path d="M128 72 L157 209 L180 208" strokeWidth={4} />
      <path d="M128 72 L196 36 L266 80" strokeWidth={4} />
      <circle cx={212} cy={22} r={11} />

      <path d="M133 222 L152 214" {...leader} />
      <circle data-callout="1" cx={122} cy={226} r={11} />
      <text x={122} y={226} {...calloutText}>
        1
      </text>
      <path d="M103 116 L138 128" {...leader} />
      <circle data-callout="2" cx={92} cy={112} r={11} />
      <text x={92} y={112} {...calloutText}>
        2
      </text>
      <path d="M185 199 L158 196" {...leader} />
      <circle data-callout="3" cx={196} cy={200} r={11} />
      <text x={196} y={200} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
