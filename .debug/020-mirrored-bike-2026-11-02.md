# 020 — Every bike was drawn as its own mirror image

**Date** 2026-11-02 · **Status** fixed in code; the 14 canvas baselines of
`tests/e2e/visual.spec.ts` must be re-recorded by CI · **Touches**
`lib/bike3d/{types,solver,scene,focus,silhouette}.ts`,
`lib/bike3d/builders/gear.ts`, `components/bike3d/BikeScene.tsx`, the anchors
snapshot, `docs/bike3d.md`, `docs/bike3d-geometry.md`

## Symptom

The default drive-side view showed the chainrings and the rear derailleur, as it
should, but with the front wheel on the LEFT of the picture. A real bike seen
from its drive side (its right) has the front wheel on the right — every maker's
catalogue photo is taken that way. The silhouette agreed with the canvas, so the
two views were consistently wrong. `docs/bike3d.md` had listed it as a known
limitation since W2.

It became a blocker with the realistic-bikes plan (`docs/visual-realism.md`): a
logo painted on the frame would read backwards, and a component mesh modelled on
a real part (a rear derailleur) would land on the wrong side of the bike.

## Root cause

Handedness. The plan's §3.2 fixed the axes as "+X forward, +Y up, +Z the rider's
left; the drive side −Z". three.js is right-handed: with +X forward and +Y up,
`X × Y = +Z` points to the rider's RIGHT. Declaring +Z the left is a reflection,
so everything placed by that convention — chainrings, cogs, pedals, levers,
rotors, the kickstand — was laid out for a mirror-image bike. The camera on −Z
looking at "the drive side" then had screen-right = forward × up = −X: the front
wheel on the left.

## Fix

The convention is now named, never a bare sign: `DRIVE_SIDE_Z = +1` (the rider's
right) and `LEFT_Z = −1` in `lib/bike3d/types.ts`. Every one-sided placement
uses one of them:

- `solver.ts` — chainring and cog planes, pedal ends, rotor planes;
- `scene.ts` — crank arms, pedal bodies, rear and front derailleur offsets,
  brake-lever and shifter sides (front lever still on the rider's left, rear on
  the right), the kickstand (left), and a gear's z extent in `recipePoints`;
- `builders/gear.ts` — the gear is extruded outboard, towards `DRIVE_SIDE_Z`;
- `focus.ts` — every pose and close-up direction;
- `BikeScene.tsx` — the initial camera, the key light (drive side) and the fill
  light (left);
- `silhouette.ts` — no x mirror any more (screen-x = world-x) and parts are
  painted from the left side to the drive side.

Symmetric pairs (fork legs, stays, bar ends, grips, rack struts, V-brake arms)
are unchanged. The spoke lacing alternates flanges and was left as it is: either
lacing exists on real wheels.

The committed `road-disc-2x12.anchors.json` changed in z only — 44 values
changed sign, the 19 zeros did not move, every x and y is identical (checked by
walking both files).

## How to detect a regression

- `lib/bike3d/focus.test.ts` — "puts the front wheel on the right of the default
  view" computes the camera's screen-right (`forward × up`) and fails on a
  mirrored scene; "names every side pose after the side its camera is on" checks
  each `drive-*` / `non-drive-*` pose.
- `lib/bike3d/silhouette.test.ts` — "draws the front wheel on the right".
- `lib/bike3d/solver.test.ts` — over every enumerated build: chainrings, cogs and
  the right pedal on `DRIVE_SIDE_Z`; rotors and the left pedal on `LEFT_Z`.
- The 14 canvas baselines: once re-recorded they hold the corrected picture.
