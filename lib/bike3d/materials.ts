/**
 * The 12 material singletons (§3.3): seven bases and five overlays, created
 * once per page and shared by every mesh — so the WebGL program count stays
 * flat whatever the bike (§3.4: ≤ 12 programs).
 *
 * Overlay colours come from the design tokens (`--color-accent`,
 * `--color-paper-2`, `--color-success`, `--color-danger`, `--color-warn`), read
 * once and refreshed on a `prefers-color-scheme` change (the scene then calls
 * `invalidate()`).
 */
import { Color, MeshStandardMaterial } from "three";

import type { MaterialKey } from "./types";

export const MATERIAL_KEYS: readonly MaterialKey[] = [
  "paint",
  "alu",
  "steel",
  "rubber",
  "plastic",
  "chain",
  "rotor",
  "highlightHover",
  "highlightSelected",
  "highlightPicked",
  "statusOk",
  "statusKo",
];

export interface Palette {
  accent: string;
  paperAlt: string;
  success: string;
  danger: string;
  warn: string;
}

/** Light-scheme token values: the fallback when CSS cannot be read (tests, SSR). */
export const DEFAULT_PALETTE: Palette = {
  accent: "#1f5f8b",
  paperAlt: "#efeae1",
  success: "#2e7d4f",
  danger: "#b23a2f",
  warn: "#d9741c",
};

const BASES: Record<string, { color: string; metalness: number; roughness: number }> = {
  paint: { color: "#3b4a57", metalness: 0.2, roughness: 0.45 },
  alu: { color: "#a9adb1", metalness: 0.7, roughness: 0.35 },
  steel: { color: "#7d8287", metalness: 0.8, roughness: 0.3 },
  rubber: { color: "#27241f", metalness: 0, roughness: 0.9 },
  plastic: { color: "#34302b", metalness: 0.05, roughness: 0.6 },
  chain: { color: "#8c8f93", metalness: 0.75, roughness: 0.4 },
  rotor: { color: "#c3c6ca", metalness: 0.85, roughness: 0.25 },
};

let cache: Map<MaterialKey, MeshStandardMaterial> | null = null;

function overlayColor(key: MaterialKey, palette: Palette): string {
  switch (key) {
    case "highlightHover":
      return palette.accent;
    case "highlightSelected":
      return palette.accent;
    case "highlightPicked":
      return palette.warn;
    case "statusOk":
      return palette.success;
    case "statusKo":
      return palette.danger;
    default:
      return palette.paperAlt;
  }
}

function create(palette: Palette): Map<MaterialKey, MeshStandardMaterial> {
  const map = new Map<MaterialKey, MeshStandardMaterial>();
  for (const key of MATERIAL_KEYS) {
    const base = Object.hasOwn(BASES, key) ? BASES[key] : undefined;
    const material = base
      ? new MeshStandardMaterial({
          color: base.color,
          metalness: base.metalness,
          roughness: base.roughness,
        })
      : new MeshStandardMaterial({
          color: overlayColor(key, palette),
          metalness: 0.1,
          roughness: 0.5,
          emissive: new Color(overlayColor(key, palette)),
          emissiveIntensity: key === "highlightHover" ? 0.15 : 0.3,
        });
    material.name = key;
    map.set(key, material);
  }
  return map;
}

export function materialFor(key: MaterialKey): MeshStandardMaterial {
  cache ??= create(DEFAULT_PALETTE);
  return cache.get(key)!;
}

/** Re-colour the overlays in place (materials keep their identity and program). */
export function applyPalette(palette: Palette): void {
  cache ??= create(palette);
  for (const key of MATERIAL_KEYS) {
    if (Object.hasOwn(BASES, key)) continue;
    const material = cache.get(key)!;
    material.color.set(overlayColor(key, palette));
    material.emissive.set(overlayColor(key, palette));
  }
}

/** Read the palette from computed CSS custom properties, falling back per token. */
export function readPalette(style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null): Palette {
  const read = (name: string, fallback: string) => {
    const value = style?.getPropertyValue(name).trim();
    return value && /^#[0-9a-f]{3,8}$|^rgb/i.test(value) ? value : fallback;
  };
  return {
    accent: read("--color-accent", DEFAULT_PALETTE.accent),
    paperAlt: read("--color-paper-2", DEFAULT_PALETTE.paperAlt),
    success: read("--color-success", DEFAULT_PALETTE.success),
    danger: read("--color-danger", DEFAULT_PALETTE.danger),
    warn: read("--color-warn", DEFAULT_PALETTE.warn),
  };
}

/** Number of material singletons ever created (≤ 12). */
export function materialCount(): number {
  return cache?.size ?? 0;
}

/** Test seam: drop the singletons (they are recreated on next use). */
export function resetMaterials(): void {
  for (const material of cache?.values() ?? []) material.dispose();
  cache = null;
}
