/**
 * Reusable line drawings for the decision-tree illustrations (W2-T4c).
 *
 * Every part is drawn in its own local box — the bike in 300 × 200, the close-up
 * parts in 100 × 100 — and placed with `x`, `y`, `s` (scale). `w` is the stroke
 * width the part should *look* like once scaled, so a part keeps the frame's
 * line weight at any size.
 *
 * `accent` marks the feature the question hinges on (the help text names it);
 * a help drawing and the matching option thumbnail use the same primitive, so
 * the picture in the help panel and the card the visitor clicks agree.
 *
 * Not a registered illustration (the barrel only exports `Ill*.tsx` files).
 */
import { ACCENT, ACCENT_MASK, FAINT, MASK } from "./tree-frame";

type Point = readonly [number, number];

const on = (enabled: boolean) => (enabled ? ACCENT : {});
const onMask = (enabled: boolean) => (enabled ? ACCENT_MASK : MASK);

/** Scale a local drawing into the frame while keeping its apparent stroke width. */
export function Place({
  x,
  y,
  s = 1,
  w = 2,
  children,
}: {
  x: number;
  y: number;
  s?: number;
  w?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} strokeWidth={w / s}>
      {children}
    </g>
  );
}

/** A leader line from a callout to the feature it names. */
export function Leader({ from, to }: { from: Point; to: Point }): React.JSX.Element {
  return <path d={`M${from[0]} ${from[1]} L${to[0]} ${to[1]}`} strokeWidth={1.5} {...FAINT} />;
}

/** An arrow from (x1, y1) to (x2, y2), head included. */
export function Arrow({
  x1,
  y1,
  x2,
  y2,
  accent = true,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  accent?: boolean;
}): React.JSX.Element {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = (turn: number) =>
    `L${(x2 - 6 * Math.cos(angle + turn)).toFixed(1)} ${(y2 - 6 * Math.sin(angle + turn)).toFixed(1)}`;
  return (
    <path
      d={`M${x1} ${y1} L${x2} ${y2} ${head(0.45)} M${x2} ${y2} ${head(-0.45)}`}
      {...on(accent)}
    />
  );
}

/** Circular arc path, angles in degrees, clockwise on screen. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) =>
    `${(cx + r * Math.cos((deg * Math.PI) / 180)).toFixed(1)} ${(cy + r * Math.sin((deg * Math.PI) / 180)).toFixed(1)}`;
  return `M${point(from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

// ── The bike (local box 300 × 200, ground at y ≈ 197) ─────────────────────────

const R = 62;

/** The two axles, in the bike's local box. */
const AXLES = [
  [70, 135],
  [235, 135],
] as const;

export type BikeFeature =
  | "bar"
  | "tires"
  | "fork"
  | "shock"
  | "mudguards"
  | "rack"
  | "battery"
  | "motor"
  | "training-wheel";

export interface BikeProps {
  x: number;
  y: number;
  s: number;
  w?: number;
  bar?: "drop" | "flat" | "riser" | "swept";
  tire?: "thin" | "wide" | "knobby";
  frame?: "diamond" | "step";
  fork?: "rigid" | "suspension";
  rearShock?: boolean;
  mudguards?: boolean;
  rack?: boolean;
  battery?: "integrated" | "external" | "rack";
  motor?: "mid" | "hub";
  trainingWheel?: boolean;
  accent?: readonly BikeFeature[];
}

const BAR_PATHS = {
  drop: "M212 58 L222 50 H232 Q242 50 242 62 Q242 74 232 74 H228",
  flat: "M212 58 L222 50 L210 52",
  riser: "M212 58 L222 50 Q218 40 206 38",
  swept: "M212 58 L222 50 Q222 36 190 40",
} as const;

/** A side-view bicycle silhouette whose parts follow the decision-tree answers. */
export function Bike({
  x,
  y,
  s,
  w = 2,
  bar = "flat",
  tire = "thin",
  frame = "diamond",
  fork = "rigid",
  rearShock = false,
  mudguards = false,
  rack = false,
  battery,
  motor,
  trainingWheel = false,
  accent = [],
}: BikeProps): React.JSX.Element {
  const sw = w / s;
  const hot = (feature: BikeFeature) => on(accent.includes(feature));
  const tires = AXLES.map(([cx, cy]) => (
    <g key={cx} {...hot("tires")}>
      {tire === "knobby" ? (
        <circle cx={cx} cy={cy} r={R + 1} strokeWidth={sw * 2.2} strokeDasharray="3 3" />
      ) : (
        <circle cx={cx} cy={cy} r={R} />
      )}
      <circle cx={cx} cy={cy} r={tire === "thin" ? R - 4 : R - 9} />
      <circle cx={cx} cy={cy} r={3} />
    </g>
  ));

  return (
    <Place x={x} y={y} s={s} w={w}>
      {tires}
      {trainingWheel ? (
        <g {...hot("training-wheel")}>
          <path d="M70 135 L52 183" />
          <circle cx={52} cy={183} r={14} />
        </g>
      ) : null}
      {mudguards ? (
        <g {...hot("mudguards")}>
          <path d={arc(70, 135, R + 7, 190, 330)} />
          <path d={arc(235, 135, R + 7, 205, 345)} />
        </g>
      ) : null}
      {rack ? (
        <g {...hot("rack")}>
          <path d="M128 64 H34 M44 64 L70 135 M92 64 L70 135" />
        </g>
      ) : null}
      {/* chain */}
      <path d="M145 126 L70 128 M145 154 L70 142" {...FAINT} />
      <circle cx={70} cy={135} r={7} />
      {/* frame */}
      {frame === "diamond" ? (
        <path d="M145 140 L128 62 L212 58 L220 88 L145 140 M145 140 L70 135 L128 66" />
      ) : (
        <path d="M220 88 Q170 112 145 140 M216 72 Q158 96 138 104 M145 140 L128 62 M145 140 L70 135 L128 66 M212 58 L220 88" />
      )}
      {fork === "suspension" ? (
        <g {...hot("fork")}>
          <path d="M220 88 L225 104" />
          <rect
            x={-5}
            y={0}
            width={10}
            height={34}
            rx={4}
            transform="translate(226 102) rotate(-18)"
            {...MASK}
          />
        </g>
      ) : (
        <path d="M220 88 Q224 116 235 135" {...hot("fork")} />
      )}
      {rearShock ? (
        <g {...hot("shock")}>
          <rect x={104} y={95} width={30} height={10} rx={4} {...MASK} />
          <path d="M100 100 H104 M134 100 H137" />
        </g>
      ) : null}
      {battery === "external" ? (
        <rect
          x={-26}
          y={-7}
          width={52}
          height={14}
          rx={3}
          transform="translate(176 104) rotate(-34.7)"
          {...onMask(accent.includes("battery"))}
        />
      ) : null}
      {battery === "integrated" ? (
        <g {...hot("battery")}>
          <rect
            x={-40}
            y={-7}
            width={80}
            height={14}
            rx={7}
            transform="translate(182.5 114) rotate(-34.7)"
          />
          <circle cx={170} cy={122.5} r={2.5} />
        </g>
      ) : null}
      {battery === "rack" ? (
        <rect x={44} y={48} width={70} height={12} rx={3} {...onMask(accent.includes("battery"))} />
      ) : null}
      {motor === "mid" ? (
        <path
          d="M128 126 H158 L168 138 V150 L158 160 H134 L124 150 V136 Z"
          {...onMask(accent.includes("motor"))}
        />
      ) : null}
      {motor === "hub" ? (
        <g {...hot("motor")}>
          <circle cx={70} cy={135} r={16} {...MASK} />
          <path d="M82 125 Q100 108 128 92" />
        </g>
      ) : null}
      {/* crank */}
      <circle cx={145} cy={140} r={13} {...MASK} />
      <path d="M145 140 L160 164 M152 164 H168" />
      {/* saddle */}
      <path d="M128 62 L124 46 M106 44 Q122 38 144 45" />
      {/* eslint-disable-next-line security/detect-object-injection -- total lookup keyed by a literal union */}
      <path d={BAR_PATHS[bar]} {...hot("bar")} />
    </Place>
  );
}

// ── Brakes (local box 100 × 100) ─────────────────────────────────────────────

interface PartProps {
  x: number;
  y: number;
  s?: number;
  w?: number;
}

/** The top of a wheel seen from the front: tyre over the rim's two walls. */
function RimFront(): React.JSX.Element {
  return (
    <g {...FAINT}>
      <path d="M42 66 V58 Q42 46 50 46 Q58 46 58 58 V66" />
      <path d="M45 66 V100 M55 66 V100" />
    </g>
  );
}

export function RimCaliperBrake(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <RimFront />
      <path d="M36 84 V62 Q36 30 50 30 Q64 30 64 62 V84" {...ACCENT} />
      <path d="M50 30 V14" />
      <rect x={37} y={76} width={7} height={10} rx={1} />
      <rect x={56} y={76} width={7} height={10} rx={1} />
      <path d="M64 46 Q78 38 78 8" />
    </Place>
  );
}

export function VBrake(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <RimFront />
      <g {...ACCENT}>
        <path d="M30 98 V34 M70 98 V34" />
        <path d="M30 36 H70" />
      </g>
      <path d="M30 36 Q22 36 22 26 Q22 14 34 8" />
      <circle cx={30} cy={96} r={3} />
      <circle cx={70} cy={96} r={3} />
      <path d="M30 80 H37 M70 80 H63" />
      <rect x={37} y={75} width={7} height={10} rx={1} />
      <rect x={56} y={75} width={7} height={10} rx={1} />
    </Place>
  );
}

export function CantileverBrake(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <RimFront />
      <path d="M36 96 L18 64 M64 96 L82 64" />
      <circle cx={36} cy={96} r={3} />
      <circle cx={64} cy={96} r={3} />
      <path d="M18 64 L50 34 L82 64" {...ACCENT} />
      <path d="M50 34 V6" />
      <circle cx={50} cy={34} r={2.5} />
      <path d="M27 80 H37 M73 80 H63" />
      <rect x={37} y={75} width={7} height={10} rx={1} />
      <rect x={56} y={75} width={7} height={10} rx={1} />
    </Place>
  );
}

/** A rotor on its hub with the caliper straddling its edge (side view). */
function DiscRotor(): React.JSX.Element {
  const holes = [0, 60, 120, 180, 240, 300].map((deg) => (
    <circle
      key={deg}
      cx={(48 + 20 * Math.cos((deg * Math.PI) / 180)).toFixed(1)}
      cy={(60 + 20 * Math.sin((deg * Math.PI) / 180)).toFixed(1)}
      r={3}
    />
  ));
  return (
    <g>
      <circle cx={48} cy={60} r={30} />
      <circle cx={48} cy={60} r={9} />
      {holes}
      <rect
        x={-13}
        y={-8}
        width={26}
        height={16}
        rx={4}
        transform="translate(70 38) rotate(45)"
        {...MASK}
      />
    </g>
  );
}

export function DiscMechanicalBrake(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <DiscRotor />
      <circle cx={80} cy={32} r={2.5} />
      <path d="M80 32 L94 40" />
      <g {...ACCENT}>
        <path d="M78 22 Q84 10 98 4" strokeDasharray="5 2" />
        <path d="M78 22 L94 40" strokeWidth={0.6} />
      </g>
    </Place>
  );
}

export function DiscHydraulicBrake(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <DiscRotor />
      <g {...ACCENT}>
        <circle cx={82} cy={24} r={5} {...ACCENT_MASK} />
        <circle cx={82} cy={24} r={1.5} />
        <path d="M86 20 Q92 10 100 6" />
      </g>
    </Place>
  );
}

// ── Handlebars (local box 100 × 100) ─────────────────────────────────────────

/** Stem and steerer seen from the front. */
function StemFront(): React.JSX.Element {
  return (
    <g>
      <path d="M50 52 V96" {...FAINT} />
      <rect x={44} y={38} width={12} height={14} rx={2} {...MASK} />
    </g>
  );
}

export function DropBar(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M14 44 H86" />
      <path d="M14 44 Q4 44 4 58 Q4 80 16 88 M86 44 Q96 44 96 58 Q96 80 84 88" {...ACCENT} />
      <StemFront />
    </Place>
  );
}

export function FlatBar(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M4 44 H96" {...ACCENT} />
      <rect x={4} y={39} width={16} height={10} rx={3} {...MASK} />
      <rect x={80} y={39} width={16} height={10} rx={3} {...MASK} />
      <StemFront />
    </Place>
  );
}

export function RiserBar(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M6 20 Q20 20 30 34 Q38 44 50 44 Q62 44 70 34 Q80 20 94 20" {...ACCENT} />
      <rect x={2} y={15} width={14} height={10} rx={3} {...MASK} />
      <rect x={84} y={15} width={14} height={10} rx={3} {...MASK} />
      <StemFront />
    </Place>
  );
}

/** Seen from above: the bar sweeps back toward the rider (bottom of the box). */
export function SweptBar(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M50 4 V30" {...FAINT} />
      <path d="M50 38 Q16 38 10 70 Q8 82 18 92 M50 38 Q84 38 90 70 Q92 82 82 92" {...ACCENT} />
      <rect x={44} y={24} width={12} height={16} rx={2} {...MASK} />
      <path d="M14 96 L20 88 M86 96 L80 88" strokeWidth={6} />
    </Place>
  );
}

// ── Shifters (local box 100 × 100) ───────────────────────────────────────────

export function StiShifter(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 40 H38 Q70 40 70 64 Q70 88 44 88 H34" {...FAINT} />
      <path d="M40 40 Q50 20 64 26 Q70 34 62 50 Z" {...MASK} />
      <path d="M62 34 Q82 60 72 94" {...ACCENT} />
      <Arrow x1={76} y1={72} x2={94} y2={66} />
      <Arrow x1={76} y1={72} x2={58} y2={78} />
    </Place>
  );
}

export function TriggerShifter(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 40 H100" {...FAINT} />
      <rect x={66} y={34} width={32} height={12} rx={4} {...MASK} />
      <path d="M60 36 Q70 20 96 22" {...FAINT} />
      <rect x={36} y={44} width={24} height={14} rx={3} {...MASK} />
      <path d="M42 58 L34 80 M56 58 L52 76" {...ACCENT} />
    </Place>
  );
}

export function GripShifter(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 54 H100" {...FAINT} />
      <rect x={72} y={46} width={26} height={16} rx={5} {...MASK} />
      <g {...ACCENT}>
        <rect x={50} y={42} width={20} height={24} rx={4} {...ACCENT_MASK} />
        <path d="M56 44 V64 M60 44 V64 M64 44 V64" />
      </g>
      <path d="M46 32 Q60 20 74 32" />
      <path d="M74 32 L66 32 M74 32 L73 24" />
    </Place>
  );
}

export function ThumbShifter(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 64 H100" {...FAINT} />
      <rect x={70} y={56} width={28} height={16} rx={5} {...MASK} />
      <rect x={42} y={56} width={16} height={16} rx={3} {...MASK} />
      <g {...ACCENT}>
        <path d="M50 56 L36 32" />
        <circle cx={35} cy={30} r={4} {...ACCENT_MASK} />
      </g>
      <Arrow x1={30} y1={18} x2={52} y2={16} accent={false} />
    </Place>
  );
}

export function BarEndShifter(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 30 H30 Q62 30 62 54 Q62 78 36 78 H26" {...FAINT} />
      <rect x={18} y={73} width={8} height={10} rx={2} {...MASK} />
      <g {...ACCENT}>
        <path d="M18 80 L4 92" />
        <circle cx={4} cy={92} r={3.5} {...ACCENT_MASK} />
      </g>
    </Place>
  );
}

export function ElectronicShifter(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 40 H38 Q70 40 70 64 Q70 88 44 88 H34" {...FAINT} />
      <path d="M40 40 Q50 20 64 26 Q70 34 62 50 Z" {...MASK} />
      <path d="M62 34 Q80 60 72 94" />
      <g {...ACCENT}>
        <circle cx={76} cy={52} r={4} {...ACCENT_MASK} />
        <circle cx={80} cy={66} r={4} {...ACCENT_MASK} />
        <path d="M84 18 Q90 24 84 30 M90 12 Q100 24 90 36" />
      </g>
      <rect x={6} y={58} width={18} height={30} rx={3} />
      <path d="M11 58 V54 H19 V58 M11 70 H19 M15 66 V74" />
    </Place>
  );
}

// ── Pedals, seen from above (local box 100 × 100; crank arm on the left) ─────

function Spindle(): React.JSX.Element {
  return <path d="M0 50 H30" strokeWidth={5} {...FAINT} />;
}

export function FlatPedal(props: PartProps): React.JSX.Element {
  const pins = [
    [38, 30],
    [60, 30],
    [82, 30],
    [38, 70],
    [60, 70],
    [82, 70],
  ].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.5} {...ACCENT} />);
  return (
    <Place {...props}>
      <Spindle />
      <rect x={30} y={20} width={62} height={60} rx={8} {...MASK} />
      {pins}
    </Place>
  );
}

export function SpdPedal(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <Spindle />
      <rect x={30} y={34} width={56} height={32} rx={10} {...MASK} />
      <rect x={48} y={42} width={20} height={16} rx={2} {...ACCENT} />
      <g {...ACCENT}>
        <rect x={46} y={4} width={24} height={16} rx={3} />
        <circle cx={53} cy={12} r={2} />
        <circle cx={63} cy={12} r={2} />
      </g>
    </Place>
  );
}

export function RoadPedal(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <Spindle />
      <path d="M30 32 L88 38 V62 L30 68 Z" {...MASK} />
      <g {...ACCENT}>
        <path d="M44 16 L90 50 L44 84 Z" {...ACCENT_MASK} />
        <circle cx={52} cy={36} r={2.5} />
        <circle cx={52} cy={64} r={2.5} />
        <circle cx={74} cy={50} r={2.5} />
      </g>
    </Place>
  );
}

/** Side view: the cage and strap rise above the pedal body. */
export function ToeClipPedal(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M0 64 H30" strokeWidth={5} {...FAINT} />
      <rect x={30} y={58} width={58} height={12} rx={3} {...MASK} />
      <g {...ACCENT}>
        <path d="M88 62 Q102 34 70 26 Q42 22 36 58" />
        <path d="M58 24 L64 60" strokeWidth={4} />
      </g>
    </Place>
  );
}

export function ComboPedal(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <Spindle />
      <rect x={30} y={20} width={62} height={60} rx={8} {...MASK} />
      <path d="M30 80 L92 20" {...ACCENT} />
      <circle cx={40} cy={30} r={2.5} />
      <circle cx={56} cy={30} r={2.5} />
      <circle cx={40} cy={46} r={2.5} />
      <rect x={64} y={52} width={18} height={16} rx={2} {...ACCENT} />
    </Place>
  );
}

// ── Drivetrain (local box 100 × 100) ─────────────────────────────────────────

const RING_RADII = { 1: [32], 2: [36, 26], 3: [38, 30, 22] } as const;

/** A crankset seen from the drive side, with one, two or three chainrings. */
export function Crankset({
  rings,
  frontDerailleur = false,
  ...props
}: PartProps & { rings: 1 | 2 | 3; frontDerailleur?: boolean }): React.JSX.Element {
  return (
    <Place {...props}>
      {/* eslint-disable-next-line security/detect-object-injection -- total lookup keyed by a literal union */}
      {RING_RADII[rings].map((r, index) => (
        <circle
          key={r}
          cx={50}
          cy={54}
          r={r}
          strokeDasharray={index === 0 ? "3 2" : undefined}
          {...ACCENT}
        />
      ))}
      <path d="M50 54 L50 36 M50 54 L66 60 M50 54 L34 60" {...FAINT} />
      <path d="M50 54 L70 94 M62 94 H80" />
      <circle cx={50} cy={54} r={5} {...MASK} />
      {frontDerailleur ? <path d="M60 4 H80 L76 18 H58 Z M70 4 V0" {...MASK} /> : null}
    </Place>
  );
}

/** An internal-gear hub: a fat smooth shell carrying a single sprocket. */
export function GearHub(props: PartProps): React.JSX.Element {
  const spokes = [20, 65, 110, 155, 200, 245, 290, 335].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return (
      <path
        key={deg}
        d={`M${(50 + 16 * Math.cos(rad)).toFixed(1)} ${(50 + 16 * Math.sin(rad)).toFixed(1)} L${(50 + 48 * Math.cos(rad)).toFixed(1)} ${(50 + 48 * Math.sin(rad)).toFixed(1)}`}
        {...FAINT}
      />
    );
  });
  return (
    <Place {...props}>
      {spokes}
      <circle cx={50} cy={50} r={24} strokeDasharray="3 2" />
      <circle cx={50} cy={50} r={16} {...ACCENT_MASK} />
      <circle cx={50} cy={50} r={3} {...ACCENT} />
      <path d="M62 60 Q80 74 98 70" />
    </Place>
  );
}

/** One chainring, one sprocket, one chain loop — and no derailleur. */
export function SingleSpeed(props: PartProps): React.JSX.Element {
  return (
    <Place {...props}>
      <path d="M26 36 L84 49 M26 84 L84 71" {...FAINT} />
      <circle cx={26} cy={60} r={24} strokeDasharray="3 2" {...ACCENT_MASK} />
      <circle cx={26} cy={60} r={4} />
      <circle cx={84} cy={60} r={11} strokeDasharray="3 2" {...ACCENT_MASK} />
      <circle cx={84} cy={60} r={3} />
    </Place>
  );
}

// ── Wheels (local box 120 × 120) ─────────────────────────────────────────────

/** A wheel whose rim is drawn to scale (ETRTO bead-seat diameter), number underneath. */
export function SizedWheel({
  etrto,
  tire,
}: {
  etrto: number;
  tire: "thin" | "wide" | "knobby";
}): React.JSX.Element {
  const rim = (etrto / 622) * 38;
  const width = tire === "thin" ? 4 : 8;
  return (
    <g>
      <circle cx={60} cy={52} r={48} strokeWidth={1.5} strokeDasharray="4 4" {...FAINT} />
      {tire === "knobby" ? (
        <circle cx={60} cy={52} r={rim + width} strokeWidth={5} strokeDasharray="3 3" />
      ) : (
        <circle cx={60} cy={52} r={rim + width} />
      )}
      <circle cx={60} cy={52} r={rim} {...ACCENT} />
      <circle cx={60} cy={52} r={3} />
      <path
        d={`M60 ${52 - rim} V${52 + rim} M${60 - rim} 52 H${60 + rim}`}
        strokeWidth={1.5}
        {...FAINT}
      />
      <text
        x={60}
        y={110}
        fontSize={15}
        fontWeight={600}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        stroke="none"
        fontFamily="ui-monospace, monospace"
        aria-hidden="true"
      >
        {etrto}
      </text>
    </g>
  );
}
