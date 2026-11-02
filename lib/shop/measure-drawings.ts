/**
 * Which existing drawing shows how to read an attribute off the bike — the
 * illustration §6.5 asks for in the build list's "Comment mesurer"
 * disclosures.
 *
 * Only where a drawing fits the QUESTION. W4-T1 mapped the drawings that
 * already existed — an axle's type, a valve's, the number of speeds, a wheel's
 * size, a brake's mount, a pedal's type, a tubeless-ready wheel; the stub
 * guides' promotion drew the buying path's measurable ones — a cassette's
 * range and largest sprocket, a freehub body, a rotor's fitting and diameter,
 * a saddle's width, a tyre's width, a valve's length — and mapped three
 * more existing drawings (chainrings, a frame's rear axle, a stem's steerer
 * clamp). Everything else keeps its help text alone: a fork steerer's
 * straight-or-tapered, a stem's length, a saddle's rails (round or oval: the
 * rail-clamp drawing shows neither section), a pad's thickness (one part for
 * rim and disc pads) have no drawing that answers them, and a drawing of
 * something else would be worse than none.
 *
 * Attribute key → illustration id (`lib/content/illustrations.ts`), both
 * checked against their catalogues by `measure-drawings.test.ts`. Plain data:
 * the rendering is `components/build-list/measure-drawings.tsx`, a server
 * module, because the drawings' barrel must never reach a client bundle.
 */
export const MEASURE_DRAWINGS: Readonly<Record<string, string>> = Object.freeze({
  axle: "axle-qr-vs-thru",
  valve: "presta-valve-core",
  speeds: "ill-speeds",
  "etrto-diameter": "ill-wheel-size",
  mount: "ill-brake-mount",
  "brake-mount": "ill-brake-mount",
  "pedal-type": "ill-pedals",
  "tubeless-ready": "ill-tire-system",
  chainrings: "ill-drivetrain",
  "rear-axle": "axle-qr-vs-thru",
  "steerer-clamp": "headset-threaded-vs-threadless",
  range: "cassette-cog-count",
  "largest-cog": "cassette-cog-count",
  freehub: "freehub-body-profiles",
  interface: "rotor-mount-6bolt-centerlock",
  "rotor-interface": "rotor-mount-6bolt-centerlock",
  diameter: "rotor-diameter",
  "rotor-size": "rotor-diameter",
  "saddle-width": "saddle-width-sit-bones",
  "etrto-width": "tire-sidewall-markings",
  "valve-length": "valve-length-rim-depth",
});

/** The drawing for attribute `key`, or `undefined` (prototype keys included). */
export function measureDrawingFor(key: string): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(MEASURE_DRAWINGS, key) ? MEASURE_DRAWINGS[key] : undefined;
}
