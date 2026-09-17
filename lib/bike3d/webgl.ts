/**
 * WebGL 2 capability probe (§3.3 fallbacks). three.js r163+ renders with
 * WebGL 2 only, so WebGL 1 counts as "no 3D".
 *
 * The probe context is released immediately through `WEBGL_lose_context`:
 * browsers cap live contexts (≈16), and a leaked probe would push the real
 * canvas's context out.
 */
export function hasWebGL2(doc: Pick<Document, "createElement"> | undefined): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    const context = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!context) return false;
    const usable = typeof context.isContextLost !== "function" || !context.isContextLost();
    const loseContext = context.getExtension("WEBGL_lose_context") as {
      loseContext(): void;
    } | null;
    loseContext?.loseContext();
    return usable;
  } catch {
    return false;
  }
}
