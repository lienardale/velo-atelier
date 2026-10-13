"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadToast } from "@/components/ui-ext/Notices";
import type { ActionFailure } from "@/lib/actions/result";
import type { BikeRepo } from "@/lib/bike/repo";
import { fieldOf, isInDoubt, sendTracked } from "@/lib/bike/own-writes";
import { partDefinition } from "@/lib/domain/data/parts";
import { defaultAttributeValue, isAttributePresent } from "@/lib/domain/engine/parts-for-spec";
import type { AttributeDef, AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import { cn } from "@/lib/utils";

import { useBikeActionText } from "./action-text";
import { usePartsText } from "./parts-text";
import { showUnsavedNotice } from "./UnsavedNotices";

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
 *      "What is stored" is only what this form was last TOLD: while a write of
 *      the same field is in flight, and for as long as the page does not say
 *      what this document's last write of it left, the comparison is not made
 *      and the edit is sent (`lib/bike/own-writes.ts`).
 *   3. **Typed text is committed when the field goes away.** React runs no
 *      `onBlur` for a node it removes — and a browser that does fire `blur`
 *      during the removal (Chromium 153 does: measured) fires it inside React's
 *      commit, where React ignores events. So a value typed and not left was
 *      dropped when the next press was another tab, in a real browser, and
 *      would be dropped by rule 1 whenever the part changes under a focused
 *      field. The field flushes it from a layout-effect cleanup instead.
 *
 * ### What rule 3 commits — and the one thing it never does
 *
 * What leaving the field would have: the value typed, or a CLEAR when the
 * visitor emptied the field (new with rule 3: an emptied field that was not
 * left used to keep its value).
 *
 * Never text the browser cannot read as a number — `45.` on the way to 45.5, a
 * lone minus, `4e`. A number input reports those as an EMPTY `value`, with
 * `validity.badInput` as the only sign that anything is in the field at all.
 * As first written, rule 3 sent that empty value as a clear: the stored width
 * deleted, the write answering ok, and nothing said — on exits where, before
 * rule 3 existed, the stored value survived (measured in Chromium 153, guest
 * and saved; `.debug/017` §5.8, "Review of the fix"). So the field records
 * `badInput` beside the text on every keystroke (`TypedControl`'s `record`
 * says why `onChange` alone is not that), and one removed holding unreadable
 * text sends NOTHING: the stored value stays, and the visitor is told, by the
 * notice below. LEAVING such a field still clears the attribute, as it does
 * on `main`: that exit is older than this form's three rules and is the
 * maintainer's to rule on (`docs/backlog.md`).
 *
 * ### A write that answers after its form is gone
 *
 * — the flush of rule 3, or an ordinary save overtaken by the next selection —
 * has no field left to report under. Success needs nothing said: `onSaved`
 * still hands the build up, and the part shows the value the next time it is
 * opened. A refusal is raised as a notice naming the part and the field
 * ({@link PartFields}' `reportUnsaved`).
 *
 * That notice must not need the network: a write that does not answer is first
 * of all a connection that went. It is a toast taken from the layout's host
 * (`loadToast`, `components/ui-ext/Notices.tsx`), which is in memory from a
 * moment after hydration; should even that be missing, the sentence is shown
 * in the workspace's own region (`UnsavedNotices`). Not sonner's "rich" error
 * colours: #e60000 on #fff0f0 is 4.34:1 at 13 px, which axe reports as a
 * serious `color-contrast` violation.
 *
 * Rule 3 covers every way the field can leave the page while the page lives:
 * another part, another tab, the panel rebuilt between its two layouts, the
 * route itself. It does NOT cover the page being unloaded with the caret
 * still in the field (a reload, a closed tab): nothing is unmounted then, and
 * a saved bike's write would be a request the browser is free to drop.
 *
 * And it sends to the bike the REPO writes — for a guest bike, the ONE bike
 * the workspace was mounted for, never whichever is in storage at that
 * moment (`localBikeRepo(bikeId)`, `lib/bike/repo.ts`). `va:bike:local` is a
 * slot, and another page of the same browser can put a NEW guest bike in it
 * while a field here still holds typed text: the workspace is then mounted
 * again for the new bike, and this field's removal used to write its text to
 * THAT bike — 45 typed for one bike's front tyre stored for another's, and
 * nothing said (measured in jsdom, and in Chromium with two pages of one
 * context driven at once; a person's tab switch takes the focus out of the
 * field first, which commits the text to the bike that is still there —
 * `.debug/017` §5.8, "Fourth review"). Now that write is refused
 * (`NOT_FOUND`), nothing is stored, and it ends in the notice above, naming
 * the part and the field: the text is lost, as it was before rule 3, and the
 * visitor is told. The same holds for an ordinary save by a form that has not
 * yet heard its bike was replaced: refused, under its own field.
 *
 * **Said under a field that is about to go** — a decision, not an oversight.
 * That second refusal is shown where every ordinary save reports, under the
 * field, and nowhere else: no notice is raised. The field belongs to the
 * workspace of the bike that was replaced, and that workspace is removed as
 * soon as the page IS told (the `storage` event): the line goes with it, and
 * from then on nothing that stays on the page says the value was not saved
 * (measured in jsdom through the real `BikeWorkspace` by the fourth repair's
 * verifier, 2026-10-12: after the event, no "Introuvable." on the page, no
 * toast, nothing in the workspace's own region; not looked for in a browser —
 * the window is the delivery of one `storage` event). The removal's refusal,
 * just above, is the one announced for twenty seconds. Raising the notice
 * here as well is the alternative, and was not taken: it would change what a
 * refused save says, on a path whose window is one event. A case of
 * `BikeWorkspace.test.tsx` pins what is done ("the bike replaced and the
 * event not delivered yet; 45 typed and the field LEFT"), so that changing
 * it is a choice somebody makes and not something that happens.
 *
 * On a route change the flush is one more thing: a write sent WHILE ANOTHER IS
 * IN FLIGHT. Next's client sends server actions one at a time until a
 * navigation arrives; the navigation takes the pending action's turn and the
 * next one goes at once. `updateBikePartAction` therefore takes the bike row's
 * lock before it reads (its header says how) — nothing here orders the two.
 *
 * And it is a write whose answer may find the visitor BACK on the bike, in a
 * workspace mounted again over a page that has not been told: still in
 * flight, or answered to a workspace that is gone. What this form knows of
 * its own writes is therefore kept per bike, not per mount, and past their
 * answers (`lib/bike/own-writes.ts`) — per BIKE, which `repo.bikeKey()`
 * names: a guest bike by its own id, not by the `local` of its route, where
 * the next guest bike will be found. Two writes of ONE field in transit
 * together are still not ordered by anything: the server applies them as
 * they arrive (`docs/backlog.md`).
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

/**
 * The message key a refused write of `attribute` is rendered with: the
 * field's own reason, else the form-level one (a guest bike whose storage is
 * full answers `fieldErrors.form`, `lib/bike/repo.ts`), else the code's.
 */
function refusalKey(attribute: AttributeDef, refusal: ActionFailure): string {
  return (
    refusal.fieldErrors?.[attribute.key] ?? refusal.fieldErrors?.form ?? `errors.${refusal.code}`
  );
}

/** The reason given for text a number field could not read: the domain's own, for a value it refuses. */
const UNREADABLE_KEY = "bike.errors.invalid-value";

/**
 * How long the "not saved" notice stays (sonner's default is four seconds):
 * it names a part the visitor has already left, and has to be read.
 */
const UNSAVED_NOTICE_MS = 20_000;

/**
 * What a page says of a field, whether the bike holds a value for it or not.
 *
 * A field that was CLEARED holds nothing — and that is said in two ways: the
 * build a write answers with has no such attribute, and a page rendered later
 * has the catalogue's default there, because a bike is derived again from its
 * answers each time it is loaded (`mergeAttributes`, `lib/bike/rules.ts`). To
 * tell whether a page says what a write left, the two are the same thing.
 */
function asPagesSayIt(
  attribute: AttributeDef,
  build: BikeBuild,
  value: AttributeValue | undefined,
): AttributeValue | undefined {
  return value ?? defaultAttributeValue(attribute, build.spec) ?? undefined;
}

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
    // Set here too, not only by `useRef`: under StrictMode — `npm run dev` —
    // React runs this effect, its cleanup, and the effect again on the same
    // instance, and a form left at `false` would raise every refusal as a
    // notice and keep a thrown write from `error.tsx`.
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
    // `loadToast`, never an `import("sonner")` of this module's own: that is a
    // chunk the page has not requested, and this sentence is for when the
    // network is down (see the header). `richColors: false` for its contrast.
    void loadToast()
      .then((toast) => {
        toast.error(title, { description, duration: UNSAVED_NOTICE_MS, richColors: false });
      })
      .catch(() => {
        showUnsavedNotice(title, description, UNSAVED_NOTICE_MS);
      });
  };

  /** The one way a write leaves this form, and onto its record. The call itself is synchronous. */
  const write = (attribute: AttributeDef, value: AttributeValue | null) =>
    sendTracked(
      fieldOf(repo.bikeKey(), partId, attribute.key),
      () => repo.setAttribute(build, { partId, key: attribute.key, value }),
      // What the write left in the field, as the build it answered with says it.
      (answer) =>
        answer.ok
          ? {
              value: asPagesSayIt(
                attribute,
                answer.data,
                answer.data.parts.find((candidate) => candidate.partId === partId)?.attributes[
                  attribute.key
                ],
              ),
            }
          : null,
    );

  const save = (attribute: AttributeDef, value: AttributeValue | null): void => {
    setFields((current) => ({ ...current, [attribute.key]: { status: "saving" } }));
    startTransition(async () => {
      let result: Awaited<ReturnType<BikeRepo["setAttribute"]>>;
      try {
        result = await write(attribute, value);
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
    const sent = write(attribute, value);
    void (async () => {
      try {
        const result = await sent;
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
              saving={state.status === "saving"}
              refused={state.status === "error"}
              isInDoubt={() =>
                isInDoubt(
                  fieldOf(repo.bikeKey(), partId, attribute.key),
                  asPagesSayIt(attribute, build, value),
                )
              }
              onCommit={(next) => save(attribute, next)}
              onCommitOnRemoval={(next) => saveOnRemoval(attribute, next)}
              onUnreadableOnRemoval={() => reportUnsaved(attribute, UNREADABLE_KEY)}
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
  /** A write of this field, sent by THIS form, has not answered yet. */
  saving: boolean;
  /** The last commit of this field was refused, and it still shows that text. */
  refused: boolean;
  /**
   * Is `value` in doubt? A write of this field of this bike — by this form or
   * by one that is gone — is in flight, or the last one left something else
   * than `value`. It is then not to be compared with.
   */
  isInDoubt: () => boolean;
  onCommit: (value: AttributeValue | null) => void;
  /** As `onCommit`, for text the field still held when it was removed. */
  onCommitOnRemoval: (value: AttributeValue | null) => void;
  /** The field was removed holding text the browser could not read as a number. */
  onUnreadableOnRemoval: () => void;
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

/** What the visitor has typed into a field since its last commit. */
interface Typed {
  /** The field's `value` — EMPTY for text a number input cannot read. */
  text: string;
  /** `validity.badInput`: there are characters in the field that `text` does not show. */
  unreadable: boolean;
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
  saving,
  refused,
  isInDoubt,
  onCommit,
  onCommitOnRemoval,
  onUnreadableOnRemoval,
  onUnchanged,
}: AttributeControlProps): React.JSX.Element {
  const stored = value === undefined ? "" : String(value);
  const input = useRef<HTMLInputElement>(null);
  /** `null` when nothing is uncommitted. */
  const typed = useRef<Typed | null>(null);

  /**
   * Kept on every native `input` event AND on React's `change`, which are not
   * the same thing: React fires `onChange` only when the value it tracks has
   * MOVED, and for a number input "emptied" and "emptied, then a minus typed"
   * are the same empty value. With `onChange` alone the second was still on
   * record as the first — a field the visitor had cleared — and its removal
   * deleted the stored value (measured in Chromium 153, on the first repair
   * of this very defect). `onInput` is told of every keystroke.
   */
  const record = (node: HTMLInputElement): void => {
    typed.current = { text: node.value, unreadable: node.validity.badInput };
  };

  // What an effect has to read is the LAST render's, not the first's.
  const latest = useRef({
    attribute,
    value,
    saving,
    isInDoubt,
    onCommitOnRemoval,
    onUnreadableOnRemoval,
  });
  useLayoutEffect(() => {
    latest.current = {
      attribute,
      value,
      saving,
      isInDoubt,
      onCommitOnRemoval,
      onUnreadableOnRemoval,
    };
  });

  // An untouched field says what is stored. `defaultValue` alone stops doing
  // that the moment the field has a value of its own, which React gives it at
  // mount: a write that answers after the field was mounted (rule 3's, when
  // the visitor comes straight back to the part) would leave the old number
  // on screen. Text the visitor is in the middle of typing is never replaced —
  // and neither is the value this field is in the middle of SAVING: an earlier
  // write of the same field answering first would otherwise put its number
  // back in the field for as long as the later one takes.
  useLayoutEffect(() => {
    const node = input.current;
    if (node === null || typed.current !== null || latest.current.saving) return;
    if (node.value !== stored) node.value = stored;
  }, [stored]);

  // Rule 3. On unmount only: the node is still in the document here, and no
  // `onBlur` will ever come for it.
  useLayoutEffect(
    () => () => {
      const edit = typed.current;
      if (edit === null) return;
      typed.current = null;
      const last = latest.current;
      // Never a clear: the empty `text` is the browser's, not the visitor's.
      if (edit.unreadable) return last.onUnreadableOnRemoval();
      const next = typedValue(last.attribute, edit.text);
      if (last.isInDoubt() || !isStored(next, last.value)) last.onCommitOnRemoval(next);
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
      onInput={(event) => record(event.currentTarget)}
      onChange={(event) => record(event.currentTarget)}
      onBlur={(event) => {
        const edited = typed.current !== null;
        typed.current = null;
        // Rule 2: nothing typed, nothing sent.
        if (!edited && !refused) return;
        const next = typedValue(attribute, event.currentTarget.value);
        if (!isInDoubt() && isStored(next, value)) return onUnchanged();
        onCommit(next);
      }}
    />
  );
}
