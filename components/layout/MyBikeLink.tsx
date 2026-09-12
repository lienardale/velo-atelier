"use client";

import { useSyncExternalStore } from "react";

import { Link, usePathname } from "@/lib/i18n/navigation";

/**
 * The guest bike's localStorage key. Same value as `LOCAL_BIKE_KEY` in
 * `lib/bike/storage-keys.ts` (§1.2, owned by W2-T2), which this header link
 * predates; presence is all that matters here — `/velo/local` validates the
 * payload itself and sends an unreadable one back to `/`.
 */
export const LOCAL_BIKE_STORAGE_KEY = "va:bike:local";

function hasLocalBike(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_BIKE_STORAGE_KEY) !== null;
  } catch {
    // Storage disabled (Safari private mode, blocked cookies): no local bike.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * "Mon vélo" (§6.5): the visitor's own guest bike when one is stored, the demo
 * bike otherwise. The server (and the first client render) always renders the
 * demo link, so static pages stay static and hydration matches; the local link
 * appears right after hydration. Other tabs are followed through the `storage`
 * event, this tab on every navigation (`usePathname` re-renders the link, and
 * `useSyncExternalStore` re-reads the snapshot on each render).
 */
export function MyBikeLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  usePathname();
  const hasLocal = useSyncExternalStore(subscribe, hasLocalBike, () => false);
  return (
    <Link
      href={{ pathname: "/velo/[id]", params: { id: hasLocal ? "local" : "demo" } }}
      className={className}
    >
      {children}
    </Link>
  );
}
