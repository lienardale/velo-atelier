import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `tire-lever-technique` — the top of a wheel with the tyre bead levered over
 * the rim edge: the first tyre lever is hooked onto a spoke to hold the bead
 * out, and the second one, slid in further along, runs round the rim.
 */
export function IllTireLeverTechnique(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="tire-lever-technique" placeholder={false} {...props}>
      {/* tyre, rim and spokes */}
      <path d="M20 118 A250 250 0 0 1 300 118" />
      <path d="M20 160 A220 220 0 0 1 300 160" />
      <path d="M20 190 A195 195 0 0 1 300 190" />
      <path d="M20 160 A220 220 0 0 1 300 160 L300 190 A195 195 0 0 0 20 190 Z" {...tint} />
      <path d="M92 148 L118 240 M160 136 V240 M228 148 L202 240" {...fine} />
      {/* bead lifted over the rim between the two levers */}
      <path d="M100 124 Q150 96 214 110" strokeWidth={3} />
      {/* first lever, hooked on a spoke */}
      <path d="M96 114 L104 110 L120 200 Q122 214 110 214 L104 206" strokeWidth={3} />
      {/* second lever, sliding round the rim */}
      <path d="M208 118 L216 114 L262 42 Q268 32 276 40 L226 124" strokeWidth={3} />
      {/* direction of travel */}
      <path d="M232 80 Q256 92 268 116 M260 112 L268 118 L270 106" {...fine} />

      <path d="M53 214 L102 210" {...leader} />
      <circle data-callout="1" cx={42} cy={214} r={11} />
      <text x={42} y={214} {...calloutText}>
        1
      </text>
      <path d="M281 22 L272 36" {...leader} />
      <circle data-callout="2" cx={288} cy={16} r={11} />
      <text x={288} y={16} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
