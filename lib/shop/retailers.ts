/**
 * The shop's CONTENT: the category grid of `/acheter`
 * (`content/shop/categories.yaml`) and the brand tiers of the buying guide
 * (`content/brands.yaml`), §5.5.
 *
 * Both files are authored prose under `content/` (CC BY-SA 4.0) rather than TS
 * data, because a translator edits them and because `entry | mid | high` for
 * twenty-five parts is a table, not code. They are read here, once, at module
 * load.
 *
 * ## This module is server-only, and that is a deployment fact, not a style rule
 *
 * `readFileSync` at module scope means the value is computed when the module is
 * first evaluated. On a **prerendered** route that is the build, and the data
 * ends up inside the static HTML — which is why `/acheter` is a static page and
 * hands what a client component needs down as props. On a route that runs per
 * request — `/velo/[id]/liste` reads the brand tiers of the bike's parts since
 * W4 — it is the first request of a fresh server, so the YAML has to be DEPLOYED
 * with that route. It is, but only because the bundler says so: Next 16.3.4's
 * Turbopack traces the computed `join(process.cwd(), "content", …)` as the whole
 * `content/` directory into the route's `page.js.nft.json` (checked on the W4-T1
 * build, `.debug/013`). That is a fact about the bundler, not about this code:
 * re-check the route's `.nft.json` after a Next upgrade. Never import this from
 * a `"use client"` module.
 *
 * The retailer TABLE (ids, templates, `verifiedAt`) is not here: it is TS data
 * in `lib/domain/data/retailers.ts`, and the client-safe accessors around it
 * are in `lib/shop/outbound.ts`.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- two fixed paths under the repo's own content/ directory */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { isPartId, type PartId } from "@/lib/domain/data/parts";
import { RETAILER_ORDER } from "@/lib/domain/data/retailers";
import type { RetailerId } from "@/lib/domain/schema/retailer";
import type { Localized } from "@/lib/i18n/localized";
import type { Locale } from "@/lib/i18n/routing";

import { BRAND_TIERS, type BrandTier } from "./questions";

const CONTENT = join(process.cwd(), "content");

function readYaml(...segments: string[]): unknown {
  return parseYaml(readFileSync(join(CONTENT, ...segments), "utf8"));
}

// ── Categories ───────────────────────────────────────────────────────────────

/** One card of the `/acheter` grid. Mirrors `content/shop/categories.yaml`. */
export interface ShopCategory {
  id: string;
  label: Localized<string>;
  hint: Localized<string>;
  /** The parts it sells; the first one is the main one (category URLs use it). */
  partIds: readonly PartId[];
  /** The search text sent to the search retailers — plain words, no brand. */
  query: Localized<string>;
  retailers: readonly RetailerId[];
}

function asCategory(raw: Record<string, unknown>, index: number): ShopCategory {
  const id = raw.id;
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`content/shop/categories.yaml: category ${index} has no usable id`);
  }
  const partIds = (Array.isArray(raw.partIds) ? raw.partIds : []).filter((entry): entry is PartId =>
    isPartId(entry),
  );
  if (partIds.length === 0) {
    throw new Error(`content/shop/categories.yaml: "${id}" names no known part`);
  }
  const retailers = (Array.isArray(raw.retailers) ? raw.retailers : []).filter(
    (entry): entry is RetailerId => (RETAILER_ORDER as readonly string[]).includes(entry as string),
  );
  return {
    id,
    label: raw.label as Localized<string>,
    hint: raw.hint as Localized<string>,
    partIds,
    query: raw.query as Localized<string>,
    retailers: retailers.length > 0 ? retailers : RETAILER_ORDER,
  };
}

/**
 * The grid, in the order the file lists it.
 *
 * The structure (both locales, real part ids, the three retailers) is already
 * a test — `tests/unit/content/parts-legal-shop.test.ts` — so this reader
 * repeats only the two checks it cannot render without: an id and at least one
 * part. Anything else malformed would be caught there first.
 */
export const SHOP_CATEGORIES: readonly ShopCategory[] = Object.freeze(
  (
    (readYaml("shop", "categories.yaml") as { categories?: Record<string, unknown>[] })
      .categories ?? []
  ).map(asCategory),
);

export function findCategory(id: string): ShopCategory | undefined {
  return SHOP_CATEGORIES.find((category) => category.id === id);
}

/** The first category that sells `partId` — what `/acheter?part=…` opens on. */
export function categoryForPart(partId: string): ShopCategory | undefined {
  return SHOP_CATEGORIES.find((category) =>
    (category.partIds as readonly string[]).includes(partId),
  );
}

// ── Brand tiers ──────────────────────────────────────────────────────────────

/** What `content/brands.yaml` says about one part. */
export interface BrandTiers {
  /** What actually changes from one tier to the next, for this part. */
  note: Localized<string>;
  /** Brands or product ranges, alphabetical inside a tier. */
  tiers: Readonly<Record<BrandTier, readonly string[]>>;
}

function asBrandTiers(raw: Record<string, unknown>): BrandTiers | null {
  const tiers: Record<string, readonly string[]> = {};
  for (const tier of BRAND_TIERS) {
    const entries = Object.hasOwn(raw, tier)
      ? // eslint-disable-next-line security/detect-object-injection -- `tier` is a BrandTier literal
        raw[tier]
      : undefined;
    if (!Array.isArray(entries) || entries.length === 0) return null;
    // eslint-disable-next-line security/detect-object-injection -- `tier` is a BrandTier literal
    tiers[tier] = entries.map(String);
  }
  return {
    note: raw.note as Localized<string>,
    tiers: tiers as Readonly<Record<BrandTier, readonly string[]>>,
  };
}

/**
 * Brand tiers per part. Only the parts the file covers (25 of them today) are
 * present: a part with no entry simply has no tier advice to give.
 */
export const BRANDS: Readonly<Partial<Record<PartId, BrandTiers>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(readYaml("brands.yaml") as Record<string, Record<string, unknown>>)
      .filter(([partId]) => isPartId(partId))
      .map(([partId, raw]) => [partId, asBrandTiers(raw)])
      .filter(([, tiers]) => tiers !== null),
  ),
) as Readonly<Partial<Record<PartId, BrandTiers>>>;

export function brandsFor(partId: string): BrandTiers | null {
  return Object.hasOwn(BRANDS, partId) ? (BRANDS[partId as PartId] as BrandTiers) : null;
}

/** `brandsFor`, flattened to what `<PartQuestions>` needs on the client. */
export function brandTiersFor(
  partId: string,
  locale: Locale,
): { note: string; tiers: Readonly<Record<BrandTier, readonly string[]>> } | null {
  const brands = brandsFor(partId);
  if (brands === null) return null;
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale, a key of Localized
  return { note: brands.note[locale], tiers: brands.tiers };
}
