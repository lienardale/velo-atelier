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
  // Built here rather than passed in: a repo holds functions, and the fit page
  // is a Server Component, which can only hand a client one serialisable props.
  const repo = useMemo(
    () =>
      bikeRepoFor(refKind, {
        bikeId,
        actions: {
          updatePart: (input) => updateBikePartAction(input),
          updateFit: (input) => updateBikeFitAction(input),
        },
      }),
    [refKind, bikeId],
  );

  // A guest bike's fit lives in `localStorage`, which the server could not read;
  // a saved bike's arrived as a prop. Either way `known` is the value on record.
  const snapshot = useLocalBikeSnapshot();
  const known = useMemo(
    () =>
      refKind === "local" && snapshot !== LOCAL_BIKE_PENDING && snapshot !== null
        ? coerceFit(snapshot.fit)
        : fit,
    [refKind, snapshot, fit],
  );

  const fields = fitFieldsFor(measureId);
  const [stored, setStored] = useState<BikeFit>(known);
  const [draft, setDraft] = useState<Record<string, string>>(() => draftOf(fields, known));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorKey, setErrorKey] = useState<string>("errors.VALIDATION");
  const [, startTransition] = useTransition();

  // Seeding the inputs from what is on record, adjusted during render rather
  // than in an effect: `known` only changes when storage does (the snapshot is
  // memoised on the raw string), so this runs once per real change instead of
  // scheduling a second render every time.
  if (stored !== known) {
    setStored(known);
    setDraft(draftOf(fields, known));
  }

  if (fields.length === 0) return null;

  const numbers = numbersOf(draft);
  const patch = patchFor(measureId, numbers);

  const save = (): void => {
    setState("saving");
    startTransition(async () => {
      const result = await repo.setFit(patch);
      if (result.ok) {
        setStored(result.data);
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
              setDraft((current) => ({ ...current, [field.key]: next }));
            }}
          />
        </div>
      ))}

      <Readout measureId={measureId} build={build} values={numbers} stored={stored} />

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

function draftOf(fields: readonly FitFieldDef[], fit: BikeFit): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field.key, fit[field.key] === undefined ? "" : String(fit[field.key])]),
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
