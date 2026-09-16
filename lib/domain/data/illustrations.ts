/**
 * The illustration manifest — every drawing the decision tree needs (§2.5,
 * Appendix C).
 *
 * One entry per id: the component that draws it, the message key that names it
 * for a screen reader, the box it lays out in, and whether it is still a
 * generated placeholder or a finished drawing.
 *
 * Conventions, enforced by `schema/decision.ts` and `schema/illustration.ts`:
 *
 *   `ill-<question>`              the aid inside the question's help disclosure
 *   `ill-<question>-<option>`     an option thumbnail (required from four
 *                                 options up, unless the option ids are plain
 *                                 numbers — the `speeds` grid needs no art)
 *
 * Adding an entry here and running `npx tsx scripts/gen-illustration-placeholders.ts`
 * creates the missing component and rewrites the barrel; W2-T4c replaces the
 * placeholders one by one and flips `status` to `"final"`.
 *
 * Zod-free (`import type` only): this module is re-exported by the barrel.
 */
import type { IllustrationDef } from "../schema/illustration";

export const ILLUSTRATION_IDS = [
  "ill-drive",
  "ill-discipline",
  "ill-discipline-road",
  "ill-discipline-gravel",
  "ill-discipline-mtb",
  "ill-discipline-city-hybrid",
  "ill-discipline-kids",
  "ill-wheel-size",
  "ill-wheel-size-700c",
  "ill-wheel-size-650b",
  "ill-wheel-size-29",
  "ill-wheel-size-27-5",
  "ill-wheel-size-26",
  "ill-wheel-size-24",
  "ill-wheel-size-20",
  "ill-wheel-size-16",
  "ill-brake-type",
  "ill-brake-type-rim-caliper",
  "ill-brake-type-v-brake",
  "ill-brake-type-cantilever",
  "ill-brake-type-disc-mechanical",
  "ill-brake-type-disc-hydraulic",
  "ill-brake-mount",
  "ill-cockpit",
  "ill-cockpit-drop",
  "ill-cockpit-flat",
  "ill-cockpit-riser",
  "ill-cockpit-swept",
  "ill-drivetrain",
  "ill-drivetrain-derailleur-1x",
  "ill-drivetrain-derailleur-2x",
  "ill-drivetrain-derailleur-3x",
  "ill-drivetrain-igh",
  "ill-drivetrain-singlespeed",
  "ill-transmission",
  "ill-speeds",
  "ill-shifter",
  "ill-shifter-sti-integrated",
  "ill-shifter-trigger",
  "ill-shifter-grip",
  "ill-shifter-thumb",
  "ill-shifter-bar-end",
  "ill-shifter-electronic",
  "ill-pedals",
  "ill-pedals-flat",
  "ill-pedals-spd",
  "ill-pedals-road-clipless",
  "ill-pedals-toe-clips",
  "ill-pedals-combo",
  "ill-suspension",
  "ill-seatpost",
  "ill-tire-system",
  "ill-e-motor",
  "ill-e-battery",
] as const;

/** Every illustration id the domain knows about. */
export type IllustrationId = (typeof ILLUSTRATION_IDS)[number];

export const ILLUSTRATIONS: Record<IllustrationId, IllustrationDef> = {
  "ill-drive": {
    component: "IllDrive",
    altKey: "illustrations.ill-drive.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-discipline": {
    component: "IllDiscipline",
    altKey: "illustrations.ill-discipline.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-discipline-road": {
    component: "IllDisciplineRoad",
    altKey: "illustrations.ill-discipline-road.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-discipline-gravel": {
    component: "IllDisciplineGravel",
    altKey: "illustrations.ill-discipline-gravel.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-discipline-mtb": {
    component: "IllDisciplineMtb",
    altKey: "illustrations.ill-discipline-mtb.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-discipline-city-hybrid": {
    component: "IllDisciplineCityHybrid",
    altKey: "illustrations.ill-discipline-city-hybrid.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-discipline-kids": {
    component: "IllDisciplineKids",
    altKey: "illustrations.ill-discipline-kids.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size": {
    component: "IllWheelSize",
    altKey: "illustrations.ill-wheel-size.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-wheel-size-700c": {
    component: "IllWheelSize700c",
    altKey: "illustrations.ill-wheel-size-700c.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-650b": {
    component: "IllWheelSize650b",
    altKey: "illustrations.ill-wheel-size-650b.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-29": {
    component: "IllWheelSize29",
    altKey: "illustrations.ill-wheel-size-29.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-27-5": {
    component: "IllWheelSize275",
    altKey: "illustrations.ill-wheel-size-27-5.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-26": {
    component: "IllWheelSize26",
    altKey: "illustrations.ill-wheel-size-26.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-24": {
    component: "IllWheelSize24",
    altKey: "illustrations.ill-wheel-size-24.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-20": {
    component: "IllWheelSize20",
    altKey: "illustrations.ill-wheel-size-20.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-wheel-size-16": {
    component: "IllWheelSize16",
    altKey: "illustrations.ill-wheel-size-16.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-brake-type": {
    component: "IllBrakeType",
    altKey: "illustrations.ill-brake-type.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-brake-type-rim-caliper": {
    component: "IllBrakeTypeRimCaliper",
    altKey: "illustrations.ill-brake-type-rim-caliper.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-brake-type-v-brake": {
    component: "IllBrakeTypeVBrake",
    altKey: "illustrations.ill-brake-type-v-brake.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-brake-type-cantilever": {
    component: "IllBrakeTypeCantilever",
    altKey: "illustrations.ill-brake-type-cantilever.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-brake-type-disc-mechanical": {
    component: "IllBrakeTypeDiscMechanical",
    altKey: "illustrations.ill-brake-type-disc-mechanical.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-brake-type-disc-hydraulic": {
    component: "IllBrakeTypeDiscHydraulic",
    altKey: "illustrations.ill-brake-type-disc-hydraulic.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-brake-mount": {
    component: "IllBrakeMount",
    altKey: "illustrations.ill-brake-mount.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-cockpit": {
    component: "IllCockpit",
    altKey: "illustrations.ill-cockpit.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-cockpit-drop": {
    component: "IllCockpitDrop",
    altKey: "illustrations.ill-cockpit-drop.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-cockpit-flat": {
    component: "IllCockpitFlat",
    altKey: "illustrations.ill-cockpit-flat.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-cockpit-riser": {
    component: "IllCockpitRiser",
    altKey: "illustrations.ill-cockpit-riser.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-cockpit-swept": {
    component: "IllCockpitSwept",
    altKey: "illustrations.ill-cockpit-swept.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-drivetrain": {
    component: "IllDrivetrain",
    altKey: "illustrations.ill-drivetrain.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-drivetrain-derailleur-1x": {
    component: "IllDrivetrainDerailleur1x",
    altKey: "illustrations.ill-drivetrain-derailleur-1x.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-drivetrain-derailleur-2x": {
    component: "IllDrivetrainDerailleur2x",
    altKey: "illustrations.ill-drivetrain-derailleur-2x.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-drivetrain-derailleur-3x": {
    component: "IllDrivetrainDerailleur3x",
    altKey: "illustrations.ill-drivetrain-derailleur-3x.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-drivetrain-igh": {
    component: "IllDrivetrainIgh",
    altKey: "illustrations.ill-drivetrain-igh.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-drivetrain-singlespeed": {
    component: "IllDrivetrainSinglespeed",
    altKey: "illustrations.ill-drivetrain-singlespeed.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-transmission": {
    component: "IllTransmission",
    altKey: "illustrations.ill-transmission.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-speeds": {
    component: "IllSpeeds",
    altKey: "illustrations.ill-speeds.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-shifter": {
    component: "IllShifter",
    altKey: "illustrations.ill-shifter.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-shifter-sti-integrated": {
    component: "IllShifterStiIntegrated",
    altKey: "illustrations.ill-shifter-sti-integrated.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-shifter-trigger": {
    component: "IllShifterTrigger",
    altKey: "illustrations.ill-shifter-trigger.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-shifter-grip": {
    component: "IllShifterGrip",
    altKey: "illustrations.ill-shifter-grip.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-shifter-thumb": {
    component: "IllShifterThumb",
    altKey: "illustrations.ill-shifter-thumb.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-shifter-bar-end": {
    component: "IllShifterBarEnd",
    altKey: "illustrations.ill-shifter-bar-end.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-shifter-electronic": {
    component: "IllShifterElectronic",
    altKey: "illustrations.ill-shifter-electronic.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-pedals": {
    component: "IllPedals",
    altKey: "illustrations.ill-pedals.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-pedals-flat": {
    component: "IllPedalsFlat",
    altKey: "illustrations.ill-pedals-flat.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-pedals-spd": {
    component: "IllPedalsSpd",
    altKey: "illustrations.ill-pedals-spd.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-pedals-road-clipless": {
    component: "IllPedalsRoadClipless",
    altKey: "illustrations.ill-pedals-road-clipless.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-pedals-toe-clips": {
    component: "IllPedalsToeClips",
    altKey: "illustrations.ill-pedals-toe-clips.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-pedals-combo": {
    component: "IllPedalsCombo",
    altKey: "illustrations.ill-pedals-combo.alt",
    aspect: "1/1",
    status: "placeholder",
  },
  "ill-suspension": {
    component: "IllSuspension",
    altKey: "illustrations.ill-suspension.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-seatpost": {
    component: "IllSeatpost",
    altKey: "illustrations.ill-seatpost.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-tire-system": {
    component: "IllTireSystem",
    altKey: "illustrations.ill-tire-system.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-e-motor": {
    component: "IllEMotor",
    altKey: "illustrations.ill-e-motor.alt",
    aspect: "4/3",
    status: "placeholder",
  },
  "ill-e-battery": {
    component: "IllEBattery",
    altKey: "illustrations.ill-e-battery.alt",
    aspect: "4/3",
    status: "placeholder",
  },
};

/** Type guard for ids that arrive from content frontmatter or a URL. */
export function isIllustrationId(value: string): value is IllustrationId {
  return Object.hasOwn(ILLUSTRATIONS, value);
}
