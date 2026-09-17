"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { translateMessageKey } from "@/lib/actions/result";
import type { BikeRepo } from "@/lib/bike/repo";
import { partDefinition } from "@/lib/domain/data/parts";
import { isAttributePresent } from "@/lib/domain/engine/parts-for-spec";
import type { AttributeDef, AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import { cn } from "@/lib/utils";

/**
 * The editable attributes of one part (§6.4, §6.8 AC11).
 *
 * Only **editable** attributes appear. The others mirror a decision-tree answer
 * — a brake type, a bar shape, the number of speeds of the drivetrain — and
 * changing them here would put the bike's own description at odds with its
 * parts; they are changed by re-answering the tree.
 *
 * ## One write per field, not one per form
 *
 * Each control saves on `change`/`blur` and shows its own outcome. A bike panel
 * is not a form to fill in: the visitor is looking up "what cassette is on this
 * bike", corrects the range, and moves on. A submit button they must find would
 * mean edits silently lost when they click the next part instead.
 *
 * ## Where the write goes
 *
 * `repo` decides — `localStorage` for the guest bike, `updateBikePartAction`
 * for a saved one (`lib/bike/repo.ts`). This component never knows which, which
 * is why the same panel serves `/velo/local` and `/velo/<uuid>` with no branch
 * (AC11 asserts both).
 */
export interface PartEditFormProps {
  build: BikeBuild;
  partId: string;
  repo: BikeRepo;
  /** Called with the build the repo returned, so the workspace re-renders. */
  onSaved?: (build: BikeBuild) => void;
  className?: string;
}

type FieldState = { status: "idle" | "saving" | "saved" } | { status: "error"; messageKey: string };

export function PartEditForm({
  build,
  partId,
  repo,
  onSaved,
  className,
}: PartEditFormProps): React.JSX.Element | null {
  const t = useTranslations("bike");
  const tRoot = useTranslations();
  const definition = partDefinition(partId);
  const part = build.parts.find((candidate) => candidate.partId === partId);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [, startTransition] = useTransition();

  if (definition === undefined || part === undefined) return null;

  const editable = definition.attributes.filter(
    (attribute) => attribute.editable && isAttributePresent(attribute, build.spec),
  );
  if (editable.length === 0) return null;

  const save = (attribute: AttributeDef, value: AttributeValue | null): void => {
    setFields((current) => ({ ...current, [attribute.key]: { status: "saving" } }));
    startTransition(async () => {
      const result = await repo.setAttribute(build, { partId, key: attribute.key, value });
      if (result.ok) {
        setFields((current) => ({ ...current, [attribute.key]: { status: "saved" } }));
        onSaved?.(result.data);
        return;
      }
      setFields((current) => ({
        ...current,
        [attribute.key]: {
          status: "error",
          messageKey: result.fieldErrors?.[attribute.key] ?? `errors.${result.code}`,
        },
      }));
    });
  };

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="part-edit-form">
      {editable.map((attribute) => {
        const state = fields[attribute.key] ?? { status: "idle" };

        const value = part.attributes[attribute.key];
        const fieldId = `attr-${partId}-${attribute.key}`;

        return (
          <div key={attribute.key} className="flex flex-col gap-1">
            <Label htmlFor={fieldId}>{tRoot(attribute.labelKey as never)}</Label>
            <AttributeControl
              id={fieldId}
              attribute={attribute}
              value={value}
              disabled={!repo.canEdit || state.status === "saving"}
              onCommit={(next) => save(attribute, next)}
            />
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "text-xs",
                state.status === "error" ? "text-danger-fg" : "text-ink-muted",
              )}
              data-testid={`attr-status-${attribute.key}`}
            >
              {state.status === "saved"
                ? t("panel.saved")
                : state.status === "saving"
                  ? t("panel.saving")
                  : state.status === "error"
                    ? translateMessageKey(tRoot, state.messageKey)
                    : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function AttributeControl({
  id,
  attribute,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  attribute: AttributeDef;
  value: AttributeValue | undefined;
  disabled: boolean;
  onCommit: (value: AttributeValue | null) => void;
}): React.JSX.Element {
  const t = useTranslations("bike");
  const tParts = useTranslations("parts");

  if (attribute.kind === "boolean") {
    return (
      <input
        id={id}
        type="checkbox"
        className="size-5"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onCommit(event.currentTarget.checked)}
        data-attr={attribute.key}
      />
    );
  }

  if (attribute.kind === "enum") {
    return (
      <select
        id={id}
        className="border-rule bg-paper text-ink min-h-[var(--tap-min)] rounded-md border px-2"
        value={value === undefined ? "" : String(value)}
        disabled={disabled}
        onChange={(event) =>
          onCommit(event.currentTarget.value === "" ? null : event.currentTarget.value)
        }
        data-attr={attribute.key}
      >
        <option value="">{t("panel.notSet")}</option>
        {(attribute.values ?? []).map((option) => (
          <option key={String(option)} value={String(option)}>
            {tParts(`values.${attribute.key}.${String(option)}` as never)}
          </option>
        ))}
      </select>
    );
  }

  // number and text: committed on blur, so every keystroke is not a write.
  return (
    <Input
      id={id}
      type={attribute.kind === "number" ? "number" : "text"}
      inputMode={attribute.kind === "number" ? "decimal" : undefined}
      defaultValue={value === undefined ? "" : String(value)}
      min={attribute.min}
      max={attribute.max}
      disabled={disabled}
      className="min-h-[var(--tap-min)] text-base md:text-base"
      data-attr={attribute.key}
      onBlur={(event) => {
        const raw = event.currentTarget.value.trim();
        if (raw === "") return onCommit(null);
        onCommit(attribute.kind === "number" ? Number(raw) : raw);
      }}
    />
  );
}
