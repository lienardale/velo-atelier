import { describe, expect, it, vi } from "vitest";

import { hasWebGL2 } from "./webgl";

function doc(context: unknown) {
  return {
    createElement: vi.fn(() => ({ getContext: vi.fn(() => context) })),
  } as unknown as Document;
}

describe("hasWebGL2", () => {
  it("is false without a document or a context", () => {
    expect(hasWebGL2(undefined)).toBe(false);
    expect(hasWebGL2(doc(null))).toBe(false);
  });

  it("detects WebGL 2 and releases the probe context", () => {
    const loseContext = vi.fn();
    const context = {
      isContextLost: () => false,
      getExtension: vi.fn((name: string) =>
        name === "WEBGL_lose_context" ? { loseContext } : null,
      ),
    };
    expect(hasWebGL2(doc(context))).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("a lost probe context means no 3D; a missing extension is tolerated", () => {
    expect(hasWebGL2(doc({ isContextLost: () => true, getExtension: () => null }))).toBe(false);
    expect(hasWebGL2(doc({ getExtension: () => null }))).toBe(true);
  });

  it("a throwing canvas means no 3D", () => {
    const throwing = {
      createElement: () => {
        throw new Error("blocked");
      },
    } as unknown as Document;
    expect(hasWebGL2(throwing)).toBe(false);
  });
});
