import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `chain-wear-checker` — a wear checker laid on a chain seen from the side:
 * its hooked end sits between two rollers, the 0.5 % tab drops into the chain
 * at the other end, and the 0.75 % tab points up, used by flipping the tool.
 */
export function IllChainWearChecker(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="chain-wear-checker" placeholder={false} {...props}>
      {/* chain: link plates and rollers */}
      <rect x={28} y={150} width={264} height={36} rx={18} {...tint} />
      <path d="M28 168 H292" {...fine} strokeOpacity={0.4} />
      <circle cx={50} cy={168} r={9} />
      <circle cx={80} cy={168} r={9} />
      <circle cx={110} cy={168} r={9} />
      <circle cx={140} cy={168} r={9} />
      <circle cx={170} cy={168} r={9} />
      <circle cx={200} cy={168} r={9} />
      <circle cx={230} cy={168} r={9} />
      <circle cx={260} cy={168} r={9} />
      {/* checker: bar, hook end, 0.5 % tab down, 0.75 % tab up */}
      <rect x={58} y={108} width={194} height={16} rx={4} />
      <path d="M62 124 V152 Q64 160 70 158" />
      <path d="M244 124 V158" strokeWidth={4} />
      <path d="M232 108 V78" strokeWidth={4} />

      <path d="M283 158 L247 150" {...leader} />
      <circle data-callout="1" cx={292} cy={140} r={11} />
      <text x={292} y={140} {...calloutText}>
        1
      </text>
      <path d="M277 60 L236 76" {...leader} />
      <circle data-callout="2" cx={288} cy={56} r={11} />
      <text x={288} y={56} {...calloutText}>
        2
      </text>
      <path d="M140 208 V177" {...leader} />
      <circle data-callout="3" cx={140} cy={219} r={11} />
      <text x={140} y={219} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
