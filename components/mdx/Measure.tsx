"use client";

import { useTranslations } from "next-intl";
import { useCallback, useId, useState } from "react";

import type { GeometryMeasureId } from "@/lib/domain/data/geometry-measures";

/** Where a measurement is remembered in the browser (§1.2 guest storage keys). */
export function measureStorageKey(id: string): string {
  return `va:measure:${id}`;
}

/** A decimal typed with a comma or a dot, or `null`. Negative numbers are allowed (bar drop). */
export function parseDecimal(input: string): number | null {
  const normalised = input.trim().replace(",", ".");
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored, the optional group starts with a literal dot: linear
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null;
  return Number(normalised);
}

/**
 * `<Measure id="saddle-height" unit="mm" target="…" />` inside a measure or
 * adjust guide: a labelled field where the visitor writes down what they just
 * measured. The value is kept on this device under `va:measure:<id>` (the fit
 * page of W2-T3 reads the same key), never sent anywhere.
 *
 * `inputMode="decimal"` brings up the numeric keypad and the 16 px font size
 * stops iOS from zooming into the field (§6.8 AC5). Storage access is wrapped:
 * private browsing throws on `localStorage`.
 */
export function Measure({
  id,
  unit,
  target,
}: {
  id: string;
  unit: string;
  target?: string;
}): React.JSX.Element {
  const t = useTranslations("guides");
  const tp = useTranslations("parts");
  const inputId = useId();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  const restore = useCallback(
    (node: HTMLInputElement | null) => {
      if (!node) return;
      try {
        const stored = window.localStorage.getItem(measureStorageKey(id));
        if (stored !== null && parseDecimal(stored) !== null) {
          setValue(stored);
          setSaved(true);
        }
      } catch {
        // Storage unavailable: the field simply starts empty.
      }
    },
    [id],
  );

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setValue(next);
    const parsed = parseDecimal(next);
    try {
      if (parsed === null) {
        window.localStorage.removeItem(measureStorageKey(id));
        setSaved(false);
      } else {
        window.localStorage.setItem(measureStorageKey(id), String(parsed));
        setSaved(true);
      }
    } catch {
      setSaved(false);
    }
  };

  const invalid = value.trim() !== "" && parseDecimal(value) === null;

  return (
    <figure
      data-testid="measure-figure"
      data-measure-id={id}
      className="flex flex-col gap-2 rounded-lg border border-rule bg-paper-2/50 p-4"
    >
      <label htmlFor={inputId} className="font-medium text-ink">
        {tp(`measures.${id as GeometryMeasureId}.label`)}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={restore}
          id={inputId}
          name={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={onChange}
          aria-invalid={invalid || undefined}
          className="tap-target w-32 rounded-md border border-rule bg-paper px-3 text-base text-ink"
        />
        <span className="text-ink-muted">{t("measure.suffix", { unit })}</span>
      </div>
      {target ? <p className="text-sm text-ink-muted">{t("measure.target", { target })}</p> : null}
      <p aria-live="polite" className="text-sm text-success-fg">
        {saved ? t("measure.saved") : ""}
      </p>
    </figure>
  );
}
