import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `rotor-diameter` — a disc brake rotor seen face-on, with a dimension line
 * across its full diameter through the centre, edge to edge. At the top, the
 * caliper straddles the braking track, held out from the frame mount by an
 * adapter bracket that sets it for that diameter.
 */
export function IllRotorDiameter(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="rotor-diameter" placeholder={false} {...props}>
      {/* braking track, hidden under the caliper at the top, and its holes */}
      <path
        d="M181.9 92 A68 68 0 1 1 118.1 92 L124.2 103.4 A55 55 0 1 0 175.8 103.4 Z"
        stroke="none"
        {...tint}
      />
      <path d="M181.9 92 A68 68 0 1 1 118.1 92 M175.8 103.4 A55 55 0 1 1 124.2 103.4" />
      <path
        d="M206.9 167.9 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M191 195.5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M163.4 211.4 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M131.6 211.4 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M104 195.5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M88.1 167.9 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M88.1 136.1 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M104 108.5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M191 108.5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M206.9 136.1 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0"
        {...fine}
      />
      {/* arms and centre */}
      <path
        d="M130.2 142.4 Q117.7 131 117.7 107.5 M153.1 130.2 Q160 114.8 182.3 107.5 M171.7 148.2 Q188.4 150 202.3 169 M160.3 171.4 Q163.8 187.9 150 207 M134.7 167.8 Q120.1 176.2 97.7 169"
        strokeWidth={5}
      />
      <circle cx={150} cy={152} r={22} />
      <circle cx={150} cy={152} r={8} {...fine} />
      <circle cx={163} cy={159.5} r={3.5} {...solid} />
      <circle cx={150} cy={167} r={3.5} {...solid} />
      <circle cx={137} cy={159.5} r={3.5} {...solid} />
      <circle cx={137} cy={144.5} r={3.5} {...solid} />
      <circle cx={150} cy={137} r={3.5} {...solid} />
      <circle cx={163} cy={144.5} r={3.5} {...solid} />
      {/* diameter, edge to edge through the centre */}
      <path d="M86 152 H214" />
      <path d="M83 152 L93 147 V157 Z M217 152 L207 147 V157 Z" {...solid} />

      {/* frame mount, adapter bracket, and the caliper it holds over the track */}
      <rect x={116} y={14} width={68} height={22} rx={4} {...tint} />
      <path d="M104 36 H196 L188 64 H112 Z" {...solid} />
      <circle cx={128} cy={36} r={5} />
      <circle cx={172} cy={36} r={5} />
      <path d="M128 64 V78 M172 64 V78" strokeWidth={4} />
      <path
        d="M127.5 109.6 A48 48 0 0 1 172.5 109.6 L187.6 81.4 A80 80 0 0 0 112.4 81.4 Z"
        {...tint}
      />
      <path
        d="M118.1 92 A68 68 0 0 1 181.9 92 M124.2 103.4 A55 55 0 0 1 175.8 103.4"
        {...fine}
        strokeDasharray="3 3"
        strokeOpacity={0.5}
      />

      <path d="M47 130 L84 150" {...leader} />
      <circle data-callout="1" cx={38} cy={124} r={11} />
      <text x={38} y={124} {...calloutText}>
        1
      </text>
      <path d="M243 44 L193 50" {...leader} />
      <circle data-callout="2" cx={254} cy={42} r={11} />
      <text x={254} y={42} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
