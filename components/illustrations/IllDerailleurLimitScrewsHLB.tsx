import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `derailleur-limit-screws-h-l-b` — a rear derailleur: the B screw bearing on
 * the hanger at the top, the body with its two limit screws side by side
 * (H for the smallest cog, L for the largest), and the cage with its two
 * jockey wheels below.
 */
export function IllDerailleurLimitScrewsHLB(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="derailleur-limit-screws-h-l-b" placeholder={false} {...props}>
      {/* hanger and mounting bolt */}
      <path d="M150 20 H196 V52 Q180 70 158 64 Z" {...tint} />
      <circle cx={170} cy={44} r={9} />
      {/* B screw against the hanger tab */}
      <rect x={112} y={56} width={30} height={10} rx={3} {...solid} />
      <path d="M142 61 H152" />
      {/* parallelogram body */}
      <path d="M150 64 L206 78 L214 132 L158 118 Z" />
      {/* H and L limit screws */}
      <circle cx={196} cy={94} r={6} {...solid} />
      <path d="M192 94 H200" {...fine} />
      <circle cx={200} cy={114} r={6} {...solid} />
      <path d="M196 114 H204" {...fine} />
      {/* cage and jockey wheels */}
      <path d="M170 124 L186 146 L150 214 L134 206 Z" />
      <circle cx={178} cy={150} r={13} />
      <circle cx={178} cy={150} r={3} {...fine} />
      <circle cx={144} cy={206} r={13} />
      <circle cx={144} cy={206} r={3} {...fine} />

      <path d="M270 76 L203 92" {...leader} />
      <circle data-callout="1" cx={281} cy={74} r={11} />
      <text x={281} y={74} {...calloutText}>
        1
      </text>
      <path d="M270 126 L207 116" {...leader} />
      <circle data-callout="2" cx={281} cy={128} r={11} />
      <text x={281} y={128} {...calloutText}>
        2
      </text>
      <path d="M59 46 L112 58" {...leader} />
      <circle data-callout="3" cx={48} cy={44} r={11} />
      <text x={48} y={44} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
