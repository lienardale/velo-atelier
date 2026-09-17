/**
 * `window.__va` — the build-gated Playwright hooks (§1.2, lib/testing/e2e-hooks.ts).
 * Optional on purpose: a production build has no hooks, so every reader must
 * handle `undefined`.
 */
import type { VaTestHooks } from "@/lib/testing/e2e-hooks";

declare global {
  interface Window {
    __va?: VaTestHooks;
  }
}

export {};
