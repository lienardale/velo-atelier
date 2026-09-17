# Bike geometry (`lib/bike3d/solver.ts`, `geometry-table.ts`)

## Axes and units

Metres. Origin = bottom-bracket centre. +X forward, +Y up, +Z the rider's left;
the drive side is −Z (§3.2). The default camera looks at the drive side.

## Inputs, not outputs

A row gives wheelbase, BB drop, chainstay, head and seat angles, head-tube and
seat-tube lengths, fork axle-to-crown and rake, tyre width, stem, bar width and a
default saddle height. **Stack and reach are derived**, never input: with
wheelbase, chainstay, BB drop, angles, head tube and fork all fixed, stack and
reach are already determined, and a second source of truth would disagree.

`npm run geom:report` prints the derived numbers per row next to typical size-M
catalogue values (`CATALOGUE_REFERENCES` in `measurements.ts`). The same comparison
runs in `lib/bike3d/solver.test.ts` as `expect.soft` (±20 mm stack, ±10 mm reach).

## Solver steps

1. Rear axle: `x = −√(chainstay² − bbDrop²)`, `y = bbDrop`; front axle: `x + wheelbase`.
2. Steering axis from the head angle: `steerDown = (cos HA, −sin HA)`,
   `steerForward = (sin HA, cos HA)`.
3. Fork crown `= frontAxle − AC·steerDown − rake·steerForward`. On a suspension
   fork AC = row AC − the travel the row already includes + the fork's
   `travel-mm`; rigid forks drop the included travel.
4. `headBottom = crown − 0.012·down`, `headTop = headBottom − HTL·down`,
   `topTubeFront = headTop + 0.02·down`, steerer top 35 mm above the head tube,
   stem along `steerForward`.
5. Seat tube along the seat angle; the top tube meets it `topTubeDropAtSeat` below
   its top. Step-through frames have no top tube: the down tube curves into the
   seat tube at 40 % of its height.
6. Saddle along the seat tube at `fit.saddleHeightMm` (else the row default),
   clamped to [seat tube + 60 mm, seat tube + 380 mm].
7. Wheels: `rimRadius = ETRTO / 2000`, `wheelRadius = rimRadius + tyre width`
   (tyre width from `tire-*.etrto-width`).
8. Drivetrain: pitch radius `r(T) = 0.0127 / (2·sin(π/T))`; chainrings from
   `chainring.teeth` (2× = T, T−16; 3× = T, T−12, T−22); cassette teeth from
   `cassette.range` × `speeds` (`cassettes.ts`); cog _i_ (0 = largest, nearest the
   spokes) at `z = −(0.0335 + i·pitch)`; the chain runs on the middle cog
   (`floor(n/2)`) and the big ring (middle ring of a triple); the chain path is
   the two external tangents plus both wraps; hub gears and single speeds use one
   18T sprocket (24T for a belt).
9. Rotors in the plane `axle + [0, 0, +0.03]`, radius `rotor-*.diameter / 2000`.
10. The solver throws only when an anchor would not be finite
    (`chainstay ≤ bbDrop`, `AC ≤ rake`, a NaN input).

## Rows (size M)

| row                   | wheelbase                                           | bbDrop       | chainstay | HA°  | SA°  | HTL       | STL   | AC                   | rake  | tyre              | bar  | style        | source                                       |
| --------------------- | --------------------------------------------------- | ------------ | --------- | ---- | ---- | --------- | ----- | -------------------- | ----- | ----------------- | ---- | ------------ | -------------------------------------------- |
| road/622              | 0.995                                               | 0.072        | 0.410     | 72.5 | 73.5 | 0.150     | 0.520 | 0.372                | 0.045 | 0.028             | 0.42 | diamond      | §3.2 seed                                    |
| road/584              | 0.975                                               | = road/622   |           |      |      |           |       |                      |       | 0.032             |      |              | derived (650b road is reachable in the tree) |
| gravel/622            | 1.030                                               | 0.075        | 0.425     | 71.5 | 73.5 | 0.155     | 0.520 | 0.395                | 0.050 | 0.042             | 0.44 | diamond      | §3.2 seed                                    |
| gravel/584            | 1.010                                               | = gravel/622 |           |      |      |           |       |                      |       | 0.047             |      |              | §3.2                                         |
| mtb/622               | 1.170                                               | 0.060        | 0.435     | 66   | 75   | **0.095** | 0.440 | 0.550 (130 mm incl.) | 0.044 | 0.058             | 0.78 | diamond      | §3.2 seed, HTL tuned                         |
| mtb/584, mtb/559      | 1.150, 1.130                                        | = mtb/622    |           |      |      |           |       |                      |       |                   |      |              | §3.2                                         |
| city-hybrid/622, /584 | 1.080                                               | 0.070        | 0.450     | 70   | 72   | 0.170     | 0.500 | 0.420                | 0.045 | 0.047             | 0.62 | step-through | §3.2 seed                                    |
| city-hybrid/559       | 1.060                                               | = city/622   |           |      |      |           |       |                      |       |                   |      |              | derived (26" city is reachable)              |
| kids/507, /406, /305  | city lengths × wheel-diameter ratio; BB drop −20 mm |              |           |      |      |           |       |                      |       | 0.050 × ETRTO/507 |      | diamond      | §3.2                                         |

**Tuning log.** `mtb/622` head tube 0.110 → 0.095 m: the seed row gave a 656 mm
stack at 130 mm travel against a ~630 mm reference (Δ +26, outside ±20); now 642
(Δ +12), reach 432 (Δ +2). All other seed rows were within tolerance unchanged.

## `geom:report` (2026-09-17)

```
row              stack  reach  Δstack  Δreach  wheelbase  trail  BB height  saddle  links
road/622         568    388    +8      +3      995        60     267        720     92
gravel/622       592    386    +7      +1      1030       65     278        720     98
mtb/622          642    432    +12     +2      1170       117    311        700     95
city-hybrid/622  620    387    +10     +2      1080       81     283        700     99
kids/507         508    325                    916        70     264        593     85
```

`links` counts the open-belt loop round ring and cog only (no derailleur wrap),
so it is shorter than a real chain; it is used for the monotonicity invariant, not
for buying advice.
