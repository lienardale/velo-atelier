"use client";

import { useEffect, useMemo } from "react";

interface Disposable {
  dispose(): void;
}

/**
 * `useMemo` for GPU resources: the value is rebuilt when `key` changes and the
 * previous one is disposed (and the last one on unmount), so geometry swaps on
 * a spec or tier change never leak buffers. `key` must encode every input of
 * `factory` (the plan hash, the mesh key, the geometry tier).
 */
export function useDisposable<T extends Disposable>(factory: () => T, key: string): T {
  // `factory` closes over values that `key` already encodes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => factory(), [key]);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}
