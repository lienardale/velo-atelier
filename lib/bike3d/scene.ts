/**
 * The scene plan — every decision about WHAT the viewer draws, as plain data.
 *
 * `planScene(build, fit)` solves the anchors, picks the parts of the build that
 * have a mesh, and describes each one as mesh descriptors made of geometry
 * recipes (`types.ts`). Nothing here imports three.js or React:
 *
 *   - `components/bike3d/parts/**` stay declarative (ESLint forbids `if`,
 *     ternaries, `&&` and loops there) — they map descriptors to meshes;
 *   - `lib/bike3d/builders/**` turn recipes into buffers (lazy chunk only);
 *   - `lib/bike3d/silhouette.ts` projects the same recipes into the SVG
 *     fallback, so the 2D and 3D bikes can never disagree.
 *
 * Draw-call discipline (§3.4): every descriptor is ONE draw call (its recipes
 * are merged), spokes are one instanced call per wheel.
 */
import type { BikeBuild } from "@/lib/domain";
import { partDefinition, type PartId } from "@/lib/domain/data/parts";

import { hashOf } from "./hash";
import { onDownTube, onSeatTube, solve, solverInputFor } from "./solver";
import type {
  BaseMaterialKey,
  BikeAnchors,
  GeometryRecipe,
  MeshDescriptor,
  PartComponentName,
  ScenePart,
  ScenePlan,
  SpokeDescriptor,
  Vec3,
} from "./types";
import { add, boundsOf, lerp, normalize, offset, scale, sub, withZ } from "./vec";

/** Every part the viewer draws — must equal `RENDERED_PART_IDS` (unit-tested). */
export type RenderedPartId =
  | "frame"
  | "fork"
  | "wheel-front"
  | "wheel-rear"
  | "tire-front"
  | "tire-rear"
  | "crankset"
  | "chain"
  | "belt"
  | "cassette"
  | "freewheel"
  | "rear-derailleur"
  | "front-derailleur"
  | "shifter-right"
  | "shifter-left"
  | "internal-gear-hub"
  | "brake-lever-front"
  | "brake-lever-rear"
  | "brake-caliper-front"
  | "brake-caliper-rear"
  | "rotor-front"
  | "rotor-rear"
  | "handlebar"
  | "stem"
  | "grips-or-tape"
  | "saddle"
  | "seatpost"
  | "pedal-left"
  | "pedal-right"
  | "rear-shock"
  | "e-motor"
  | "e-battery"
  | "mudguards"
  | "rack"
  | "kickstand"
  | "lights";

/**
 * `PART_RENDERERS` — compile-time exhaustiveness (§3.1): adding a rendered part
 * to the domain without a renderer here fails `tsc` (via `RenderedPartId`) and
 * the unit test that compares this map with `RENDERED_PART_IDS`.
 */
export const PART_RENDERERS = {
  frame: "Frame",
  fork: "Fork",
  "wheel-front": "Wheel",
  "wheel-rear": "Wheel",
  "tire-front": "Wheel",
  "tire-rear": "Wheel",
  crankset: "Crankset",
  chain: "Chain",
  belt: "Chain",
  cassette: "Cassette",
  freewheel: "Cassette",
  "internal-gear-hub": "Cassette",
  "rear-derailleur": "RearDerailleur",
  "front-derailleur": "FrontDerailleur",
  "shifter-right": "Cockpit",
  "shifter-left": "Cockpit",
  "brake-lever-front": "Brake",
  "brake-lever-rear": "Brake",
  "brake-caliper-front": "Brake",
  "brake-caliper-rear": "Brake",
  "rotor-front": "Brake",
  "rotor-rear": "Brake",
  handlebar: "Cockpit",
  stem: "Cockpit",
  "grips-or-tape": "Cockpit",
  saddle: "Saddle",
  seatpost: "Seatpost",
  "pedal-left": "Crankset",
  "pedal-right": "Crankset",
  "rear-shock": "RearShock",
  "e-motor": "EMotor",
  "e-battery": "Battery",
  mudguards: "Accessories",
  rack: "Accessories",
  kickstand: "Accessories",
  lights: "Accessories",
} as const satisfies Record<RenderedPartId, PartComponentName>;

export function isRenderedPartId(id: string): id is RenderedPartId {
  return Object.hasOwn(PART_RENDERERS, id);
}

// ── recipe helpers ───────────────────────────────────────────────────────────

const tube = (from: Vec3, to: Vec3, radius: number): GeometryRecipe => ({
  kind: "tube",
  from,
  to,
  radius,
});
const path = (points: readonly Vec3[], radius: number, closed = false): GeometryRecipe => ({
  kind: "path",
  points,
  radius,
  closed,
});
const box = (center: Vec3, size: Vec3, rotationZ = 0): GeometryRecipe => ({
  kind: "box",
  center,
  size,
  rotationZ,
});
const disc = (center: Vec3, radius: number, thickness: number): GeometryRecipe => ({
  kind: "disc",
  center,
  radius,
  thickness,
});
const mesh = (
  key: string,
  material: BaseMaterialKey,
  recipes: readonly GeometryRecipe[],
): MeshDescriptor => ({ key, material, recipes });

const DEG = Math.PI / 180;
const polar = (center: Vec3, radius: number, angleDeg: number, z = center[2]): Vec3 => [
  center[0] + radius * Math.cos(angleDeg * DEG),
  center[1] + radius * Math.sin(angleDeg * DEG),
  z,
];

/** Points a recipe spans — for focus spheres and bounds. */
export function recipePoints(recipe: GeometryRecipe): Vec3[] {
  switch (recipe.kind) {
    case "tube":
    case "capsule":
      return [recipe.from, recipe.to];
    case "path":
      return [...recipe.points];
    case "torus": {
      const r = recipe.radius + recipe.tube;
      return [
        offset(recipe.center, -r, -r, -recipe.tube),
        offset(recipe.center, r, r, recipe.tube),
      ];
    }
    case "disc":
      return [
        offset(recipe.center, -recipe.radius, -recipe.radius, -recipe.thickness / 2),
        offset(recipe.center, recipe.radius, recipe.radius, recipe.thickness / 2),
      ];
    case "gear": {
      const r = recipe.pitchRadius * 1.05;
      return [offset(recipe.center, -r, -r, -recipe.thickness), offset(recipe.center, r, r, 0)];
    }
    case "box": {
      const h = scale(recipe.size, 0.5);
      return [sub(recipe.center, h), add(recipe.center, h)];
    }
  }
}

// ── per-part descriptors ─────────────────────────────────────────────────────

type Built = { meshes: MeshDescriptor[]; spokes?: SpokeDescriptor[] };

function frameMeshes(a: BikeAnchors, stepThrough: boolean): Built {
  const t = a.row.tubes;
  const stayZ = 0.065;
  const recipes: GeometryRecipe[] = [
    tube(a.headBottom, a.headTop, t.head),
    tube(a.bb, a.seatTubeTop, t.seat),
    tube([0, 0, -0.036], [0, 0, 0.036], 0.021),
    tube(withZ(a.bb, -0.03), withZ(a.rearAxle, -stayZ), t.stay),
    tube(withZ(a.bb, 0.03), withZ(a.rearAxle, stayZ), t.stay),
    tube(withZ(a.topTubeRear, -0.012), withZ(a.rearAxle, -stayZ), t.stay * 0.85),
    tube(withZ(a.topTubeRear, 0.012), withZ(a.rearAxle, stayZ), t.stay * 0.85),
  ];
  const headLow = lerp(a.headBottom, a.headTop, 0.25);
  if (stepThrough) {
    const sag = offset(lerp(headLow, a.downTubeRear, 0.5), 0, -0.06, 0);
    recipes.push(path([headLow, sag, a.downTubeRear], t.down));
    recipes.push(tube(a.downTubeRear, lerp(a.downTubeRear, a.bb, 0.6), t.down * 0.9));
  } else {
    recipes.push(tube(a.topTubeFront, a.topTubeRear, t.top));
    recipes.push(tube(headLow, a.downTubeRear, t.down));
  }
  return { meshes: [mesh("frame", "paint", recipes)] };
}

function forkMeshes(a: BikeAnchors, suspension: boolean): Built {
  const legZ = 0.056;
  const legRadius = suspension ? 0.018 : 0.012;
  const crown = a.forkCrown;
  const recipes: GeometryRecipe[] = [
    tube(withZ(crown, -legZ), withZ(a.frontAxle, -legZ), legRadius),
    tube(withZ(crown, legZ), withZ(a.frontAxle, legZ), legRadius),
    tube(withZ(crown, -legZ - 0.01), withZ(crown, legZ + 0.01), 0.018),
    tube(crown, a.steererTop, 0.0143),
  ];
  const lowers: GeometryRecipe[] = suspension
    ? [
        tube(withZ(lerp(crown, a.frontAxle, 0.45), -legZ), withZ(a.frontAxle, -legZ), 0.022),
        tube(withZ(lerp(crown, a.frontAxle, 0.45), legZ), withZ(a.frontAxle, legZ), 0.022),
      ]
    : [];
  return { meshes: [mesh("fork", suspension ? "alu" : "paint", [...recipes, ...lowers])] };
}

function wheelMeshes(a: BikeAnchors, side: "front" | "rear"): Built {
  const w = side === "front" ? a.wheelFront : a.wheelRear;
  return {
    meshes: [
      mesh(`wheel-${side}`, "alu", [
        { kind: "torus", center: w.axle, radius: w.rimRadius, tube: 0.009 },
        disc(w.axle, Math.min(w.hubRadius, 0.03), 0.07),
        tube(withZ(w.axle, -0.075), withZ(w.axle, 0.075), 0.006),
      ]),
    ],
    spokes: [
      {
        key: `spokes-${side}`,
        material: "steel",
        center: w.axle,
        hubRadius: Math.min(w.hubRadius, 0.03),
        rimRadius: w.rimRadius - 0.006,
        count: 32,
        flangeOffset: 0.028,
      },
    ],
  };
}

function tireMeshes(a: BikeAnchors, side: "front" | "rear"): Built {
  const w = side === "front" ? a.wheelFront : a.wheelRear;
  return {
    meshes: [
      mesh(`tire-${side}`, "rubber", [
        {
          kind: "torus",
          center: w.axle,
          radius: w.rimRadius + w.tireWidth / 2,
          tube: w.tireWidth / 2,
        },
      ]),
    ],
  };
}

function cranksetMeshes(a: BikeAnchors): Built {
  const rings: GeometryRecipe[] = a.chainrings.map((ring) => ({
    kind: "gear",
    center: ring.center,
    teeth: ring.teeth,
    pitchRadius: ring.pitchRadius,
    thickness: 0.0025,
  }));
  return {
    meshes: [
      mesh("chainrings", "steel", rings),
      mesh("crank-arms", "alu", [
        tube([0, 0, -0.06], withZ(a.pedalRight, -0.06), 0.011),
        tube([0, 0, 0.06], withZ(a.pedalLeft, 0.06), 0.011),
        tube([0, 0, -0.062], [0, 0, 0.062], 0.012),
      ]),
    ],
  };
}

function pedalMeshes(a: BikeAnchors, side: "left" | "right"): Built {
  const p = side === "left" ? a.pedalLeft : a.pedalRight;
  const sign = side === "left" ? 1 : -1;
  return {
    meshes: [
      mesh(`pedal-${side}`, "plastic", [
        box(offset(p, 0, 0, sign * 0.03), [0.095, 0.022, 0.08]),
        tube(withZ(p, sign * 0.06), withZ(p, sign * 0.075), 0.007),
      ]),
    ],
  };
}

function chainMeshes(a: BikeAnchors, belt: boolean): Built {
  return {
    meshes: [
      mesh(belt ? "belt" : "chain", belt ? "rubber" : "chain", [
        path(a.chainPath, belt ? 0.006 : 0.0042, true),
      ]),
    ],
  };
}

function cogRecipes(a: BikeAnchors): GeometryRecipe[] {
  return a.cogs.map((cog) => ({
    kind: "gear",
    center: cog.center,
    teeth: cog.teeth,
    pitchRadius: cog.pitchRadius,
    thickness: 0.0018,
  }));
}

function cassetteMeshes(a: BikeAnchors, igh: boolean): Built {
  const hub: GeometryRecipe[] = igh ? [disc(withZ(a.rearAxle, 0), 0.045, 0.075)] : [];
  return { meshes: [mesh(igh ? "igh" : "cassette", "steel", [...hub, ...cogRecipes(a)])] };
}

function rearDerailleurMeshes(a: BikeAnchors): Built {
  const z = a.cogs[a.displayedCog]!.center[2] - 0.004;
  const body = offset(a.rearAxle, -0.005, -0.03, z - 0.012);
  const upper = offset(a.rearAxle, -0.005, -0.065, z);
  const lower = offset(a.rearAxle, 0.02, -0.12, z);
  return {
    meshes: [
      mesh("rear-derailleur", "alu", [
        box(body, [0.045, 0.035, 0.022], -20 * DEG),
        disc(upper, 0.0165, 0.006),
        disc(lower, 0.0165, 0.006),
        box(lerp(upper, lower, 0.5), [0.02, 0.075, 0.004], 25 * DEG),
      ]),
    ],
  };
}

function frontDerailleurMeshes(a: BikeAnchors): Built {
  const onTube = onSeatTube(a, 0.36);
  const outerRing = a.chainrings[0]!;
  return {
    meshes: [
      mesh("front-derailleur", "alu", [
        box(offset(onTube, 0.035, 0, outerRing.center[2] + 0.004), [0.06, 0.025, 0.018], -15 * DEG),
        tube(withZ(onTube, -0.02), withZ(onTube, outerRing.center[2]), 0.006),
      ]),
    ],
  };
}

type Side = "front" | "rear";

/** French/continental levers: front brake on the LEFT (+Z), rear on the right (−Z). */
const leverZSign = (side: Side) => (side === "front" ? 1 : -1);

function barEnd(a: BikeAnchors, zSign: number, drop: boolean): Vec3 {
  const half = a.row.barWidth / 2;
  return drop
    ? offset(a.stemEnd, 0.075, -0.01, zSign * (half - 0.01))
    : offset(a.stemEnd, 0, 0.005, zSign * (half - 0.09));
}

function leverMeshes(a: BikeAnchors, side: Side, drop: boolean): Built {
  const zSign = leverZSign(side);
  const at = barEnd(a, zSign, drop);
  const recipes: GeometryRecipe[] = drop
    ? [
        box(offset(at, 0.03, -0.02, 0), [0.07, 0.03, 0.028], -35 * DEG),
        box(offset(at, 0.055, -0.075, 0), [0.012, 0.09, 0.01], 10 * DEG),
      ]
    : [
        box(offset(at, 0.005, 0, -zSign * 0.03), [0.03, 0.03, 0.03]),
        box(offset(at, 0.05, -0.005, zSign * 0.02), [0.012, 0.008, 0.1]),
      ];
  return { meshes: [mesh(`brake-lever-${side}`, "plastic", recipes)] };
}

function caliperMeshes(a: BikeAnchors, side: Side, disc: boolean, rimKind: string): Built {
  const axle = side === "front" ? a.frontAxle : a.rearAxle;
  const w = side === "front" ? a.wheelFront : a.wheelRear;
  const rotor = side === "front" ? a.rotorFront : a.rotorRear;
  if (disc && rotor) {
    const angle = side === "front" ? 150 : 25;
    const at = polar(rotor.center, rotor.radius - 0.008, angle);
    return {
      meshes: [
        mesh(`brake-caliper-${side}`, "alu", [box(at, [0.055, 0.03, 0.03], (angle + 90) * DEG)]),
      ],
    };
  }
  const angle = side === "front" ? 100 : 75;
  const reach = w.rimRadius + (rimKind === "rim-caliper" ? w.tireWidth + 0.012 : 0.004);
  const at = polar(axle, reach, angle);
  const recipes: GeometryRecipe[] =
    rimKind === "rim-caliper"
      ? [box(at, [0.03, 0.02, 0.07], (angle + 90) * DEG)]
      : [
          box(withZ(at, -0.045), [0.012, 0.075, 0.012], (angle + 90) * DEG),
          box(withZ(at, 0.045), [0.012, 0.075, 0.012], (angle + 90) * DEG),
        ];
  return { meshes: [mesh(`brake-caliper-${side}`, "alu", recipes)] };
}

function rotorMeshes(a: BikeAnchors, side: Side): Built {
  const rotor = (side === "front" ? a.rotorFront : a.rotorRear)!;
  return {
    meshes: [mesh(`rotor-${side}`, "rotor", [disc(rotor.center, rotor.radius, 0.0018)])],
  };
}

function handlebarMeshes(a: BikeAnchors, bar: string): Built {
  const half = a.row.barWidth / 2;
  const c = a.stemEnd;
  const r = 0.0112;
  let recipes: GeometryRecipe[];
  switch (bar) {
    case "drop": {
      const side = (zSign: number): GeometryRecipe =>
        path(
          [
            offset(c, 0, 0, zSign * 0.12),
            offset(c, 0.02, 0, zSign * (half - 0.02)),
            offset(c, 0.085, -0.01, zSign * half),
            offset(c, 0.1, -0.075, zSign * half),
            offset(c, 0.055, -0.13, zSign * half),
            offset(c, -0.02, -0.125, zSign * half),
          ],
          r,
        );
      recipes = [tube(offset(c, 0, 0, -0.12), offset(c, 0, 0, 0.12), 0.0159), side(-1), side(1)];
      break;
    }
    case "riser":
      recipes = [
        path(
          [
            offset(c, 0, 0.03, -half),
            offset(c, 0, 0.028, -half + 0.12),
            offset(c, 0, 0, -0.07),
            offset(c, 0, 0, 0.07),
            offset(c, 0, 0.028, half - 0.12),
            offset(c, 0, 0.03, half),
          ],
          r,
        ),
      ];
      break;
    case "swept":
      recipes = [
        path(
          [
            offset(c, -0.1, 0.02, -half),
            offset(c, -0.03, 0.01, -half + 0.12),
            offset(c, 0, 0, -0.06),
            offset(c, 0, 0, 0.06),
            offset(c, -0.03, 0.01, half - 0.12),
            offset(c, -0.1, 0.02, half),
          ],
          r,
        ),
      ];
      break;
    default:
      recipes = [tube(offset(c, 0, 0, -half), offset(c, 0, 0, half), r)];
  }
  return { meshes: [mesh("handlebar", "alu", recipes)] };
}

function gripMeshes(a: BikeAnchors, bar: string): Built {
  const half = a.row.barWidth / 2;
  const c = a.stemEnd;
  const recipes: GeometryRecipe[] =
    bar === "drop"
      ? [-1, 1].map((zSign) =>
          path(
            [
              offset(c, 0.02, 0, zSign * (half - 0.02)),
              offset(c, 0.085, -0.01, zSign * half),
              offset(c, 0.1, -0.075, zSign * half),
              offset(c, 0.055, -0.13, zSign * half),
            ],
            0.0135,
          ),
        )
      : [-1, 1].map((zSign) => {
          const back = bar === "swept" ? -0.1 : 0;
          const rise = bar === "riser" ? 0.03 : bar === "swept" ? 0.02 : 0;
          return tube(
            offset(c, back, rise, zSign * (half - 0.13)),
            offset(c, back, rise, zSign * half),
            0.016,
          );
        });
  return { meshes: [mesh("grips-or-tape", "rubber", recipes)] };
}

function stemMeshes(a: BikeAnchors): Built {
  return {
    meshes: [
      mesh("stem", "alu", [
        tube(a.steererTop, a.stemEnd, 0.016),
        tube(offset(a.stemEnd, 0, 0, -0.025), offset(a.stemEnd, 0, 0, 0.025), 0.019),
      ]),
    ],
  };
}

function shifterMeshes(
  a: BikeAnchors,
  side: "left" | "right",
  drop: boolean,
  grip: boolean,
): Built {
  const zSign = side === "left" ? 1 : -1;
  const half = a.row.barWidth / 2;
  const recipes: GeometryRecipe[] = drop
    ? // The shift paddle of an STI lever: outboard of the lever body, so it is
      // visible (and clickable) from the side and from above.
      [
        box(
          offset(barEnd(a, zSign, true), 0.045, -0.055, zSign * 0.022),
          [0.02, 0.06, 0.016],
          10 * DEG,
        ),
      ]
    : grip
      ? [
          tube(
            offset(a.stemEnd, 0, 0, zSign * (half - 0.16)),
            offset(a.stemEnd, 0, 0, zSign * (half - 0.13)),
            0.019,
          ),
        ]
      : [box(offset(a.stemEnd, 0.01, -0.025, zSign * (half - 0.175)), [0.045, 0.03, 0.035])];
  return { meshes: [mesh(`shifter-${side}`, "plastic", recipes)] };
}

function saddleMeshes(a: BikeAnchors): Built {
  const s = a.saddle;
  return {
    meshes: [
      mesh("saddle", "rubber", [
        box(offset(s, -0.035, 0.012, 0), [0.15, 0.04, 0.14]),
        box(offset(s, 0.075, 0.008, 0), [0.14, 0.03, 0.05]),
      ]),
    ],
  };
}

function seatpostMeshes(a: BikeAnchors, dropper: boolean): Built {
  const insertion = onSeatTube(a, 0.8);
  const recipes: GeometryRecipe[] = [tube(insertion, a.seatpostTop, 0.0136)];
  const extra: GeometryRecipe[] = dropper
    ? [tube(a.seatTubeTop, lerp(a.seatTubeTop, a.seatpostTop, 0.55), 0.0165)]
    : [];
  return {
    meshes: [
      mesh("seatpost", "alu", [...recipes, ...extra, box(a.seatpostTop, [0.05, 0.018, 0.035])]),
    ],
  };
}

function shockMeshes(a: BikeAnchors): Built {
  const from = offset(onSeatTube(a, 0.32), 0.06, 0.02, 0);
  const to = lerp(a.topTubeRear, a.topTubeFront, 0.4);
  return {
    meshes: [
      mesh("rear-shock", "steel", [
        { kind: "capsule", from, to: lerp(from, to, 0.55), radius: 0.02 },
        tube(from, to, 0.009),
      ]),
    ],
  };
}

function motorMeshes(a: BikeAnchors, hub: boolean): Built {
  const recipes: GeometryRecipe[] = hub
    ? [disc(a.rearAxle, 0.075, 0.07)]
    : [box(offset(a.bb, -0.02, -0.04, 0), [0.19, 0.15, 0.1], -12 * DEG)];
  return { meshes: [mesh("e-motor", "plastic", recipes)] };
}

function rackTop(a: BikeAnchors): number {
  return a.rearAxle[1] + a.wheelRear.wheelRadius + 0.06;
}

function batteryMeshes(a: BikeAnchors, position: string): Built {
  const t = a.row.tubes;
  let recipe: GeometryRecipe;
  if (position === "rack") {
    recipe = box([a.rearAxle[0] + 0.02, rackTop(a) + 0.045, 0], [0.34, 0.08, 0.1]);
  } else {
    const from = onDownTube(a, 0.12);
    const to = onDownTube(a, 0.72);
    const dir = normalize(sub(to, from));
    // Up-and-back normal of the down tube: an external battery sits on top of it.
    const normal: Vec3 = [-dir[1], dir[0], 0];
    const lift = position === "integrated" ? 0 : t.down + 0.035;
    const up = normal[1] < 0 ? scale(normal, -lift) : scale(normal, lift);
    recipe = {
      kind: "capsule",
      from: add(from, up),
      to: add(to, up),
      radius: position === "integrated" ? t.down + 0.012 : 0.036,
    };
  }
  return { meshes: [mesh("e-battery", "plastic", [recipe])] };
}

function mudguardMeshes(a: BikeAnchors): Built {
  const arc = (axle: Vec3, radius: number, from: number, to: number): GeometryRecipe => {
    const points: Vec3[] = [];
    for (let i = 0; i <= 10; i++)
      points.push(polar(axle, radius, from + ((to - from) * i) / 10, 0));
    return path(points, 0.011);
  };
  return {
    meshes: [
      mesh("mudguards", "plastic", [
        arc(a.frontAxle, a.wheelFront.wheelRadius + 0.018, 175, 10),
        arc(a.rearAxle, a.wheelRear.wheelRadius + 0.018, 200, 50),
      ]),
    ],
  };
}

function rackMeshes(a: BikeAnchors): Built {
  const y = rackTop(a);
  const rear = a.rearAxle[0] - 0.16;
  const front = a.rearAxle[0] + 0.18;
  const recipes: GeometryRecipe[] = [-0.065, 0.065].flatMap((z) => [
    tube([rear, y, z], [front, y, z], 0.005),
    tube(withZ(a.rearAxle, z), [rear + 0.03, y, z], 0.005),
  ]);
  recipes.push(tube([front, y, 0], lerp(a.topTubeRear, a.seatTubeTop, 0.2), 0.005));
  recipes.push(tube([rear, y, -0.065], [rear, y, 0.065], 0.005));
  return { meshes: [mesh("rack", "alu", recipes)] };
}

function kickstandMeshes(a: BikeAnchors): Built {
  const mount = withZ(lerp(a.bb, a.rearAxle, 0.45), 0.05);
  return {
    meshes: [
      mesh("kickstand", "alu", [tube(mount, [mount[0] - 0.08, a.ground + 0.01, 0.17], 0.008)]),
    ],
  };
}

function lightMeshes(a: BikeAnchors, rack: boolean): Built {
  const front = add(a.forkCrown, scale(a.steerForward, 0.045));
  const rear = rack
    ? [a.rearAxle[0] - 0.17, rackTop(a) - 0.015, 0]
    : offset(lerp(a.seatTubeTop, a.seatpostTop, 0.3), -0.04, 0, 0);
  return {
    meshes: [
      mesh("lights", "plastic", [
        box(front, [0.04, 0.035, 0.045]),
        box(rear as Vec3, [0.02, 0.035, 0.04]),
      ]),
    ],
  };
}

// ── plan ─────────────────────────────────────────────────────────────────────

function describe(id: RenderedPartId, a: BikeAnchors, build: BikeBuild): Built {
  const spec = build.spec;
  const drop = spec.cockpit.bar === "drop";
  const has = (partId: string) => build.parts.some((part) => part.partId === partId);
  const seatpostAttrs = build.parts.find((part) => part.partId === "seatpost")?.attributes;
  switch (id) {
    case "frame":
      return frameMeshes(a, spec.frameStyle === "step-through");
    case "fork":
      return forkMeshes(a, spec.suspension.front);
    case "wheel-front":
      return wheelMeshes(a, "front");
    case "wheel-rear":
      return wheelMeshes(a, "rear");
    case "tire-front":
      return tireMeshes(a, "front");
    case "tire-rear":
      return tireMeshes(a, "rear");
    case "crankset":
      return cranksetMeshes(a);
    case "chain":
      return chainMeshes(a, false);
    case "belt":
      return chainMeshes(a, true);
    case "cassette":
    case "freewheel":
      return cassetteMeshes(a, false);
    case "internal-gear-hub":
      return cassetteMeshes(a, true);
    case "rear-derailleur":
      return rearDerailleurMeshes(a);
    case "front-derailleur":
      return frontDerailleurMeshes(a);
    case "shifter-right":
      return shifterMeshes(a, "right", drop, spec.drivetrain.shifter === "grip");
    case "shifter-left":
      return shifterMeshes(a, "left", drop, spec.drivetrain.shifter === "grip");
    case "brake-lever-front":
      return leverMeshes(a, "front", drop);
    case "brake-lever-rear":
      return leverMeshes(a, "rear", drop);
    case "brake-caliper-front":
      return caliperMeshes(a, "front", spec.brakes.isDisc, spec.brakes.type);
    case "brake-caliper-rear":
      return caliperMeshes(a, "rear", spec.brakes.isDisc, spec.brakes.type);
    case "rotor-front":
      return rotorMeshes(a, "front");
    case "rotor-rear":
      return rotorMeshes(a, "rear");
    case "handlebar":
      return handlebarMeshes(a, spec.cockpit.bar);
    case "stem":
      return stemMeshes(a);
    case "grips-or-tape":
      return gripMeshes(a, spec.cockpit.bar);
    case "saddle":
      return saddleMeshes(a);
    case "seatpost":
      return seatpostMeshes(a, seatpostAttrs?.dropper === true || spec.seatpost.dropper);
    case "pedal-left":
      return pedalMeshes(a, "left");
    case "pedal-right":
      return pedalMeshes(a, "right");
    case "rear-shock":
      return shockMeshes(a);
    case "e-motor":
      return motorMeshes(a, spec.eSystem?.motorPosition === "hub-rear");
    case "e-battery":
      return batteryMeshes(a, spec.eSystem?.batteryPosition ?? "integrated");
    case "mudguards":
      return mudguardMeshes(a);
    case "rack":
      return rackMeshes(a);
    case "kickstand":
      return kickstandMeshes(a);
    case "lights":
      return lightMeshes(a, has("rack"));
  }
}

function focusOf(meshes: readonly MeshDescriptor[]): ScenePart["focus"] {
  const { min, max } = boundsOf(meshes.flatMap((m) => m.recipes.flatMap(recipePoints)));
  const center = lerp(min, max, 0.5);
  const radius = Math.max(0.05, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  return { center, radius };
}

/**
 * Plan the scene for a build. Rendered parts are the build's parts that have a
 * mesh (`hostPartId` parts are clicked through their host), in catalogue order.
 */
export function planScene(build: BikeBuild, fit?: { saddleHeightMm?: number } | null): ScenePlan {
  const input = solverInputFor(build, fit);
  const anchors = solve(input);
  const parts: ScenePart[] = [];
  for (const part of build.parts) {
    const definition = partDefinition(part.partId);
    if (!definition || definition.meshId === null || !isRenderedPartId(definition.id)) continue;
    if (parts.some((existing) => existing.partId === definition.id)) continue;
    const id = definition.id as RenderedPartId;
    const built = describe(id, anchors, build);
    parts.push({
      partId: definition.id,
      system: definition.system,
      component: PART_RENDERERS[id],
      meshes: built.meshes,
      spokes: built.spokes ?? [],
      focus: focusOf(built.meshes),
    });
  }
  const bounds = boundsOf(
    parts.flatMap((p) => p.meshes.flatMap((m) => m.recipes.flatMap(recipePoints))),
  );
  return {
    hash: hashOf({ input, parts: parts.map((p) => p.partId) }),
    anchors,
    parts,
    partIds: parts.map((p) => p.partId),
    bounds,
  };
}

/** The camera target / radius framing the whole bike. */
export function sceneSphere(plan: ScenePlan): { center: Vec3; radius: number } {
  const center = lerp(plan.bounds.min, plan.bounds.max, 0.5);
  const [dx, dy, dz] = sub(plan.bounds.max, plan.bounds.min);
  // The bike is long and flat: its width (bars, pedals) barely adds to what the
  // camera must frame, so it only counts for a third.
  const radius = Math.hypot(dx, dy, dz / 3) / 2;
  return { center, radius };
}

export type { PartId };
