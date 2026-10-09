"use client";

import { useSyncExternalStore } from "react";

/**
 * "This was not saved", said ON THE PAGE — the last resort of the part edit
 * form's late notice (`components/bike/PartEditForm.tsx`, `.debug/017` §5.8).
 *
 * That notice is a toast, raised through the layout's host because the host
 * outlives everything the form can be removed with, a route change included.
 * But a toast is a library, and a library is a download: when it cannot be
 * had (`loadToast()` of `components/ui-ext/Notices.tsx` rejects — the network
 * went before the host's chunk arrived), the sentence would be lost with it,
 * in the one situation it is most likely to be needed. So the
 * workspace keeps this region, which needs nothing that is not already on the
 * page: plain text in the palette's own danger colour on its paper
 * (`tests/unit/tokens-contrast.test.ts` holds the pair at 4.5:1 in both
 * schemes).
 *
 * Fixed to the bottom of the viewport, above the bottom sheet (`z-50` over its
 * `z-40`) — where the toast would have been. NOT in the flow of the page: on a
 * phone the visitor is typing in a sheet that is open over the workspace, and
 * a line in the workspace is then painted under it (measured in Chromium 153:
 * at y = 124 px, behind a fully open sheet). It takes no pointer events, so
 * for the twenty seconds it stays nothing under it is out of reach.
 *
 * A module-level store and not state, because whoever has something to say is
 * by definition no longer mounted. It says something only while a workspace is
 * on screen to say it in — {@link showUnsavedNotice} answers `false` otherwise
 * — and forgets everything when the last one goes, so that a sentence about
 * one bike is never found waiting on another's page.
 */
interface UnsavedNotice {
  id: number;
  title: string;
  description: string | undefined;
}

const NONE: readonly UnsavedNotice[] = [];

let notices: readonly UnsavedNotice[] = NONE;
let nextId = 0;
const hosts = new Set<() => void>();

function publish(next: readonly UnsavedNotice[]): void {
  notices = next;
  for (const host of hosts) host();
}

function subscribe(onChange: () => void): () => void {
  hosts.add(onChange);
  return () => {
    hosts.delete(onChange);
    if (hosts.size === 0) notices = NONE;
  };
}

const snapshot = (): readonly UnsavedNotice[] => notices;
const serverSnapshot = (): readonly UnsavedNotice[] => NONE;

/**
 * Show `title` (and why, when a reason is known) for `ms` milliseconds.
 * `false` when no workspace is on screen: nothing was shown.
 */
export function showUnsavedNotice(
  title: string,
  description: string | undefined,
  ms: number,
): boolean {
  if (hosts.size === 0) return false;
  const id = nextId;
  nextId += 1;
  publish([...notices, { id, title, description }]);
  setTimeout(() => publish(notices.filter((notice) => notice.id !== id)), ms);
  return true;
}

/** Mounted once by `BikeWorkspace`, not by the panel: the panel is rebuilt between its two layouts. */
export function UnsavedNotices(): React.JSX.Element | null {
  const shown = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (shown.length === 0) return null;
  return (
    // An alert inserted WITH its text is announced as it appears.
    <div
      role="alert"
      className="border-rule bg-paper pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-1 rounded-md border px-4 py-3 text-sm shadow-lg"
      data-testid="unsaved-notices"
    >
      {shown.map((notice) => (
        <p key={notice.id} className="text-danger-fg">
          <span className="font-medium">{notice.title}</span>
          {notice.description === undefined ? null : <span> {notice.description}</span>}
        </p>
      ))}
    </div>
  );
}
