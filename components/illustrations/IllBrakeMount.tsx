import type { IllustrationProps } from "./placeholder";
import {
  ACCENT,
  calloutCircle,
  calloutDigit,
  FAINT,
  MASK,
  TreeIllustrationFrame,
} from "./tree-frame";
import { Arrow, Leader, Place } from "./tree-parts";

/**
 * `ill-brake-mount` — help drawing (W2-T4c): the three disc-caliper mounts from the side, with arrows for the direction the
 * bolts go in: from below (flat mount), vertically from above (post mount),
 * horizontally through two tabs with an adapter (IS).
 *
 * Numbered callouts, one literal `data-callout` per
 * `illustrations.ill-brake-mount.callouts.<n>` key; the legend under the drawing reads
 * those keys.
 */
export function IllBrakeMount(props: IllustrationProps) {
  return (
    <TreeIllustrationFrame id="ill-brake-mount" {...props}>
      <Place x={8} y={50} s={0.92}>
        <path d="M4 40 Q50 14 96 40" {...FAINT} />
        <rect x={24} y={34} width={52} height={22} rx={5} {...MASK} />
        <rect x={0} y={56} width={100} height={12} rx={6} {...MASK} />
        <path d="M38 92 V46 M62 92 V46 M32 92 H44 M56 92 H68" {...ACCENT} />
        <Arrow x1={38} y1={114} x2={38} y2={98} />
        <Arrow x1={62} y1={114} x2={62} y2={98} />
      </Place>
      <Place x={114} y={50} s={0.92}>
        <path d="M4 60 Q50 34 96 60" {...FAINT} />
        <rect x={0} y={92} width={100} height={12} rx={6} />
        <rect x={26} y={72} width={16} height={20} />
        <rect x={58} y={72} width={16} height={20} />
        <rect x={20} y={44} width={60} height={28} rx={5} {...MASK} />
        <path d="M34 30 V84 M66 30 V84 M28 30 H40 M60 30 H72" {...ACCENT} />
        <Arrow x1={34} y1={4} x2={34} y2={22} />
        <Arrow x1={66} y1={4} x2={66} y2={22} />
      </Place>
      <Place x={220} y={50} s={0.92}>
        <rect x={0} y={96} width={100} height={12} rx={6} />
        <rect x={22} y={70} width={14} height={26} rx={3} {...MASK} />
        <rect x={64} y={70} width={14} height={26} rx={3} {...MASK} />
        <rect x={14} y={56} width={72} height={14} rx={3} {...MASK} />
        <rect x={20} y={28} width={60} height={28} rx={5} {...MASK} />
        <path d="M10 83 H46 M54 83 H90 M10 78 V88 M90 78 V88" {...ACCENT} />
        <Arrow x1={20} y1={116} x2={42} y2={116} />
        <Arrow x1={80} y1={116} x2={58} y2={116} />
      </Place>
      <Leader from={[50, 190]} to={[40, 156]} />
      <circle data-callout="1" cx={50} cy={190} {...calloutCircle} />
      <text x={50} y={190} {...calloutDigit}>
        1
      </text>
      <Leader from={[156, 26]} to={[146, 52]} />
      <circle data-callout="2" cx={156} cy={26} {...calloutCircle} />
      <text x={156} y={26} {...calloutDigit}>
        2
      </text>
      <Leader from={[270, 190]} to={[270, 162]} />
      <circle data-callout="3" cx={270} cy={190} {...calloutCircle} />
      <text x={270} y={190} {...calloutDigit}>
        3
      </text>
    </TreeIllustrationFrame>
  );
}
