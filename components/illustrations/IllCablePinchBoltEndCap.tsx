import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `cable-pinch-bolt-end-cap` — a cable anchor seen face-on, generic enough
 * for a brake arm or a derailleur: the inner cable comes in from the left
 * along the arm, lies in its groove under the washer of the pinch bolt, runs
 * on a short length past it and ends in a crimped end cap. The dimension
 * gives that length past the bolt.
 */
export function IllCablePinchBoltEndCap(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="cable-pinch-bolt-end-cap" placeholder={false} {...props}>
      {/* the arm, running off to the left */}
      <path d="M14 78 H128 A34 34 0 0 1 128 146 H14" {...tint} />
      {/* groove under the washer */}
      <rect x={94} y={124} width={60} height={14} rx={3} {...solid} />
      {/* inner cable: in, under the washer, out, end cap */}
      <path d="M14 131 H112 M144 131 H238" strokeWidth={3} />
      <rect x={236} y={125} width={24} height={12} rx={3} {...solid} />
      <path d="M245 125 V137 M251 125 V137" {...fine} />
      {/* washer and hex-socket pinch bolt */}
      <circle cx={128} cy={112} r={24} {...tint} />
      <path
        d="M141 112 L134.5 123.3 L121.5 123.3 L115 112 L121.5 100.7 L134.5 100.7 Z"
        {...solid}
      />
      <path d="M132.3 114.5 L128 117 L123.7 114.5 L123.7 109.5 L128 107 L132.3 109.5 Z" {...fine} />
      {/* length left past the bolt */}
      <path d="M144 141 V182 M260 141 V182" {...fine} />
      <path d="M147 176 H257" {...fine} />
      <path d="M144 176 L152 172 V180 Z M260 176 L252 172 V180 Z" {...solid} />

      <path d="M128 41 V97" {...leader} />
      <circle data-callout="1" cx={128} cy={30} r={11} />
      <text x={128} y={30} {...calloutText}>
        1
      </text>
      <path d="M202 199 V180" {...leader} />
      <circle data-callout="2" cx={202} cy={210} r={11} />
      <text x={202} y={210} {...calloutText}>
        2
      </text>
      <path d="M270 77 L254 123" {...leader} />
      <circle data-callout="3" cx={274} cy={66} r={11} />
      <text x={274} y={66} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
