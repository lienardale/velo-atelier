import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `front-derailleur-height-limits` — a front derailleur seen from the drive
 * side, the front of the bike to the right, clamped on the seat tube above a
 * double crankset: the two limit screws on top of its body (one callout for
 * both, because which one is L and which is H varies from model to model:
 * the letter engraved beside each is what counts), and the outer cage plate
 * following the big chainring with a small gap between its bottom edge and
 * the tips of the teeth.
 */
export function IllFrontDerailleurHeightLimits(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="front-derailleur-height-limits" placeholder={false} {...props}>
      {/* seat tube and chainstay, behind the chainrings */}
      <path d="M169.3 119.4 L139.4 20.8 M150.1 125.2 L120.2 26.6" />
      <path d="M108 190 L14 182 M108 202 L14 194" />
      {/* chainrings: big and small, their teeth, the spider and its bolts, the crank */}
      <path d="M114.4 226 A74 74 0 1 1 249.6 226" strokeWidth={4} strokeDasharray="2.5 2.5" />
      <path d="M123.2 226 A66 66 0 1 1 240.8 226" {...fine} />
      <path d="M139.5 226 A52 52 0 1 1 224.5 226" strokeWidth={3} strokeDasharray="2 2" />
      <path d="M148.5 226 A45 45 0 1 1 215.5 226" {...fine} />
      <path
        d="M176.5 186.5 L160 157.9 M187.5 186.5 L204 157.9 M171.2 194.1 L138.7 188.4 M192.8 194.1 L225.3 188.4"
        {...fine}
      />
      <circle cx={161} cy={159.6} r={2.5} {...fine} />
      <circle cx={203} cy={159.6} r={2.5} {...fine} />
      <circle cx={140.6} cy={188.7} r={2.5} {...fine} />
      <circle cx={223.4} cy={188.7} r={2.5} {...fine} />
      <path d="M178.9 204.5 L242 224.2 A6 6 0 0 0 246.1 212.9 L185.1 187.5 Z" {...solid} />
      <circle cx={182} cy={196} r={10} />
      {/* clamp, body, linkage */}
      <path d="M155.4 70.3 L134.4 76.7 L129.2 59.5 L150.2 53.1 Z" {...solid} />
      <rect x={154} y={58} width={50} height={26} rx={5} />
      <path d="M166 84 L171 98.6 M196 84 L205 100.7" strokeWidth={4} />
      {/* the two limit screws: which is L and which is H is engraved beside them */}
      <path d="M161 52 V58 M167 52 V58 M191 52 V58 M197 52 V58" {...fine} />
      <rect x={158} y={44} width={12} height={8} rx={2} {...solid} />
      <rect x={188} y={44} width={12} height={8} rx={2} {...solid} />
      {/* outer cage plate, parallel to the big chainring */}
      <path d="M172 114.6 A82 82 0 0 1 240 138 L251.3 126.7 A98 98 0 0 0 170.1 98.7 Z" {...tint} />
      <circle cx={234.9} cy={123.2} r={2} {...fine} />
      <circle cx={183.6} cy={106} r={2} {...fine} />
      {/* the small gap between the plate's bottom edge and the teeth */}
      <path
        d="M228 134.9 L230.7 131.3 M225.6 133.1 L230.4 136.7 M228.3 129.5 L233.1 133.1"
        {...fine}
      />

      <path d="M172 28 L166 43 M186 28 L192 43" {...leader} />
      <circle data-callout="1" cx={179} cy={20} r={11} />
      <text x={179} y={20} {...calloutText}>
        1
      </text>
      <path d="M282.5 164.4 L231 134" {...leader} />
      <circle data-callout="2" cx={292} cy={170} r={11} />
      <text x={292} y={170} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
