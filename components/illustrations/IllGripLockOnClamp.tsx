import { calloutText, GuideIllustrationFrame } from "./guide-frame";
import { fine, leader, solid, tint } from "./guide-shapes";
import type { IllustrationProps } from "./placeholder";

/**
 * `grip-lock-on-clamp` — the end of a flat handlebar seen from the side, the
 * stem and brake lever off to the left: the lock-on grip's inner lock ring
 * with its single clamp bolt, the ribbed rubber grip, and the bar-end plug
 * closing the end of the bar.
 */
export function IllGripLockOnClamp(props: IllustrationProps) {
  return (
    <GuideIllustrationFrame id="grip-lock-on-clamp" placeholder={false} {...props}>
      {/* handlebar, coming from the stem */}
      <path d="M14 114 H94 M14 142 H94" />
      {/* lock ring and its bolt */}
      <rect x={94} y={100} width={28} height={56} rx={4} />
      <path d="M108 100 V117 M108 139 V156" {...fine} />
      <circle cx={108} cy={128} r={8} {...solid} />
      <path d="M112 128 L110 131.5 H106 L104 128 L106 124.5 H110 Z" {...fine} />
      {/* rubber grip */}
      <path d="M122 104 H256 Q268 104 268 116 V140 Q268 152 256 152 H122 Z" {...tint} />
      <path
        d="M136 110 V146 M148 110 V146 M160 110 V146 M172 110 V146 M184 110 V146 M196 110 V146 M208 110 V146 M220 110 V146 M232 110 V146 M244 110 V146 M256 110 V146"
        {...fine}
        strokeOpacity={0.45}
      />
      {/* bar-end plug */}
      <rect x={268} y={109} width={10} height={38} rx={3} {...solid} />

      <path d="M108 75 V119" {...leader} />
      <circle data-callout="1" cx={108} cy={64} r={11} />
      <text x={108} y={64} {...calloutText}>
        1
      </text>
      <path d="M196 75 V104" {...leader} />
      <circle data-callout="2" cx={196} cy={64} r={11} />
      <text x={196} y={64} {...calloutText}>
        2
      </text>
      <path d="M273 183 V148" {...leader} />
      <circle data-callout="3" cx={273} cy={194} r={11} />
      <text x={273} y={194} {...calloutText}>
        3
      </text>
    </GuideIllustrationFrame>
  );
}
