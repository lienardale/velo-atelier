/**
 * Rear suspension (§2.3). The front suspension lives on the `fork` itself
 * (`travel-mm`, `spring`, `stanchion-mm`, `lockout` are present only on a
 * suspension fork), so this file holds the one part a rigid bike never has.
 *
 * `shock-mount` is named so, not `mount`, because `mount` is the brake
 * caliper's attribute and a key means the same thing on every part.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { attr, part } from "./define";
import { REAR_SUSPENSION } from "./standards";

export const SUSPENSION_PARTS = [
  part({
    id: "rear-shock",
    system: "suspension",
    includeWhen: REAR_SUSPENSION,
    optional: false,
    position: "rear",
    meshId: "rear-shock",
    attributes: [
      attr("shock-mount", {
        kind: "enum",
        values: ["standard-eye", "trunnion"],
        editable: true,
        fallback: "trunnion",
      }),
      attr("eye-to-eye", {
        kind: "number",
        unit: "mm",
        min: 150,
        max: 260,
        editable: true,
        fallback: null,
      }),
      attr("stroke", {
        kind: "number",
        unit: "mm",
        min: 30,
        max: 75,
        editable: true,
        fallback: null,
      }),
      attr("spring", {
        kind: "enum",
        values: ["coil", "air"],
        editable: true,
        fallback: "air",
      }),
      attr("lockout", { kind: "boolean", editable: true, fallback: true }),
    ],
    procedures: { check: ["check-suspension"], adjust: ["adjust-suspension-sag"] },
    checkupPriority: 80,
    wearItem: false,
  }),
] as const;
