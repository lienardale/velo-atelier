"use client";

import { useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBikeFitAction } from "@/app/[locale]/velo/[id]/reglages/actions";
import { updateBikePartAction } from "@/app/[locale]/velo/[id]/actions";
import { bikeRepoFor, LOCAL_BIKE_PENDING, useLocalBikeSnapshot } from "@/lib/bike/repo";
import type { BikeRefKind } from "@/lib/bike/resolve-bike-ref";
import {
  coerceFit,
  fitFieldsFor,
  isValidFitValue,
  type BikeFit,
  type FitFieldDef,
  type FitKey,
} from "@/lib/bike/rules";
import type { GeometryMeasureId } from "@/lib/domain/data/geometry-measures";
import { findPart } from "@/lib/domain/engine/parts-for-spec";
import type { BikeBuild } from "@/lib/domain/schema/part";
import {
  chainWearFromRuler,
  saddleHeightLeMond,
  saddleHeightMmFromInseam,
  sagTargetFor,
  sagRange,
  sagVerdict,
} from "@/lib/geometry/formulas";
import { tirePressure } from "@/lib/geometry/pressure";
import { cn } from "@/lib/utils";

import { useBikeActionText } from "./action-text";

/**
 * One measurement, its inputs and what they imply (§5.6, §6.8 AC12).
 *
 * The form is the *whole* interaction: type an inseam, read the saddle height
 * it suggests, press Enregistrer, and the number is on the bike. The readout
 * updates as you type — a rider trying 82, 83, 84 cm wants to see the height
 * move — but nothing is stored until the button, because a half-typed "8" is
 * not a measurement.
 *
 * Where the value goes is `repo`'s business (`va:bike:local.fit` or
 * `updateBikeFitAction`), so this component is identical on the guest and the
 * signed-in fit page.
 *
 * ## What is typed is the visitor's
 *
 * The fit page draws one of these per card, all over ONE bike, so the record
 * a form was seeded from changes under it: another card is saved, another tab
 * saves, the guest bike is read out of storage after hydration, a
 * revalidation hands a saved bike's cards a fresh `fit`. None of that may
 * take what the visitor has typed here and not saved:
 *
 *   - a field that still shows what was on record follows the record;
 *   - a field showing anything else — emptied by hand included — is left as
 *     typed, until THIS card is saved: then it shows what was stored;
 *   - except when ANOTHER bike has taken the record's place (a guest bike with
 *     another id in the slot, or one where there was none; another saved
 *     bike): what was typed was typed for the first, and every field takes
 *     the new bike's value. The guest bike being read for the first time is
 *     not that, and neither is its removal — nothing has taken its place.
 *
 * Until 2026-10-13 every change re-seeded the whole card (`.debug/018`).
 *
 * ## Inputs
 *
 * `inputMode="decimal"` and `text-base` (16 px): anything smaller makes iOS
 * Safari zoom the page on focus, which on a fit page means the rider loses the
 * bike they were measuring (§6.8 AC5 asserts the font size).
 */
export interface MeasurementFormProps {
  measureId: GeometryMeasureId;
  build: BikeBuild;
  /** What the server knew — empty for a guest bike, whose fit is in the browser. */
  fit: BikeFit;
  refKind: BikeRefKind;
  bikeId: string | null;
  className?: string;
}

export function MeasurementForm({
  measureId,
  build,
  fit,
  refKind,
  bikeId,
  className,
}: MeasurementFormProps): React.JSX.Element | null {
  const t = useTranslations("bike");
  const actionText = useBikeActionText();
  // A guest bike's fit lives in `localStorage`, which the server could not read;
  // a saved bike's arrived as a prop. Either way `known` is the value on record.
  const snapshot = useLocalBikeSnapshot();
  const guestBike = refKind === "local" && snapshot !== LOCAL_BIKE_PENDING ? snapshot : null;
  const known = useMemo(
    () => (guestBike !== null ? coerceFit(guestBike.fit) : fit),
    [guestBike, fit],
  );

  // Built here rather than passed in: a repo holds functions, and the fit page
  // is a Server Component, which can only hand a client one serialisable props.
  //
  // For a guest bike it is built for THE bike whose fit the inputs were seeded
  // from, by its id: a save goes to that bike or nowhere. `va:bike:local` is a
  // slot, and another page can put a new guest bike in it; until this page
  // has heard of it (the `storage` event, which re-seeds the inputs and builds
  // the repo again), what is typed here was typed for the first bike, and a
  // save is refused — "Introuvable." — rather than written into the second
  // (`localBikeRepo`, `.debug/017` §5.8, "Fourth review").
  const repoBikeId = refKind === "local" ? (guestBike?.id ?? null) : bikeId;
  const repo = useMemo(
    () =>
      bikeRepoFor(refKind, {
        bikeId: repoBikeId,
        actions: {
          updatePart: (input) => updateBikePartAction(input),
          updateFit: (input) => updateBikeFitAction(input),
        },
      }),
    [refKind, repoBikeId],
  );

  const fields = fitFieldsFor(measureId);
  // WHOSE record `known` is. For a guest it is the bike in the slot, by its own
  // id — `local` is the route's word for the slot, not a bike — and "storage
  // has not been read yet" is an answer of its own, which is neither a bike
  // nor the absence of one.
  const owner: RecordOwner =
    refKind !== "local"
      ? bikeId
      : snapshot === LOCAL_BIKE_PENDING
        ? LOCAL_BIKE_PENDING
        : (snapshot?.id ?? null);
  const [card, setCard] = useState<Card>(() => ({
    owner,
    known,
    shown: known,
    draft: draftOf(fields, known),
    sent: null,
  }));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorKey, setErrorKey] = useState<string>("errors.VALIDATION");
  const [, startTransition] = useTransition();

  // Bringing the inputs in line with a record that has been read again,
  // adjusted during render rather than in an effect: `known` is another object
  // only then (the snapshot is memoised on the raw string, a saved bike's `fit`
  // is a prop), so this runs once per read instead of scheduling a second
  // render every time — and changes nothing when the card's values did not
  // move. It is also the render a keystroke causes, when the change was another
  // card's save in this tab — which fires no `storage` event — so `card.draft`
  // here already holds that keystroke, and `follow` is what keeps it.
  if (card.known !== known || card.owner !== owner) {
    // Another bike where this one was. Not the first read of the guest bike
    // (nothing was seeded from a bike before it) and not its removal (nothing
    // has taken its place): those follow field by field like any other change.
    const replaced = card.owner !== LOCAL_BIKE_PENDING && owner !== null && card.owner !== owner;
    const from = draftOf(fields, card.shown);
    const to = draftOf(fields, known);
    setCard({
      owner,
      known,
      shown: known,
      draft: replaced ? to : follow(fields, card.draft, from, to),
      // A save on its way is told too: a field it sent untouched has just
      // moved with the record, and must not pass for "typed since" when the
      // answer comes. A save sent for a bike that is no longer the card's has
      // nothing to say to it.
      sent: replaced || card.sent === null ? null : follow(fields, card.sent, from, to),
    });
  }

  if (fields.length === 0) return null;

  const { draft } = card;
  const numbers = numbersOf(draft);
  const patch = patchFor(measureId, numbers);

  const save = (): void => {
    // What the inputs showed when the button was pressed — `patch` is made of
    // it: the answer can be a server's, and the visitor goes on typing while it
    // is on its way.
    setCard((current) => ({ ...current, sent: draft }));
    setState("saving");
    startTransition(async () => {
      const result = await repo.setFit(patch);
      if (result.ok) {
        // The card shows what was stored — which is not always what was typed
        // (`patchFor`) — in every field the visitor has left alone since the
        // save was sent. A field typed in since is a new number, not saved
        // yet. `sent` is `null` when another bike took the card meanwhile.
        setCard((current) =>
          current.sent === null
            ? current
            : {
                ...current,
                shown: result.data,
                draft: follow(fields, current.draft, current.sent, draftOf(fields, result.data)),
                sent: null,
              },
        );
        setState("saved");
        return;
      }
      setErrorKey(result.fieldErrors?.form ?? `errors.${result.code}`);
      setState("error");
    });
  };

  const invalid = fields.some(
    (field) =>
      draft[field.key] !== "" && !isValidFitValue(field.key, numbers[field.key] ?? Number.NaN),
  );

  return (
    <form
      className={cn("flex flex-col gap-3", className)}
      data-testid={`measure-form-${measureId}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid && repo.canEdit) save();
      }}
    >
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <Label htmlFor={`fit-${field.key}`}>{t(`fit.fields.${field.key}` as never)}</Label>
          <Input
            id={`fit-${field.key}`}
            name={field.key}
            type="number"
            inputMode="decimal"
            step={field.step}
            min={field.min}
            max={field.max}
            // 16 px at EVERY width: shadcn's Input drops to `md:text-sm` (14 px), and
            // an input under 16 px makes iOS Safari zoom the page on focus (§6.8 AC5).
            className="min-h-[var(--tap-min)] text-base md:text-base"
            value={draft[field.key] ?? ""}
            disabled={!repo.canEdit}
            data-fit-field={field.key}
            onChange={(event) => {
              // Read the value BEFORE the updater: React nulls `currentTarget`
              // once the handler returns, and a state updater runs during the
              // next render — long after that.
              const next = event.currentTarget.value;
              setCard((current) => ({
                ...current,
                draft: { ...current.draft, [field.key]: next },
              }));
            }}
          />
        </div>
      ))}

      <Readout measureId={measureId} build={build} values={numbers} stored={card.shown} />

      {repo.canEdit ? (
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={invalid || state === "saving"}
            className="min-h-[var(--tap-min)]"
          >
            {t("fit.save")}
          </Button>
          <p
            role="status"
            aria-live="polite"
            className="text-ink-muted text-sm"
            data-testid={`measure-state-${measureId}`}
          >
            {state === "saved"
              ? t("fit.saved")
              : state === "saving"
                ? t("fit.saving")
                : state === "error"
                  ? actionText(errorKey)
                  : ""}
          </p>
        </div>
      ) : (
        <p className="text-ink-muted text-sm">{t("fit.demoNotice")}</p>
      )}
    </form>
  );
}

/** `LOCAL_BIKE_PENDING` until a guest's storage has been read; `null` for no bike at all. */
type RecordOwner = string | null | typeof LOCAL_BIKE_PENDING;

/** The inputs, and what they were last brought in line with. */
interface Card {
  owner: RecordOwner;
  /** The record as it was read then; another object here is a record read again. */
  known: BikeFit;
  /**
   * What a field nobody has typed in shows: `known`, or what this card stored
   * since — a save is ahead of the record it will be read back from, and a
   * saved bike's `fit` prop only catches up if the page is rendered again.
   */
  shown: BikeFit;
  /** What the inputs hold. */
  draft: Record<string, string>;
  /**
   * What the inputs held when the last save was sent, moved with the record
   * wherever the record has moved an untouched field since. Read only by that
   * save's answer, when it has succeeded; `null` before any save, once one has
   * been shown, and when another bike has taken the card.
   */
  sent: Record<string, string> | null;
}

function draftOf(fields: readonly FitFieldDef[], fit: BikeFit): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field.key, fit[field.key] === undefined ? "" : String(fit[field.key])]),
  );
}

/**
 * `draft` once what stood behind it has gone from `from` to `to` — three sets
 * of inputs, each holding every field of the card.
 *
 * A field still showing what `from` shows has not been typed in, and follows.
 * A field showing anything else is the visitor's and comes back exactly as it
 * is. Compared as the TEXT in the input, not as numbers and not through a
 * "touched" flag: a number typed and then deleted is an untouched field again,
 * and `from` is just as well what the inputs showed when a save was sent.
 *
 * Two corners that come with comparing text, both left as they are. A number
 * typed and not saved that the record then comes to hold — another tab saved
 * the same one — is an untouched field from there on, and follows the next
 * change. And a number input reports "" for text it cannot read (a lone "-"),
 * so a half-typed field over an empty record counts as untouched until it
 * reads as a number.
 */
function follow(
  fields: readonly FitFieldDef[],
  draft: Record<string, string>,
  from: Record<string, string>,
  to: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      draft[field.key] === from[field.key] ? to[field.key] : draft[field.key],
    ]),
  );
}

function numbersOf(draft: Record<string, string>): Partial<Record<FitKey, number>> {
  const values: Partial<Record<FitKey, number>> = {};
  for (const [key, raw] of Object.entries(draft)) {
    if (raw.trim() === "") continue;
    const value = Number(raw);

    if (Number.isFinite(value)) values[key as FitKey] = value;
  }
  return values;
}

/**
 * What a card stores when it is saved.
 *
 * Usually the typed fields themselves; `saddle-height` is the exception the
 * plan names: the rider types their **inseam** and the bike remembers the
 * **saddle height** the LeMond formula gives (§6.8 AC12 — inseam 84 writes
 * `fit.saddleHeightMm = 742`).
 */
export function patchFor(
  measureId: GeometryMeasureId,
  values: Partial<Record<FitKey, number>>,
): BikeFit {
  const patch: BikeFit = { ...values };
  if (measureId === "saddle-height" && values.inseamCm !== undefined) {
    patch.saddleHeightMm = saddleHeightMmFromInseam(values.inseamCm);
  }
  return patch;
}

/** The number the inputs imply — the point of the card. */
function Readout({
  measureId,
  build,
  values,
  stored,
}: {
  measureId: GeometryMeasureId;
  build: BikeBuild;
  values: Partial<Record<FitKey, number>>;
  stored: BikeFit;
}): React.JSX.Element | null {
  const t = useTranslations("bike");
  const format = useFormatter();
  const number = (value: number, digits = 1): string =>
    format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  if (measureId === "saddle-height") {
    const inseam = values.inseamCm;
    if (inseam === undefined) return null;
    return (
      <p className="text-ink text-sm" data-testid="readout-saddle-height">
        {t("fit.units.cm", { value: number(saddleHeightLeMond(inseam)) })}
      </p>
    );
  }

  if (measureId === "tire-pressure") {
    const width = tireWidth(build);
    const pressure =
      values.riderKg === undefined || values.bikeKg === undefined || width === null
        ? null
        : tirePressure({
            riderKg: values.riderKg,
            bikeKg: values.bikeKg,
            widthMm: width,
            tubeless: build.spec.tires.system === "tubeless",
          });
    if (pressure === null) return null;
    return (
      <p className="text-ink text-sm" data-testid="readout-tire-pressure">
        {t("fit.pressure", {
          front: number(pressure.front),
          rear: number(pressure.rear),
        })}
      </p>
    );
  }

  if (measureId === "sag") {
    const percent = values.sagPercent;
    if (percent === undefined) return null;
    const target = sagTargetFor(
      build.spec.suspension.rear ? "shock" : "fork",
      build.spec.suspension.rear,
    );
    const [min, max] = sagRange(target);
    return (
      <p className="text-ink text-sm" data-testid="readout-sag">
        {t(`fit.sag.${sagVerdict(percent, target)}` as never)} —{" "}
        {t("fit.sag.target", { min: String(min), max: String(max) })}
      </p>
    );
  }

  if (measureId === "chain-wear") {
    const mm = values.chainWearMm;
    if (mm === undefined) return null;
    const speeds = build.spec.drivetrain.speeds;
    return (
      <p className="text-ink text-sm" data-testid="readout-chain-wear">
        {t(`fit.chainWear.${chainWearFromRuler(mm, speeds)}` as never)}
      </p>
    );
  }

  // Every other measure is a plain number: the input itself is the readout.
  void stored;
  return null;
}

/** The fitted tyre's ETRTO width, for the pressure table. */
function tireWidth(build: BikeBuild): number | null {
  for (const partId of ["tire-rear", "tire-front"]) {
    const part = findPart(build, partId);
    const width = part?.attributes["etrto-width"];
    if (typeof width === "number") return width;
  }
  return null;
}
