"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionFailure } from "@/lib/actions/result";
import type { BikeRepo } from "@/lib/bike/repo";
import { partDefinition } from "@/lib/domain/data/parts";
import { isAttributePresent } from "@/lib/domain/engine/parts-for-spec";
import type { AttributeDef, AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import { cn } from "@/lib/utils";

import { useBikeActionText } from "./action-text";
import { usePartsText } from "./parts-text";

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
 *
 * ## One form per PART — three rules, each a defect that was live (`.debug/017` §5.8)
 *
 * The panel does not unmount when the selection changes: a part picked ON THE
 * BIKE (a mesh, the silhouette, `?part=` on a history move) changes `partId`
 * under the "Infos" tab without changing the tab. Until 2026-10-09 this form
 * had no identity of its own, so React kept the same instance and the same
 * `<input>` for the next part. The input went on showing the PREVIOUS part's
 * value (React assigns `element.value` at mount, which sets HTML's dirty flag:
 * the field no longer follows `defaultValue`), under that part's "Enregistré",
 * and the next blur wrote it to the new part. A stock dropper post's travel
 * went from 170 to 140 that way with nothing typed.
 *
 *   1. **The form is keyed by the part.** {@link PartEditForm} renders its
 *      fields under `key={partId}`, HERE and not at the call site, so that no
 *      caller can forget it. A new part is a new instance: new inputs, an empty
 *      status map, and a `partId` that never changes during an instance's life
 *      — which is what makes every write below carry the part the field was
 *      rendered for, never the one selected when the write happens.
 *   2. **A write needs an edit.** A number or text field commits only what the
 *      visitor typed since its last commit, and only if that is not what is
 *      stored. Focusing a field and leaving it sends nothing. (It used to send
 *      whatever the DOM held, which is how a stale field became a write.)
 *   3. **Typed text is committed when the field goes away.** React runs no
 *      `onBlur` for a node it removes — and a browser that does fire `blur`
 *      during the removal (Chromium 153 does: measured) fires it inside React's
 *      commit, where React ignores events. So a value typed and not left was
 *      dropped when the next press was another tab, in a real browser, and
 *      would be dropped by rule 1 whenever the part changes under a focused
 *      field. The field flushes it from a layout-effect cleanup instead.
 *
 * A write that answers after its form is gone — the flush of rule 3, or an
 * ordinary save overtaken by the next selection — has no field left to report
 * under. Success needs nothing said: `onSaved` still hands the build up, and
 * the part shows the value the next time it is opened. A refusal is raised as
 * a notice naming the part and the field ({@link PartFields}' `reportUnsaved`).
 *
 * Rule 3 covers every way the field can leave the page while the page lives:
 * another part, another tab, the panel rebuilt between its two layouts, the
 * route itself. It does NOT cover the page being unloaded with the caret
 * still in the field (a reload, a closed tab): nothing is unmounted then, and
 * a saved bike's write would be a request the browser is free to drop.
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

/** The message key a refused write of `attribute` is rendered with. */
function refusalKey(attribute: AttributeDef, refusal: ActionFailure): string {
  return refusal.fieldErrors?.[attribute.key] ?? `errors.${refusal.code}`;
}

/**
 * How long the "not saved" notice stays (sonner's default is four seconds):
 * it names a part the visitor has already left, and has to be read.
 */
const UNSAVED_NOTICE_MS = 20_000;

/** Rule 1: one instance per part. The key belongs here — see the header. */
export function PartEditForm(props: PartEditFormProps): React.JSX.Element | null {
  return <PartFields key={props.partId} {...props} />;
}

function PartFields({
  build,
  partId,
  repo,
  onSaved,
  className,
}: PartEditFormProps): React.JSX.Element | null {
  const t = useTranslations("bike");
  const partsText = usePartsText();
  const actionText = useBikeActionText();
  const definition = partDefinition(partId);
  const part = build.parts.find((candidate) => candidate.partId === partId);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [, startTransition] = useTransition();

  // Is this form still on screen? Asked when a write ANSWERS, not when it is
  // sent: the answer is what needs a field to be shown under.
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (definition === undefined || part === undefined) return null;

  const editable = definition.attributes.filter(
    (attribute) => attribute.editable && isAttributePresent(attribute, build.spec),
  );
  if (editable.length === 0) return null;

  /**
   * The field that would have shown the refusal is gone: say it where the
   * visitor still is, naming the part and the field it was about.
   * `messageKey` is `null` when the write did not answer at all.
   */
  const reportUnsaved = (attribute: AttributeDef, messageKey: string | null): void => {
    const title = t("panel.unsaved", {
      part: partsText(`parts.${partId}.label`),
      field: partsText(attribute.labelKey),
    });
    const description = messageKey === null ? undefined : actionText(messageKey);
    // Imported here, not at module scope: a static import would put sonner in
    // this route's first-load JS (see components/ui-ext/Notices.tsx).
    void import("sonner").then(({ toast }) =>
      toast.error(title, { description, duration: UNSAVED_NOTICE_MS }),
    );
  };

  const save = (attribute: AttributeDef, value: AttributeValue | null): void => {
    setFields((current) => ({ ...current, [attribute.key]: { status: "saving" } }));
    startTransition(async () => {
      let result: Awaited<ReturnType<BikeRepo["setAttribute"]>>;
      try {
        result = await repo.setAttribute(build, { partId, key: attribute.key, value });
      } catch (error) {
        // A write that did not answer is the error boundary's while this form
        // is there to be replaced by it — and a notice once it is not.
        if (mounted.current) throw error;
        reportUnsaved(attribute, null);
        return;
      }
      if (result.ok) {
        setFields((current) => ({ ...current, [attribute.key]: { status: "saved" } }));
        onSaved?.(result.data);
        return;
      }
      const messageKey = refusalKey(attribute, result);
      if (!mounted.current) {
        reportUnsaved(attribute, messageKey);
        return;
      }
      setFields((current) => ({
        ...current,
        [attribute.key]: { status: "error", messageKey },
      }));
    });
  };

  /**
   * Rule 3's write: the field is being removed, so nothing of this form's
   * state is touched — no status, no transition. The call itself is made
   * synchronously (a guest bike is in storage before this returns).
   */
  const saveOnRemoval = (attribute: AttributeDef, value: AttributeValue | null): void => {
    void (async () => {
      try {
        const result = await repo.setAttribute(build, { partId, key: attribute.key, value });
        if (result.ok) onSaved?.(result.data);
        else reportUnsaved(attribute, refusalKey(attribute, result));
      } catch {
        reportUnsaved(attribute, null);
      }
    })();
  };

  /** The field shows what is stored again: an earlier refusal no longer applies. */
  const settle = (attribute: AttributeDef): void => {
    setFields((current) =>
      current[attribute.key]?.status === "error"
        ? { ...current, [attribute.key]: { status: "idle" } }
        : current,
    );
  };

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="part-edit-form">
      {editable.map((attribute) => {
        const state = fields[attribute.key] ?? { status: "idle" };

        const value = part.attributes[attribute.key];
        const fieldId = `attr-${partId}-${attribute.key}`;

        return (
          <div key={attribute.key} className="flex flex-col gap-1">
            <Label htmlFor={fieldId}>{partsText(attribute.labelKey)}</Label>
            <AttributeControl
              id={fieldId}
              attribute={attribute}
              value={value}
              disabled={!repo.canEdit || state.status === "saving"}
              refused={state.status === "error"}
              onCommit={(next) => save(attribute, next)}
              onCommitOnRemoval={(next) => saveOnRemoval(attribute, next)}
              onUnchanged={() => settle(attribute)}
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
                    ? actionText(state.messageKey)
                    : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

interface AttributeControlProps {
  id: string;
  attribute: AttributeDef;
  value: AttributeValue | undefined;
  disabled: boolean;
  /** The last commit of this field was refused, and it still shows that text. */
  refused: boolean;
  onCommit: (value: AttributeValue | null) => void;
  /** As `onCommit`, for text the field still held when it was removed. */
  onCommitOnRemoval: (value: AttributeValue | null) => void;
  /** The field was left showing exactly what is stored. */
  onUnchanged: () => void;
}

function AttributeControl(props: AttributeControlProps): React.JSX.Element {
  const { id, attribute, value, disabled, onCommit } = props;
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

  // A component of its own: hooks cannot follow the two early returns above.
  return <TypedControl {...props} />;
}

/** What a number or text field holds, as the value a write would carry. */
function typedValue(attribute: AttributeDef, text: string): AttributeValue | null {
  const raw = text.trim();
  if (raw === "") return null;
  return attribute.kind === "number" ? Number(raw) : raw;
}

/** Is `next` what the part already holds? `null` is "no value", i.e. nothing stored. */
function isStored(next: AttributeValue | null, stored: AttributeValue | undefined): boolean {
  return next === null ? stored === undefined : next === stored;
}

/**
 * A number or text attribute: committed on blur, so every keystroke is not a
 * write — and, since 2026-10-09, committed when the field is REMOVED with text
 * the visitor typed and never left (rule 3 of the header).
 *
 * Uncontrolled on purpose: `typed` is the record of what the visitor has typed
 * since the last commit, and it is what both exits read. A write therefore
 * always has an edit behind it (rule 2) — except the retry of a refused value,
 * which leaving the field has always done and still does.
 */
function TypedControl({
  id,
  attribute,
  value,
  disabled,
  refused,
  onCommit,
  onCommitOnRemoval,
  onUnchanged,
}: AttributeControlProps): React.JSX.Element {
  const stored = value === undefined ? "" : String(value);
  const input = useRef<HTMLInputElement>(null);
  /** Text typed since the last commit; `null` when nothing is uncommitted. */
  const typed = useRef<string | null>(null);

  // What the removal has to read is the LAST render's, not the first's.
  const latest = useRef({ attribute, value, onCommitOnRemoval });
  useLayoutEffect(() => {
    latest.current = { attribute, value, onCommitOnRemoval };
  });

  // An untouched field says what is stored. `defaultValue` alone stops doing
  // that the moment the field has a value of its own, which React gives it at
  // mount: a write that answers after the field was mounted (rule 3's, when
  // the visitor comes straight back to the part) would leave the old number
  // on screen. Text the visitor is in the middle of typing is never replaced.
  useLayoutEffect(() => {
    const node = input.current;
    if (node === null || typed.current !== null) return;
    if (node.value !== stored) node.value = stored;
  }, [stored]);

  // Rule 3. On unmount only: the node is still in the document here, and no
  // `onBlur` will ever come for it.
  useLayoutEffect(
    () => () => {
      const text = typed.current;
      if (text === null) return;
      typed.current = null;
      const next = typedValue(latest.current.attribute, text);
      if (!isStored(next, latest.current.value)) latest.current.onCommitOnRemoval(next);
    },
    [],
  );

  return (
    <Input
      ref={input}
      id={id}
      type={attribute.kind === "number" ? "number" : "text"}
      inputMode={attribute.kind === "number" ? "decimal" : undefined}
      defaultValue={stored}
      min={attribute.min}
      max={attribute.max}
      disabled={disabled}
      className="min-h-[var(--tap-min)] text-base md:text-base"
      data-attr={attribute.key}
      onChange={(event) => {
        typed.current = event.currentTarget.value;
      }}
      onBlur={(event) => {
        const edited = typed.current !== null;
        typed.current = null;
        // Rule 2: nothing typed, nothing sent.
        if (!edited && !refused) return;
        const next = typedValue(attribute, event.currentTarget.value);
        if (isStored(next, value)) return onUnchanged();
        onCommit(next);
      }}
    />
  );
}
