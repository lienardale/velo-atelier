import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `saddle-width-sit-bones` — a saddle seen from above, nose at the top: the
 * width is measured across its widest part at the back, from edge to edge
 * (extension lines down to the dimension line), and the two sit bones rest
 * on that wide part, a little inside each edge.
 */
export function IllSaddleWidthSitBones(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="saddle-width-sit-bones" placeholder={false} {...props}>
      {/* saddle outline: narrow nose, waist, wide back */}
      <path
        d="M160 14 Q176 14 177 34 L182 96 Q186 130 214 156 Q230 170 228 186 Q224 204 196 206 Q176 207 160 202 Q144 207 124 206 Q96 204 92 186 Q90 170 106 156 Q134 130 138 96 L143 34 Q144 14 160 14 Z"
        {...tint}
      />
      {/* where the sit bones rest */}
      <ellipse cx={108} cy={180} rx={10} ry={8} {...solid} />
      <ellipse cx={212} cy={180} rx={10} ry={8} {...solid} />
      {/* width across the widest part, edge to edge */}
      <path d="M91 182 V228 M229 182 V228" {...fine} />
      <path d="M94 222 H226" {...fine} />
      <path d="M91 222 L100 218 V226 Z M229 222 L220 218 V226 Z" {...solid} />

      <path d="M58 214 L91 220" {...leader} />
      <circle data-callout="1" cx={48} cy={212} r={11} />
      <text x={48} y={212} {...calloutText}>
        1
      </text>
      <path d="M256 128 L216 172 M253 124 L114 173" {...leader} />
      <circle data-callout="2" cx={264} cy={118} r={11} />
      <text x={264} y={118} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
