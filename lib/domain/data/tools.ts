/**
 * The tool catalogue (§2.5) — what a guide's `tools[]` may name.
 *
 * Each tool lists the tools that can stand in for it, so the checkup's tool
 * checklist can offer "je n'ai pas cet outil → prenez plutôt…" (§6.5). An
 * alternative is always itself a tool of this list (`buying-guide.test.ts`
 * walks it), and a tool never lists itself.
 *
 * Labels: `tools.<id>.label` in `messages/{fr,en}/tools.json`.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import type { ToolDef } from "../schema/procedure";

export const TOOL_IDS = [
  "allen-keys",
  "multi-tool",
  "torx-keys",
  "torque-wrench",
  "adjustable-wrench",
  "pedal-wrench",
  "phillips-screwdriver",
  "flat-screwdriver",
  "pliers",
  "cable-cutter",
  "tire-levers",
  "floor-pump",
  "mini-pump",
  "pressure-gauge",
  "valve-core-tool",
  "sealant-injector",
  "chain-checker",
  "steel-ruler",
  "chain-tool",
  "quick-link-pliers",
  "chain-whip",
  "cassette-lockring-tool",
  "bottom-bracket-tool",
  "crank-puller",
  "pad-spreader",
  "tape-measure",
  "shock-pump",
  "zip-tie",
  "work-stand",
  "degreaser",
  "chain-lube",
  "isopropyl-alcohol",
  "brush",
  "rags",
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

/** Tool ids that can replace each tool, best substitute first. */
const ALTERNATIVES: Record<ToolId, readonly ToolId[]> = {
  "allen-keys": ["multi-tool"],
  "multi-tool": ["allen-keys"],
  "torx-keys": ["multi-tool"],
  "torque-wrench": [],
  "adjustable-wrench": ["pliers"],
  "pedal-wrench": ["allen-keys", "adjustable-wrench"],
  "phillips-screwdriver": ["multi-tool"],
  "flat-screwdriver": ["multi-tool"],
  pliers: ["adjustable-wrench"],
  "cable-cutter": [],
  "tire-levers": [],
  "floor-pump": ["mini-pump"],
  "mini-pump": ["floor-pump"],
  "pressure-gauge": ["floor-pump"],
  "valve-core-tool": ["pliers"],
  "sealant-injector": [],
  "chain-checker": ["steel-ruler"],
  "steel-ruler": ["tape-measure"],
  "chain-tool": ["multi-tool"],
  "quick-link-pliers": ["pliers"],
  "chain-whip": [],
  "cassette-lockring-tool": [],
  "bottom-bracket-tool": [],
  "crank-puller": [],
  "pad-spreader": ["tire-levers"],
  "tape-measure": ["steel-ruler"],
  "shock-pump": [],
  "zip-tie": [],
  "work-stand": [],
  degreaser: ["isopropyl-alcohol"],
  "chain-lube": [],
  "isopropyl-alcohol": [],
  brush: ["rags"],
  rags: [],
};

export const TOOLS: readonly (ToolDef & { id: ToolId })[] = TOOL_IDS.map((id) => ({
  id,
  labelKey: `tools.${id}.label`,
  // eslint-disable-next-line security/detect-object-injection -- `id` comes from TOOL_IDS, the keys of a Record<ToolId, …>
  alternatives: ALTERNATIVES[id],
}));

const TOOL_ID_SET: ReadonlySet<string> = new Set(TOOL_IDS);

/** Type guard for tool ids arriving from frontmatter or storage. */
export function isToolId(value: unknown): value is ToolId {
  return typeof value === "string" && TOOL_ID_SET.has(value);
}
