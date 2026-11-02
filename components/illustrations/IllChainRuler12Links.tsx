import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `chain-ruler-12-links` — a run of chain seen from the side, laid along a
 * steel rule. The rule's zero end sits under the centre of one pin; 12 full
 * links (24 pitches) later, the centre of the 24th pin sits over the 304.8 mm
 * mark. A break in the middle hides pitches 6 to 19, so both ends stay large:
 * pins 0 to 5 on the left, 20 to 25 on the right, at their true places on the
 * rule (10 mm long ticks, 5 mm short ones).
 */
export function IllChainRuler12Links(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="chain-ruler-12-links" placeholder={false} {...props}>
      {/* inner plates, seen between the outer plates */}
      <path d="M17.7 95.2Q23 96 28.3 95.2M17.7 104.8Q23 104 28.3 104.8M61.7 95.2Q67 96 72.3 95.2M61.7 104.8Q67 104 72.3 104.8M105.7 95.2Q111 96 116.3 95.2M105.7 104.8Q111 104 116.3 104.8M149.7 95.2Q155 96 160.3 95.2M149.7 104.8Q155 104 160.3 104.8M175.4 95.6Q178.8 95.7 182.3 95.2M174.9 104.5Q178.6 104.2 182.3 104.8M215.7 95.2Q221 96 226.3 95.2M215.7 104.8Q221 104 226.3 104.8M259.7 95.2Q265 96 270.3 95.2M259.7 104.8Q265 104 270.3 104.8M303.7 95.2Q305.9 95.5 308 95.6M303.7 104.8Q305.9 104.5 308 104.4" />
      {/* outer plates on pins 0–1, 2–3, 4–5 and 20–21, 22–23, 24–25 */}
      <path
        d="M34 92.5Q45 97.5 56 92.5A7.5 7.5 0 0 1 56 107.5Q45 102.5 34 107.5A7.5 7.5 0 0 1 34 92.5ZM78 92.5Q89 97.5 100 92.5A7.5 7.5 0 0 1 100 107.5Q89 102.5 78 107.5A7.5 7.5 0 0 1 78 92.5ZM122 92.5Q133 97.5 144 92.5A7.5 7.5 0 0 1 144 107.5Q133 102.5 122 107.5A7.5 7.5 0 0 1 122 92.5ZM188 92.5Q199 97.5 210 92.5A7.5 7.5 0 0 1 210 107.5Q199 102.5 188 107.5A7.5 7.5 0 0 1 188 92.5ZM232 92.5Q243 97.5 254 92.5A7.5 7.5 0 0 1 254 107.5Q243 102.5 232 107.5A7.5 7.5 0 0 1 232 92.5ZM276 92.5Q287 97.5 298 92.5A7.5 7.5 0 0 1 298 107.5Q287 102.5 276 107.5A7.5 7.5 0 0 1 276 92.5Z"
        {...tint}
      />
      {/* pin heads */}
      <path
        d="M34 100h0M56 100h0M78 100h0M100 100h0M122 100h0M144 100h0M188 100h0M210 100h0M232 100h0M254 100h0M276 100h0M298 100h0"
        strokeWidth={5}
      />
      {/* steel rule, its zero end under pin 0, with 10 mm and 5 mm ticks */}
      <path d="M34 132H161.3L158.6 182H34Z" {...tint} />
      <path d="M173.3 132H308V182H170.6Z" {...tint} stroke="none" />
      <path d="M308 132H173.3L170.6 182H308" />
      <path
        d="M42.7 132v9M51.3 132v16M60 132v9M68.6 132v16M77.3 132v9M86 132v16M94.6 132v9M103.3 132v16M112 132v9M120.6 132v16M129.3 132v9M137.9 132v16M146.6 132v9M155.3 132v16M181.1 132v16M189.7 132v9M198.4 132v16M207.1 132v9M215.7 132v16M224.4 132v9M233 132v16M241.7 132v9M250.4 132v16M259 132v9M267.7 132v16M285 132v16M293.7 132v9M302.3 132v16"
        {...fine}
      />
      {/* the break: pitches 6 to 19 not drawn */}
      <path d="M164 84L158 192M176 84L170 192" {...fine} />
      {/* the centres of pin 0 and pin 24, carried down onto the rule */}
      <path d="M34 106V132M276 106V182" {...fine} strokeDasharray="4 3" />
      <circle cx={34} cy={100} r={5.5} {...fine} />
      <circle cx={276} cy={100} r={5.5} {...fine} />

      <path d="M26 57 L33 90" {...leader} />
      <circle data-callout="1" cx={24} cy={46} r={11} />
      <text x={24} y={46} {...calloutText}>
        1
      </text>
      <path d="M288 57 L279 90" {...leader} />
      <circle data-callout="2" cx={290} cy={46} r={11} />
      <text x={290} y={46} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
