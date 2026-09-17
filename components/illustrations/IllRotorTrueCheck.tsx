import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `rotor-true-check` — looking down into the caliper slot: the rotor runs
 * between two pads with an even gap on each side; an inset shows the minimum
 * thickness engraved on the rotor.
 */
export function IllRotorTrueCheck(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="rotor-true-check" placeholder={false} {...props}>
      {/* caliper body */}
      <rect x={104} y={58} width={112} height={124} rx={14} />
      {/* pads */}
      <rect x={134} y={78} width={14} height={84} rx={2} {...tint} />
      <rect x={172} y={78} width={14} height={84} rx={2} {...tint} />
      {/* rotor, edge-on */}
      <rect x={156} y={18} width={8} height={204} rx={2} />
      {/* even gaps */}
      <path d="M148 120 H156 M164 120 H172" {...fine} />

      {/* inset: rotor face with engraved marking */}
      <rect x={228} y={176} width={76} height={50} rx={8} {...tint} />
      <path d="M240 194 H270 M240 204 H292 M240 214 H262" {...fine} />
      <circle cx={288} cy={192} r={5} {...fine} />

      <path d="M61 45 L150 118" {...leader} />
      <circle data-callout="1" cx={52} cy={38} r={11} />
      <text x={52} y={38} {...calloutText}>
        1
      </text>
      <path d="M257 32 H164" {...leader} />
      <circle data-callout="2" cx={268} cy={32} r={11} />
      <text x={268} y={32} {...calloutText}>
        2
      </text>
      <path d="M266 150 V176" {...leader} />
      <circle data-callout="3" cx={266} cy={139} r={11} />
      <text x={266} y={139} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
