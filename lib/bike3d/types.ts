/**
 * Shared types of the parametric 3D viewer (§3).
 *
 * Coordinate system (every file under `lib/bike3d/` and `components/bike3d/`):
 * units are metres, origin = the bottom-bracket centre, +X forward, +Y up,
 * and — the scene being right-handed — +Z is the rider's RIGHT, the drive
 * side ({@link DRIVE_SIDE_Z}); the rider's left is −Z ({@link LEFT_Z}).
 *
 * The plan's §3.2 said "+Z the rider's left", which in a right-handed scene
 * drew every bike as its own mirror image (the front wheel on the left of the
 * drive-side view). Code names a side through these two constants, never
 * through a bare sign, so that cannot come back unnoticed.
 *
 * Zod-free and three-free: this module is imported by the eager viewer shell
 * (`BikeViewer`, `BikeSilhouetteSvg`) as well as by the lazy scene chunk.
 */
import type { BikeSpec, PartSystem } from "@/lib/domain";
import type { PartId } from "@/lib/domain/data/parts";

/** Sign of Z on the drive side — the rider's right: chainrings, cogs, derailleurs. */
export const DRIVE_SIDE_Z = 1;
/** Sign of Z on the rider's left: rotors, the kickstand. */
export const LEFT_Z = -1;

/** A point or a direction, `[x, y, z]` in metres. */
export type Vec3 = readonly [number, number, number];

/** Rendering tier chosen by `lib/bike3d/quality.ts` (§3.3). */
export type QualityTier = "low" | "med" | "high";

/** Geometry tier: `med` renders the `high` geometry at a lower DPR without outlines. */
export type GeometryTier = "low" | "high";

export const QUALITY_TIERS: readonly QualityTier[] = ["low", "med", "high"];

/** The part of a `BikeSpec` the solver reads (§3.1). */
export type SolverSpec = Pick<
  BikeSpec,
  | "discipline"
  | "wheel"
  | "drive"
  | "brakes"
  | "drivetrain"
  | "cockpit"
  | "pedals"
  | "suspension"
  | "seatpost"
  | "eSystem"
  | "frameStyle"
>;

/** Build attributes the solver reads, all optional (a missing one falls back to the row). */
export interface SolverAttributes {
  rotorFrontMm?: number;
  rotorRearMm?: number;
  cassetteSpeeds?: number;
  cassetteRange?: string;
  chainringTeeth?: number;
  forkTravelMm?: number;
  tireFrontWidthMm?: number;
  tireRearWidthMm?: number;
}

export interface SolverInput {
  spec: SolverSpec;
  attributes: SolverAttributes;
  fit?: { saddleHeightMm?: number } | null;
}

/**
 * One row of `GEOMETRY_TABLE` (size M). No `stack` / `reach`: those are derived
 * from the other inputs and reported by `npm run geom:report` (§3.2).
 */
export interface FrameGeometryRow {
  wheelbase: number;
  bbDrop: number;
  chainstay: number;
  headAngleDeg: number;
  seatAngleDeg: number;
  headTubeLength: number;
  seatTubeLength: number;
  /** Axle-to-crown of the nominal fork, travel included when `forkTravelIncludedMm > 0`. */
  forkAxleToCrown: number;
  forkTravelIncludedMm: number;
  forkRake: number;
  /** How far below the seat-tube top the top tube meets it. */
  topTubeDropAtSeat: number;
  frameStyle: "diamond" | "step-through";
  tubes: { top: number; down: number; seat: number; head: number; stay: number };
  /** Default tyre section height ≈ width, metres. */
  tireWidth: number;
  stemLength: number;
  barWidth: number;
  /** BB centre to saddle top along the seat tube. */
  saddleHeightDefault: number;
}

/** Wheel anchors. */
export interface WheelAnchors {
  axle: Vec3;
  rimRadius: number;
  wheelRadius: number;
  tireWidth: number;
  hubRadius: number;
}

export interface Sprocket {
  teeth: number;
  pitchRadius: number;
  center: Vec3;
}

/** Everything the scene is built from. Pure numbers. */
export interface BikeAnchors {
  bb: Vec3;
  ground: number;
  rearAxle: Vec3;
  frontAxle: Vec3;
  /** Unit vector along the steering axis, pointing down towards the fork. */
  steerDown: Vec3;
  /** Unit vector perpendicular to the steering axis, pointing forward. */
  steerForward: Vec3;
  forkCrown: Vec3;
  headBottom: Vec3;
  headTop: Vec3;
  topTubeFront: Vec3;
  steererTop: Vec3;
  seatTubeDir: Vec3;
  seatTubeTop: Vec3;
  topTubeRear: Vec3;
  downTubeRear: Vec3;
  stemEnd: Vec3;
  saddle: Vec3;
  seatpostTop: Vec3;
  wheelFront: WheelAnchors;
  wheelRear: WheelAnchors;
  chainrings: Sprocket[];
  cogs: Sprocket[];
  displayedCog: number;
  chainPath: Vec3[];
  chainLength: number;
  crankLength: number;
  pedalLeft: Vec3;
  pedalRight: Vec3;
  rotorFront: { center: Vec3; radius: number } | null;
  rotorRear: { center: Vec3; radius: number } | null;
  forkTravel: number;
  stack: number;
  reach: number;
  row: FrameGeometryRow;
}

/** The base materials (the other five of the 12 singletons are overlays). */
export type BaseMaterialKey = "paint" | "alu" | "steel" | "rubber" | "plastic" | "chain" | "rotor";

export type OverlayMaterialKey =
  "highlightHover" | "highlightSelected" | "highlightPicked" | "statusOk" | "statusKo";

export type MaterialKey = BaseMaterialKey | OverlayMaterialKey;

/** A geometry described as plain data; `lib/bike3d/builders` turns it into three.js. */
export type GeometryRecipe =
  | { kind: "tube"; from: Vec3; to: Vec3; radius: number }
  | { kind: "path"; points: readonly Vec3[]; radius: number; closed: boolean }
  | { kind: "torus"; center: Vec3; radius: number; tube: number }
  | { kind: "disc"; center: Vec3; radius: number; thickness: number }
  | { kind: "gear"; center: Vec3; teeth: number; pitchRadius: number; thickness: number }
  | { kind: "box"; center: Vec3; size: Vec3; rotationZ: number }
  | { kind: "capsule"; from: Vec3; to: Vec3; radius: number };

/** One mesh of a part: several recipes merged into ONE geometry (one draw call). */
export interface MeshDescriptor {
  key: string;
  material: BaseMaterialKey;
  recipes: readonly GeometryRecipe[];
}

/** Spokes: one `InstancedMesh` (one draw call) at every tier, never line segments. */
export interface SpokeDescriptor {
  key: string;
  material: BaseMaterialKey;
  center: Vec3;
  hubRadius: number;
  rimRadius: number;
  count: number;
  /** Half the hub flange spacing: spokes alternate between the two flanges (±z). */
  flangeOffset: number;
}

/** The component family that renders a part (`components/bike3d/parts/*`). */
export type PartComponentName =
  | "Frame"
  | "Fork"
  | "Wheel"
  | "Crankset"
  | "Cassette"
  | "Chain"
  | "RearDerailleur"
  | "FrontDerailleur"
  | "Brake"
  | "Cockpit"
  | "Saddle"
  | "Seatpost"
  | "RearShock"
  | "EMotor"
  | "Battery"
  | "Accessories";

export interface ScenePart {
  partId: PartId;
  system: PartSystem;
  component: PartComponentName;
  meshes: readonly MeshDescriptor[];
  spokes: readonly SpokeDescriptor[];
  /** Point the label chip and the camera focus aim at. */
  focus: { center: Vec3; radius: number };
}

export interface ScenePlan {
  /** Stable hash of every input: geometry caches key on it. */
  hash: string;
  anchors: BikeAnchors;
  parts: readonly ScenePart[];
  /** Rendered part ids, in draw order. */
  partIds: readonly PartId[];
  bounds: { min: Vec3; max: Vec3 };
}

export type PartStatus = "ok" | "ko" | "todo";

export type ViewerMode = "browse" | "pick";

export type SelectSource = "canvas" | "list" | "svg" | "url" | "checkup";
