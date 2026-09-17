/**
 * Capability detection for `BikeViewer`, as a `useSyncExternalStore` source.
 *
 * The server snapshot is `null` ("unknown"), so the server and the hydration
 * pass both render the SVG; the client snapshot is computed once per viewer
 * (WebGL 2 probe + media queries + device hints) and recomputed when the
 * pointer or reduced-motion media query flips (a tablet docking a mouse, the
 * OS setting changing).
 */
import { readCapsEnv, type ViewerCaps } from "@/lib/bike3d/quality";
import { hasWebGL2 } from "@/lib/bike3d/webgl";

const QUERIES = ["(pointer: coarse)", "(prefers-reduced-motion: reduce)"];

export interface CapsSource {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): ViewerCaps | null;
  getServerSnapshot(): null;
}

export function createCapsSource(): CapsSource {
  let caps: ViewerCaps | null = null;
  let webgl2: boolean | null = null;

  const compute = () => {
    webgl2 ??= hasWebGL2(document);
    caps = readCapsEnv(window, webgl2);
  };

  return {
    subscribe(onChange) {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const lists = QUERIES.map((query) => window.matchMedia(query));
      const listener = () => {
        compute();
        onChange();
      };
      for (const list of lists) list.addEventListener("change", listener);
      return () => {
        for (const list of lists) list.removeEventListener("change", listener);
      };
    },
    getSnapshot() {
      if (caps === null && typeof window !== "undefined") compute();
      return caps;
    },
    getServerSnapshot() {
      return null;
    },
  };
}
