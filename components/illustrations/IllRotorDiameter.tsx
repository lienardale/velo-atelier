import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `rotor-diameter` — a disc brake rotor seen face-on, with a dimension line
 * across its full diameter through the centre, edge to edge. At the top, the
 * adapter bracket: its inner row of bolts goes into the frame (or fork)
 * mount, nearer the axle; its outer row holds the caliper, further out, so
 * that the caliper straddles the braking track at the edge of a larger rotor.
 */
export function IllRotorDiameter(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="rotor-diameter" placeholder={false} {...props}>
      {/* braking track, hidden under the caliper at the top, and its holes */}
      <path
        d="M173.3 88.1 A68 68 0 1 1 126.7 88.1 L131.2 100.3 A55 55 0 1 0 168.8 100.3 Z"
        stroke="none"
        {...tint}
      />
      <path d="M173.3 88.1 A68 68 0 1 1 126.7 88.1 M168.8 100.3 A55 55 0 1 1 131.2 100.3" />
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

      {/* adapter bracket around the caliper: inner bolts into the frame mount */}
      <path
        d="M102.4 95.3 A74 74 0 0 1 124.7 82.5 L116.1 59 A99 99 0 0 1 134.5 54.2 L136.5 67.1 A86 86 0 0 1 163.5 67.1 L165.5 54.2 A99 99 0 0 1 183.9 59 L175.3 82.5 A74 74 0 0 1 197.6 95.3 L216.2 73.1 A103 103 0 0 0 83.8 73.1 Z"
        {...solid}
      />
      <circle cx={107.9} cy={80.5} r={5.5} {...tint} />
      <circle cx={192.1} cy={80.5} r={5.5} {...tint} />
      {/* caliper over the track, hanging from the adapter's outer bolts */}
      <path
        d="M133.6 106.9 A48 48 0 0 1 166.4 106.9 L183.9 59 A99 99 0 0 0 165.5 54.2 L163.5 67.1 A86 86 0 0 0 136.5 67.1 L134.5 54.2 A99 99 0 0 0 116.1 59 Z"
        {...tint}
      />
      <circle cx={126.7} cy={62} r={5} {...tint} />
      <circle cx={173.3} cy={62} r={5} {...tint} />
      <path
        d="M126.7 88.1 A68 68 0 0 1 173.3 88.1 M131.2 100.3 A55 55 0 0 1 168.8 100.3"
        {...fine}
        strokeDasharray="3 3"
        strokeOpacity={0.5}
      />

      <path d="M47 130 L84 150" {...leader} />
      <circle data-callout="1" cx={38} cy={124} r={11} />
      <text x={38} y={124} {...calloutText}>
        1
      </text>
      <path d="M244 54 L209 74" {...leader} />
      <circle data-callout="2" cx={254} cy={48} r={11} />
      <text x={254} y={48} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
