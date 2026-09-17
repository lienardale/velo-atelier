import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `axle-qr-vs-thru` — the two ways a wheel is held: on the left a quick
 * release (thin skewer, cam lever at one end, nut at the other); on the right
 * a thru-axle (thick threaded axle with a folding lever).
 */
export function IllAxleQrVsThru(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="axle-qr-vs-thru" placeholder={false} {...props}>
      {/* quick release: skewer, cam lever, adjusting nut */}
      <path d="M40 132 H136" />
      <rect x={24} y={120} width={16} height={24} rx={4} {...solid} />
      <path d="M32 120 Q26 84 44 60 L54 64 Q44 90 40 120" {...tint} />
      <rect x={136} y={122} width={14} height={20} rx={3} />
      <path d="M139 122 V142 M143 122 V142 M147 122 V142" {...fine} />
      {/* hub stub between the dropouts */}
      <rect x={66} y={122} width={48} height={20} rx={4} {...tint} />

      <path d="M160 40 V210" {...fine} strokeDasharray="6 6" strokeOpacity={0.5} />

      {/* thru-axle: head, folding lever, shaft, thread */}
      <rect x={180} y={116} width={18} height={32} rx={4} {...solid} />
      <path d="M189 116 L204 70 H216 L200 116" {...tint} />
      <rect x={198} y={122} width={96} height={20} rx={3} />
      <path d="M262 122 L256 142 M270 122 L264 142 M278 122 L272 142 M286 122 L280 142" {...fine} />
      <rect x={216} y={116} width={40} height={32} rx={4} {...tint} />

      <path d="M49 51 L44 64" {...leader} />
      <circle data-callout="1" cx={52} cy={40} r={11} />
      <text x={52} y={40} {...calloutText}>
        1
      </text>
      <path d="M270 188 L270 144" {...leader} />
      <circle data-callout="2" cx={270} cy={199} r={11} />
      <text x={270} y={199} {...calloutText}>
        2
      </text>
    </GuideIllustrationFrame>
  );
}
