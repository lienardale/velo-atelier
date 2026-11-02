import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `pedal-thread-direction` — the two pedals, each seen from its own side of
 * the bike, the crank pointing forward and the small bike below each one
 * saying which way the front is. Left: the right (chain) side, front to the
 * right, chainring behind the crank. Right: the left side, front to the left.
 * On both, the pedal wrench stands up from behind the pedal and the arrow at
 * its top swings towards the BACK of the bike: anticlockwise for the standard
 * right-hand thread, clockwise for the reverse left-hand one.
 */
export function IllPedalThreadDirection(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="pedal-thread-direction" placeholder={false} {...props}>
      {/* right side of the bike: chainring, crank, pedal spindle, wrench, pedal */}
      <circle cx={56} cy={132} r={36} strokeWidth={4} strokeDasharray="2.5 2.5" />
      <circle cx={56} cy={132} r={26} {...fine} />
      <path d="M56 122 L116 127 A5 5 0 0 1 116 137 L56 142 A10 10 0 0 1 56 122 Z" {...solid} />
      <circle cx={56} cy={132} r={5} {...fine} />
      <circle cx={116} cy={132} r={2.5} {...fine} />
      <path d="M102 126 Q102 114 110 110 V66 Q110 60 116 60 Q122 60 122 66 V110 Q130 114 130 126" />
      <rect x={96} y={126} width={40} height={12} rx={3} {...tint} />
      <path d="M116 52 A80 80 0 0 0 78.4 61.4" />
      <path d="M83.2 53.2 L78.4 61.4 L87.8 62" />
      {/* the bike seen from that side, front to the right */}
      <path
        d="M42 186 H54 M49 187 L50 192 L77 191 M50 192 L55 212 L79 196 L77 190 L78 185 L86 184 M55 212 L30 210 L50 192 M79 196 L84 210"
        {...fine}
      />
      <circle cx={30} cy={210} r={12} {...fine} />
      <circle cx={84} cy={210} r={12} {...fine} />
      <circle cx={55} cy={212} r={5} {...fine} />

      <path d="M160 48 V228" {...fine} strokeDasharray="6 6" strokeOpacity={0.5} />

      {/* left side of the bike: crank, pedal spindle, wrench, pedal */}
      <path d="M264 122 L204 127 A5 5 0 0 0 204 137 L264 142 A10 10 0 0 0 264 122 Z" {...solid} />
      <circle cx={264} cy={132} r={5} {...fine} />
      <circle cx={204} cy={132} r={2.5} {...fine} />
      <path d="M218 126 Q218 114 210 110 V66 Q210 60 204 60 Q198 60 198 66 V110 Q190 114 190 126" />
      <rect x={184} y={126} width={40} height={12} rx={3} {...tint} />
      <path d="M204 52 A80 80 0 0 1 241.6 61.4" />
      <path d="M236.8 53.2 L241.6 61.4 L232.2 62" />
      {/* the bike seen from that side, front to the left */}
      <path
        d="M278 186 H266 M271 187 L270 192 L243 191 M270 192 L265 212 L241 196 L243 190 L242 185 L234 184 M265 212 L290 210 L270 192 M241 196 L236 210"
        {...fine}
      />
      <circle cx={290} cy={210} r={12} {...fine} />
      <circle cx={236} cy={210} r={12} {...fine} />

      <path d="M134.4 162.6 L118.6 136.3" {...leader} />
      <circle data-callout="1" cx={140} cy={172} r={11} />
      <text x={140} y={172} {...calloutText}>
        1
      </text>
      <path d="M185.6 162.6 L201.4 136.3" {...leader} />
      <circle data-callout="2" cx={180} cy={172} r={11} />
      <text x={180} y={172} {...calloutText}>
        2
      </text>
      <path d="M150 30 L99 51 M170 30 L221 51" {...leader} />
      <circle data-callout="3" cx={160} cy={26} r={11} />
      <text x={160} y={26} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
