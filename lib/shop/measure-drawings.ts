/**
 * Which existing drawing shows how to read an attribute off the bike — the
 * illustration §6.5 asks for in the build list's "Comment mesurer"
 * disclosures.
 *
 * Only where a drawing already in the repository fits the QUESTION (W4-T1:
 * no new drawings): an axle's type, a valve's, the number of speeds, a wheel's
 * size, a brake's mount, a pedal's type, a tubeless-ready wheel. Everything
 * else keeps its help text alone — a cassette's range or a stem's length has
 * no drawing yet, and a drawing of something else would be worse than none.
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
});

/** The drawing for attribute `key`, or `undefined` (prototype keys included). */
export function measureDrawingFor(key: string): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(MEASURE_DRAWINGS, key) ? MEASURE_DRAWINGS[key] : undefined;
}
