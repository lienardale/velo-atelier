import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `presta-valve-core` — a Presta valve standing out of the rim: the small
 * lock nut on the tip, the removable core with its two spanner flats screwed
 * into the valve stem, and the rim nut at the base.
 */
export function IllPrestaValveCore(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="presta-valve-core" placeholder={false} {...props}>
      {/* tip pin and lock nut */}
      <path d="M160 20 V44" strokeWidth={3} />
      <rect x={150} y={44} width={20} height={14} rx={3} {...solid} />
      {/* removable core with spanner flats, and its thread */}
      <rect x={146} y={60} width={28} height={34} rx={2} {...tint} />
      <path d="M146 70 H174 M146 84 H174" {...fine} />
      <path d="M150 94 L154 102 M157 94 L161 102 M164 94 L168 102" {...fine} />
      {/* threaded valve stem */}
      <rect x={148} y={102} width={24} height={96} />
      <path
        d="M148 112 L172 118 M148 124 L172 130 M148 136 L172 142 M148 148 L172 154 M148 160 L172 166 M148 172 L172 178"
        {...fine}
        strokeOpacity={0.5}
      />
      {/* rim nut and rim */}
      <rect x={134} y={184} width={52} height={14} rx={3} />
      <path d="M24 204 H296 M24 222 H296" />
      <path d="M24 204 H296 V222 H24 Z" {...tint} />

      <path d="M81 51 L150 51" {...leader} />
      <circle data-callout="1" cx={70} cy={51} r={11} />
      <text x={70} y={51} {...calloutText}>
        1
      </text>
      <path d="M239 77 L174 77" {...leader} />
      <circle data-callout="2" cx={250} cy={77} r={11} />
      <text x={250} y={77} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
