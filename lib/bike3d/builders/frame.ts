/**
 * Recipe → geometry, and the merge that makes a whole part ONE draw call.
 *
 * `frameGeometry` is the general form: every recipe of a mesh descriptor is
 * built and merged with `mergeGeometries` (the only three.js addon import the
 * project allows, §3.3). Mixed indexed / non-indexed inputs (an extruded gear
 * next to a cylinder) are de-indexed first, which `mergeGeometries` requires.
 */
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { GeometryRecipe, GeometryTier, MeshDescriptor } from "../types";
import { boxGeometry } from "./bars";
import { gearGeometry } from "./gear";
import { LOD_TABLE, type LodSettings } from "./lod";
import { bentTube, capsuleBetween, tubeBetween } from "./tube";
import { discGeometry, torusGeometry } from "./wheel";

export function recipeGeometry(recipe: GeometryRecipe, lod: LodSettings): BufferGeometry {
  switch (recipe.kind) {
    case "tube":
      return tubeBetween(recipe.from, recipe.to, recipe.radius, lod);
    case "path":
      return bentTube(recipe.points, recipe.radius, recipe.closed, lod);
    case "capsule":
      return capsuleBetween(recipe.from, recipe.to, recipe.radius, lod);
    case "torus":
      return torusGeometry(recipe.center, recipe.radius, recipe.tube, lod);
    case "disc":
      return discGeometry(recipe.center, recipe.radius, recipe.thickness, lod);
    case "gear":
      return gearGeometry(recipe.center, recipe.teeth, recipe.pitchRadius, recipe.thickness, lod);
    case "box":
      return boxGeometry(recipe.center, recipe.size, recipe.rotationZ);
  }
}

/** Merge geometries into one; the inputs are disposed. */
export function mergeAll(geometries: BufferGeometry[]): BufferGeometry {
  if (geometries.length === 1) return geometries[0]!;
  const mixed = geometries.some((g) => g.index === null);
  const prepared = geometries.map((g) => {
    // Only the attributes every primitive shares survive the merge.
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    if (!mixed || g.index === null) return g;
    const flat = g.toNonIndexed();
    g.dispose();
    return flat;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error("mergeGeometries failed: incompatible attributes");
  return merged;
}

/** Build one mesh descriptor at a geometry tier: one geometry, one draw call. */
export function frameGeometry(descriptor: MeshDescriptor, tier: GeometryTier): BufferGeometry {
  const lod = LOD_TABLE[tier];
  const merged = mergeAll(descriptor.recipes.map((recipe) => recipeGeometry(recipe, lod)));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Triangle count of a geometry (indexed or not). */
export function triangleCount(geometry: BufferGeometry): number {
  const count = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
  return Math.floor(count / 3);
}
