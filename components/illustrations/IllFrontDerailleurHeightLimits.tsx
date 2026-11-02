import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `front-derailleur-height-limits` — a front derailleur seen from the drive
 * side, the front of the bike to the right, clamped on the seat tube above a
 * double crankset: the two limit screws on top of its body (the one nearer
 * the seat tube is L, the inner stop; the other is H, the outer stop), the
 * outer cage plate following the big chainring just above it, and the small
 * gap between the plate's bottom edge and the tips of the teeth.
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
      <path d="M166 84 L171 94.6 M196 84 L205 96.6" strokeWidth={4} />
      {/* limit screws: L nearer the seat tube, H beyond it */}
      <path d="M165 52 V58 M171 52 V58 M186 52 V58 M192 52 V58" {...fine} />
      <rect x={162} y={44} width={12} height={8} rx={2} {...solid} />
      <rect x={183} y={44} width={12} height={8} rx={2} {...solid} />
      {/* outer cage plate, parallel to the big chainring */}
      <path
        d="M171.5 110.6 A86 86 0 0 1 242.8 135.2 L254.1 123.9 A102 102 0 0 0 169.6 94.8 Z"
        {...tint}
      />
      <circle cx={238.6} cy={120.9} r={2} {...fine} />
      <circle cx={183.6} cy={102} r={2} {...fine} />
      {/* gap between the plate and the teeth */}
      <path d="M242.8 135.2 A86 86 0 0 1 251.6 145.5" {...fine} strokeDasharray="2 2" />
      <path
        d="M241.1 148.2 L248.8 141.9 M238 144.3 L244.2 152.1 M245.7 138 L251.9 145.8"
        {...fine}
      />

      <path d="M166 33 L167 43" {...leader} />
      <circle data-callout="1" cx={164} cy={22} r={11} />
      <text x={164} y={22} {...calloutText}>
        1
      </text>
      <path d="M197 33 L191 43" {...leader} />
      <circle data-callout="2" cx={200} cy={22} r={11} />
      <text x={200} y={22} {...calloutText}>
        2
      </text>
      <path d="M285 141 L250 144.5" {...leader} />
      <circle data-callout="3" cx={296} cy={140} r={11} />
      <text x={296} y={140} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
