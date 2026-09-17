/**
 * Geometry solver (§3.2) — `SolverInput` → `BikeAnchors`. Pure, no three.js.
 *
 * Units metres; origin = BB; +X forward, +Y up, +Z rider's left; drive side −Z.
 *
 *   axles        from wheelbase / chainstay / bbDrop (axles sit bbDrop above the BB)
 *   steering     head angle → `steerDown` (along the axis, towards the fork) and
 *                `steerForward` (perpendicular, forward)
 *   fork crown   frontAxle − AC·down − rake·forward (AC grows with suspension travel)
 *   head tube    headBottom = crown − 0.012·down; headTop = headBottom − HTL·down;
 *                topTubeFront = headTop + 0.02·down
 *   step-through no top tube; the down tube meets the seat tube at 40 % of its height
 *   wheels       rimRadius = etrto / 2000; wheelRadius = rimRadius + tyre width
 *   drivetrain   r(T) = 0.0127 / (2·sin(π/T)); cog i (0 = largest, nearest the spokes)
 *                at z = −(0.0335 + i·pitch); displayed cog = floor(n / 2); the chain is
 *                the two external tangents in XY with z interpolated
 *   rotors       plane at axle + [0, 0, +0.03]
 *
 * It throws ONLY when an anchor would not be finite (`chainstay < bbDrop`,
 * `AC < rake`) — never because a row disagrees with a catalogue; those checks
 * are soft expectations in the tests and a table in `npm run geom:report`.
 */
import type { BikeBuild } from "@/lib/domain";

import { cassetteTeeth, chainringTeeth, openChainLength, pitchRadius } from "./cassettes";
import { geometryRowFor } from "./geometry-table";
import type {
  BikeAnchors,
  FrameGeometryRow,
  SolverAttributes,
  SolverInput,
  Sprocket,
  Vec3,
  WheelAnchors,
} from "./types";
import { add, isFiniteVec, lerp, scale, sub } from "./vec";

export class SolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverError";
  }
}

const DEG = Math.PI / 180;

/** Cog spacing along the axle, metres. */
export function cogPitch(speeds: number): number {
  if (speeds >= 12) return 0.00375;
  if (speeds >= 11) return 0.0039;
  if (speeds >= 9) return 0.0043;
  return 0.0048;
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The build attributes the solver reads (§3.1), with anything malformed dropped. */
export function solverAttributes(build: BikeBuild): SolverAttributes {
  const attrs = (partId: string) =>
    build.parts.find((part) => part.partId === partId)?.attributes ?? {};
  const enumNumber = (value: unknown) => num(typeof value === "string" ? Number(value) : value);
  return {
    rotorFrontMm: enumNumber(attrs("rotor-front").diameter),
    rotorRearMm: enumNumber(attrs("rotor-rear").diameter),
    cassetteSpeeds: enumNumber(attrs("cassette").speeds),
    cassetteRange: str(attrs("cassette").range),
    chainringTeeth: num(attrs("chainring").teeth),
    forkTravelMm: num(attrs("fork")["travel-mm"]),
    tireFrontWidthMm: num(attrs("tire-front")["etrto-width"]),
    tireRearWidthMm: num(attrs("tire-rear")["etrto-width"]),
  };
}

export function solverInputFor(
  build: BikeBuild,
  fit?: { saddleHeightMm?: number } | null,
): SolverInput {
  return { spec: build.spec, attributes: solverAttributes(build), fit: fit ?? null };
}

function defaultChainringTeeth(input: SolverInput): number {
  const { spec } = input;
  if (spec.discipline === "mtb" || spec.discipline === "kids") return 32;
  if (spec.drivetrain.chainrings === 2) return 50;
  if (spec.drivetrain.chainrings === 3) return 44;
  if (spec.discipline === "gravel") return 40;
  return 38;
}

function wheel(axle: Vec3, etrto: number, tireWidth: number, hubRadius: number): WheelAnchors {
  const rimRadius = etrto / 2000;
  return { axle, rimRadius, tireWidth, wheelRadius: rimRadius + tireWidth, hubRadius };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The chain as a closed polyline: two external tangents and the two wraps. */
export function chainPath(ring: Sprocket, cog: Sprocket, samples = 12): Vec3[] {
  const dx = cog.center[0] - ring.center[0];
  const dy = cog.center[1] - ring.center[1];
  const distance = Math.hypot(dx, dy);
  const u: [number, number] = [dx / distance, dy / distance];
  // "Up" normal of the ring → cog direction (u points backwards, so this points up).
  const up: [number, number] = [-u[1], u[0]];
  if (up[1] < 0) {
    up[0] = -up[0];
    up[1] = -up[1];
  }
  const sinPhi = (ring.pitchRadius - cog.pitchRadius) / distance;
  const cosPhi = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi));
  const top: [number, number] = [sinPhi * u[0] + cosPhi * up[0], sinPhi * u[1] + cosPhi * up[1]];
  const bottom: [number, number] = [sinPhi * u[0] - cosPhi * up[0], sinPhi * u[1] - cosPhi * up[1]];

  const arc = (
    s: Sprocket,
    from: [number, number],
    to: [number, number],
    via: [number, number],
  ) => {
    const a0 = Math.atan2(from[1], from[0]);
    let a1 = Math.atan2(to[1], to[0]);
    const av = Math.atan2(via[1], via[0]);
    // Pick the sweep direction that passes through `via`.
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const ccw = norm(av - a0) < norm(a1 - a0);
    a1 = ccw ? a0 + norm(a1 - a0) : a0 - norm(a0 - a1);
    const points: Vec3[] = [];
    for (let i = 0; i <= samples; i++) {
      const a = a0 + ((a1 - a0) * i) / samples;
      points.push([
        s.center[0] + s.pitchRadius * Math.cos(a),
        s.center[1] + s.pitchRadius * Math.sin(a),
        s.center[2],
      ]);
    }
    return points;
  };

  // top run ring → cog, wrap round the back of the cog, bottom run back, wrap the ring.
  const cogWrap = arc(cog, top, bottom, u);
  const ringWrap = arc(ring, bottom, top, [-u[0], -u[1]]);
  return [...cogWrap, ...ringWrap];
}

/** Stack and reach of a frame: head-tube top relative to the BB. */
export function stackReach(headTop: Vec3, bb: Vec3 = [0, 0, 0]): { stack: number; reach: number } {
  return { stack: headTop[1] - bb[1], reach: headTop[0] - bb[0] };
}

export function solveRow(row: FrameGeometryRow, input: SolverInput): BikeAnchors {
  const { spec, attributes } = input;

  if (!(row.chainstay > row.bbDrop)) {
    throw new SolverError(`chainstay (${row.chainstay}) must exceed bbDrop (${row.bbDrop})`);
  }
  const travelMm = spec.suspension.front ? (attributes.forkTravelMm ?? 100) : 0;
  const axleToCrown = row.forkAxleToCrown - row.forkTravelIncludedMm / 1000 + travelMm / 1000;
  if (!(axleToCrown > row.forkRake)) {
    throw new SolverError(`axle-to-crown (${axleToCrown}) must exceed rake (${row.forkRake})`);
  }

  const bb: Vec3 = [0, 0, 0];
  const rearAxle: Vec3 = [-Math.sqrt(row.chainstay ** 2 - row.bbDrop ** 2), row.bbDrop, 0];
  const frontAxle: Vec3 = [rearAxle[0] + row.wheelbase, row.bbDrop, 0];

  const ha = row.headAngleDeg * DEG;
  const steerDown: Vec3 = [Math.cos(ha), -Math.sin(ha), 0];
  const steerForward: Vec3 = [Math.sin(ha), Math.cos(ha), 0];

  const forkCrown = sub(
    sub(frontAxle, scale(steerDown, axleToCrown)),
    scale(steerForward, row.forkRake),
  );
  const headBottom = sub(forkCrown, scale(steerDown, 0.012));
  const headTop = sub(headBottom, scale(steerDown, row.headTubeLength));
  const topTubeFront = add(headTop, scale(steerDown, 0.02));
  const steererTop = sub(headTop, scale(steerDown, 0.035));
  const stemEnd = add(steererTop, scale(steerForward, row.stemLength));

  const sa = row.seatAngleDeg * DEG;
  const seatTubeDir: Vec3 = [-Math.cos(sa), Math.sin(sa), 0];
  const seatTubeTop = scale(seatTubeDir, row.seatTubeLength);
  const topTubeRear = scale(seatTubeDir, row.seatTubeLength - row.topTubeDropAtSeat);
  const downTubeRear: Vec3 =
    spec.frameStyle === "step-through" ? scale(seatTubeDir, 0.4 * row.seatTubeLength) : bb;

  const saddleHeight = clamp(
    (input.fit?.saddleHeightMm ?? row.saddleHeightDefault * 1000) / 1000,
    row.seatTubeLength + 0.06,
    row.seatTubeLength + 0.38,
  );
  const saddle = scale(seatTubeDir, saddleHeight);
  const seatpostTop = scale(seatTubeDir, saddleHeight - 0.035);

  const etrto = spec.wheel.etrtoDiameter;
  const tireFront = (attributes.tireFrontWidthMm ?? row.tireWidth * 1000) / 1000;
  const tireRear = (attributes.tireRearWidthMm ?? row.tireWidth * 1000) / 1000;
  const hubMotor = spec.eSystem?.motorPosition === "hub-rear";
  const wheelFront = wheel(frontAxle, etrto, tireFront, 0.02);
  const wheelRear = wheel(
    rearAxle,
    etrto,
    tireRear,
    hubMotor ? 0.075 : spec.drivetrain.kind === "igh" ? 0.045 : 0.022,
  );

  // ── Drivetrain ────────────────────────────────────────────────────────────
  const ringTeeth = chainringTeeth(
    attributes.chainringTeeth ?? defaultChainringTeeth(input),
    spec.drivetrain.chainrings,
  );
  const ringZ = (index: number, count: number) => -0.043 - (count - 1 - index) * 0.0065;
  const chainrings: Sprocket[] = ringTeeth.map((teeth, index) => ({
    teeth,
    pitchRadius: pitchRadius(teeth),
    center: [0, 0, ringZ(index, ringTeeth.length)],
  }));

  const derailleur = spec.drivetrain.kind === "derailleur";
  const speeds = derailleur ? (attributes.cassetteSpeeds ?? spec.drivetrain.speeds) : 1;
  const teethSmallFirst = derailleur
    ? cassetteTeeth(attributes.cassetteRange, speeds)
    : [spec.drivetrain.transmission === "belt" ? 24 : 18];
  const pitch = cogPitch(speeds);
  const cogs: Sprocket[] = [...teethSmallFirst].reverse().map((teeth, i) => ({
    teeth,
    pitchRadius: pitchRadius(teeth),
    center: [rearAxle[0], rearAxle[1], -(0.0335 + i * pitch)],
  }));
  const displayedCog = Math.floor(cogs.length / 2);
  // The chain runs on the middle ring of a triple, the big ring otherwise.
  const ring = chainrings[chainrings.length === 3 ? 1 : 0]!;
  const cog = cogs[displayedCog]!;
  const chain = chainPath(ring, cog);
  const chainLength = openChainLength(
    ring.pitchRadius,
    cog.pitchRadius,
    Math.hypot(cog.center[0] - ring.center[0], cog.center[1] - ring.center[1]),
  );

  const crankLength = spec.discipline === "kids" ? 0.14 : 0.1725;
  const crankAngle = -20 * DEG;
  const pedalRight: Vec3 = [
    crankLength * Math.cos(crankAngle),
    crankLength * Math.sin(crankAngle),
    -0.105,
  ];
  const pedalLeft: Vec3 = [-pedalRight[0], -pedalRight[1], 0.105];

  const rotor = (axle: Vec3, mm: number | undefined, fallback: number) =>
    spec.brakes.isDisc
      ? { center: add(axle, [0, 0, 0.03]), radius: (mm ?? fallback) / 2000 }
      : null;
  const defaultRotor = spec.discipline === "mtb" ? 180 : 160;

  const { stack, reach } = stackReach(headTop, bb);
  const anchors: BikeAnchors = {
    bb,
    ground: row.bbDrop - wheelRear.wheelRadius,
    rearAxle,
    frontAxle,
    steerDown,
    steerForward,
    forkCrown,
    headBottom,
    headTop,
    topTubeFront,
    steererTop,
    seatTubeDir,
    seatTubeTop,
    topTubeRear,
    downTubeRear,
    stemEnd,
    saddle,
    seatpostTop,
    wheelFront,
    wheelRear,
    chainrings,
    cogs,
    displayedCog,
    chainPath: chain,
    chainLength,
    crankLength,
    pedalLeft,
    pedalRight,
    rotorFront: rotor(frontAxle, attributes.rotorFrontMm, defaultRotor),
    rotorRear: rotor(rearAxle, attributes.rotorRearMm, defaultRotor),
    forkTravel: travelMm / 1000,
    stack,
    reach,
    row,
  };

  const points: Vec3[] = [
    rearAxle,
    frontAxle,
    forkCrown,
    headTop,
    stemEnd,
    saddle,
    pedalLeft,
    pedalRight,
    ...chain,
  ];
  if (!points.every(isFiniteVec) || !Number.isFinite(chainLength)) {
    throw new SolverError("non-finite anchor");
  }
  return anchors;
}

/** Solve the bike described by `input` with its `GEOMETRY_TABLE` row. */
export function solve(input: SolverInput): BikeAnchors {
  return solveRow(geometryRowFor(input.spec.discipline, input.spec.wheel.etrtoDiameter), input);
}

/** Point `t` of the way along the seat tube (0 = BB, 1 = its top). */
export function onSeatTube(anchors: BikeAnchors, t: number): Vec3 {
  return scale(anchors.seatTubeDir, anchors.row.seatTubeLength * t);
}

/** Point `t` of the way from the head-tube bottom to the down tube's rear end. */
export function onDownTube(anchors: BikeAnchors, t: number): Vec3 {
  return lerp(anchors.headBottom, anchors.downTubeRear, t);
}
