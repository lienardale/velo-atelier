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
      <path d="M19.6 94.3Q23 94.7 26.4 94.3M19.6 105.7Q23 105.3 26.4 105.7M63.6 94.3Q67 94.7 70.4 94.3M63.6 105.7Q67 105.3 70.4 105.7M107.6 94.3Q111 94.7 114.4 94.3M107.6 105.7Q111 105.3 114.4 105.7M151.6 94.3Q155 94.7 158.4 94.3M151.6 105.7Q155 105.3 158.4 105.7M175.4 94.4Q177.9 94.6 180.4 94.3M174.8 105.6Q177.6 105.3 180.4 105.7M217.6 94.3Q221 94.7 224.4 94.3M217.6 105.7Q221 105.3 224.4 105.7M261.6 94.3Q265 94.7 268.4 94.3M261.6 105.7Q265 105.3 268.4 105.7M305.6 94.3Q306.8 94.4 308 94.5M305.6 105.7Q306.8 105.6 308 105.5" />
      {/* outer plates on pins 0–1, 2–3, 4–5 and 20–21, 22–23, 24–25 */}
      <path
        d="M34 90.5Q45 96.5 56 90.5A9.5 9.5 0 0 1 56 109.5Q45 103.5 34 109.5A9.5 9.5 0 0 1 34 90.5ZM78 90.5Q89 96.5 100 90.5A9.5 9.5 0 0 1 100 109.5Q89 103.5 78 109.5A9.5 9.5 0 0 1 78 90.5ZM122 90.5Q133 96.5 144 90.5A9.5 9.5 0 0 1 144 109.5Q133 103.5 122 109.5A9.5 9.5 0 0 1 122 90.5ZM188 90.5Q199 96.5 210 90.5A9.5 9.5 0 0 1 210 109.5Q199 103.5 188 109.5A9.5 9.5 0 0 1 188 90.5ZM232 90.5Q243 96.5 254 90.5A9.5 9.5 0 0 1 254 109.5Q243 103.5 232 109.5A9.5 9.5 0 0 1 232 90.5ZM276 90.5Q287 96.5 298 90.5A9.5 9.5 0 0 1 298 109.5Q287 103.5 276 109.5A9.5 9.5 0 0 1 276 90.5Z"
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

      <path d="M26 57 L32 87" {...leader} />
      <circle data-callout="1" cx={24} cy={46} r={11} />
      <text x={24} y={46} {...calloutText}>
        1
      </text>
      <path d="M288 57 L280 87" {...leader} />
      <circle data-callout="2" cx={290} cy={46} r={11} />
      <text x={290} y={46} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
