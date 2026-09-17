"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";

import { useViewerStore, useViewerStoreApi } from "@/components/bike3d/store";
import { partGroups, partIdsOfGroup, type PartGroup, type PartRow } from "@/lib/bike/queries";
import type { PartStatusValue } from "@/lib/bike/load-bike";
import type { PartId } from "@/lib/domain/data/parts";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { cn } from "@/lib/utils";

/**
 * The parts list (§6.4) — the **single accessibility mirror** of the 3D canvas.
 *
 * Everything the canvas can do, this can do, with a keyboard and a screen
 * reader: inspect a part (the `<button aria-current>` of its row), pick parts
 * for a partial checkup (a native `<input type=checkbox>`), and pick a whole
 * system at once (the checkbox in the `<legend>`). That is why it lives here
 * rather than in `components/bike3d/`: it is not a debug affordance next to the
 * viewer, it is the non-visual half of the same control, and a WebGL-less
 * browser gets the complete product from it plus the SVG silhouette.
 *
 * Selection is **bidirectional** and goes through the viewer store, so a tap on
 * a mesh marks the row and a click on a row moves the camera. Two consequences
 * this component owns:
 *
 *  - a selection that arrives from the canvas scrolls its row into view
 *    (`scrollIntoView({ block: 'nearest' })`, never `smooth` — the sheet is the
 *    scroll container and a smooth scroll fights a drag);
 *  - `Escape` on a row clears the selection and keeps focus where it is, which
 *    is what "Escape returns focus to the originating row" means when the row
 *    *is* the origin.
 *
 * Structure: one `<details open>` per system, a `<fieldset>` with the system's
 * name as its `<legend>`, hosted parts (`brake-pads-front` under
 * `brake-caliper-front`) in a nested `<ul>`. Native elements throughout — no
 * `role="tree"`, no roving tabindex: a parts list is a list, and every row
 * being tabbable is what makes "select every part with the keyboard" true.
 */
export interface PartsListProps {
  build: BikeBuild;
  /** Per-part status from a completed checkup; absent for guest bikes. */
  statuses?: Partial<Record<string, PartStatusValue>>;
  /** Show the partial-checkup checkboxes. */
  selectable?: boolean;
  /** Called when a row is activated, so the mobile sheet can snap to half. */
  onInspect?: (partId: PartId) => void;
  className?: string;
  id?: string;
}

export function PartsList({
  build,
  statuses,
  selectable = true,
  onInspect,
  className,
  id,
}: PartsListProps): React.JSX.Element {
  const groups = useMemo(() => partGroups(build), [build]);
  return (
    <div id={id} className={cn("flex flex-col gap-2", className)} data-testid="parts-list">
      {groups.map((group) => (
        <SystemGroup
          key={group.system}
          group={group}
          statuses={statuses}
          selectable={selectable}
          onInspect={onInspect}
        />
      ))}
    </div>
  );
}

function SystemGroup({
  group,
  statuses,
  selectable,
  onInspect,
}: {
  group: PartGroup;
  statuses?: Partial<Record<string, PartStatusValue>>;
  selectable: boolean;
  onInspect?: (partId: PartId) => void;
}): React.JSX.Element {
  const t = useTranslations("bike");
  const tParts = useTranslations("parts");
  const { api } = useViewerStoreApi();
  const picked = useViewerStore((state) => state.pickedPartIds);

  const ids = useMemo(() => partIdsOfGroup(group), [group]);
  const checkedCount = ids.filter((partId) => picked.has(partId)).length;
  const allChecked = checkedCount === ids.length && ids.length > 0;
  const someChecked = checkedCount > 0 && !allChecked;

  const toggleAll = (): void => {
    const state = api.getState();
    const next = new Set(state.pickedPartIds);
    for (const partId of ids) {
      if (allChecked) next.delete(partId);
      else next.add(partId);
    }
    state.setPicked(next);
  };

  return (
    <details open className="border-rule rounded-md border" data-system={group.system}>
      <summary className="flex min-h-[var(--tap-min)] cursor-pointer list-none items-center px-3 py-2 font-medium">
        {tParts(`systems.${group.system}` as never)}
      </summary>
      <fieldset className="px-3 pb-3">
        <legend className="sr-only">{tParts(`systems.${group.system}` as never)}</legend>
        {selectable ? (
          <label className="text-ink-muted flex min-h-[var(--tap-min)] items-center gap-2 text-sm">
            <IndeterminateCheckbox
              checked={allChecked}
              indeterminate={someChecked}
              onChange={toggleAll}
              data-testid={`select-system-${group.system}`}
            />
            {t("workspace.selectAll")}
          </label>
        ) : null}
        <ul className="flex flex-col">
          {group.rows.map((row) => (
            <PartRowItem
              key={row.partId}
              row={row}
              statuses={statuses}
              selectable={selectable}
              onInspect={onInspect}
            />
          ))}
        </ul>
      </fieldset>
    </details>
  );
}

/** A tri-state checkbox: `indeterminate` is a DOM property, not an attribute. */
function IndeterminateCheckbox({
  indeterminate,
  ...props
}: React.ComponentProps<"input"> & { indeterminate: boolean }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="size-5 shrink-0" {...props} />;
}

function PartRowItem({
  row,
  statuses,
  selectable,
  depth = 0,
  onInspect,
}: {
  row: PartRow;
  statuses?: Partial<Record<string, PartStatusValue>>;
  selectable: boolean;
  depth?: number;
  onInspect?: (partId: PartId) => void;
}): React.JSX.Element {
  const t = useTranslations("bike");
  const tParts = useTranslations("parts");
  const { api } = useViewerStoreApi();
  const selected = useViewerStore((state) => state.selectedPartId === row.partId);
  const picked = useViewerStore((state) => state.pickedPartIds.has(row.partId));
  const lastSource = useViewerStore((state) => state.lastSource);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A selection made anywhere but this list brings its row into view. `nearest`
  // and no smooth behaviour: the mobile sheet is the scroll container and a
  // smooth scroll would fight a finger that is still dragging it.
  useEffect(() => {
    if (!selected || lastSource === "list") return;
    buttonRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, lastSource]);

  const status = statuses?.[row.partId];
  const label = tParts(`${row.partId}.label` as never);

  return (
    <li data-part-id={row.partId} className={depth > 0 ? "ml-5" : undefined}>
      <div className="flex items-center gap-2">
        {selectable ? (
          <input
            type="checkbox"
            className="size-5 shrink-0"
            checked={picked}
            onChange={() => api.getState().togglePick(row.partId)}
            aria-label={t("workspace.pickPart", { part: label })}
            data-testid={`pick-${row.partId}`}
          />
        ) : null}
        <button
          ref={buttonRef}
          type="button"
          data-part-row={row.partId}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "hover:bg-paper-2 aria-[current=true]:bg-paper-2 flex min-h-[var(--tap-min)] flex-1",
            "items-center gap-2 rounded-md px-2 text-left text-sm aria-[current=true]:font-semibold",
          )}
          onClick={() => {
            api.getState().select(row.partId, { focus: true, source: "list" });
            onInspect?.(row.partId);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            api.getState().select(null, { source: "list" });
          }}
        >
          <span>{label}</span>
          {status && status !== "UNKNOWN" ? (
            <span
              data-status={status}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs",
                status === "OK" && "bg-success/15 text-success-fg",
                status === "ATTENTION" && "bg-warn/15 text-warn-fg",
                status === "BROKEN" && "bg-danger/15 text-danger-fg",
              )}
            >
              {t(`status.${status}` as never)}
            </span>
          ) : null}
        </button>
      </div>
      {row.hosted.length > 0 ? (
        <ul className="flex flex-col">
          {row.hosted.map((child) => (
            <PartRowItem
              key={child.partId}
              row={child}
              statuses={statuses}
              selectable={selectable}
              depth={depth + 1}
              onInspect={onInspect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
