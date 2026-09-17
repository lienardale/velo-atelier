/**
 * Stand-in for the lazy `BikeScene` chunk in RTL tests (`next/dynamic` is
 * mocked to return it). It reports what the viewer passed and drives the store
 * the way the real canvas does: ready after mount, context loss, a throw.
 */
import { useEffect } from "react";

import type { BikeSceneProps } from "@/components/bike3d/BikeScene";
import { useViewerStoreApi } from "@/components/bike3d/store";

export const stubControl = {
  autoReady: true,
  throwOnRender: false,
  mounts: 0,
};

export function resetStub(): void {
  stubControl.autoReady = true;
  stubControl.throwOnRender = false;
  stubControl.mounts = 0;
}

export function StubScene(props: BikeSceneProps): React.JSX.Element {
  const { api } = useViewerStoreApi();
  if (stubControl.throwOnRender) throw new Error("shader compile failed");

  useEffect(() => {
    stubControl.mounts += 1;
    api.getState().noteMount();
    api.getState().noteContextCreated();
    if (stubControl.autoReady) api.getState().setReady(true);
    return () => api.getState().setReady(false);
  }, [api]);

  return (
    <div
      data-testid="scene-stub"
      data-reduced-motion={String(props.reducedMotion)}
      data-coarse={String(props.coarsePointer)}
      data-tier={props.initialTier}
      data-parts={props.plan.partIds.length}
    >
      <button type="button" onClick={() => api.getState().setContextLost(true)}>
        lose-context
      </button>
    </div>
  );
}
