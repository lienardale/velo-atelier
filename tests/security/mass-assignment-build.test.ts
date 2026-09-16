/**
 * THREAT — Mass assignment and prototype pollution through a bike build: a
 * client (or a hand-edited `va:bike:local`, or a guest import) posts a build
 * with fields the UI never drew, hoping the server stores them, or with
 * `__proto__` / `constructor` keys hoping a merge pollutes `Object.prototype`.
 *
 * CONTROLS PINNED
 *
 *   1. **`validateBuild` is the only door** (§1.2): the fixture below — every
 *      known trick at once — is rejected, with one issue per trick, and the
 *      result carries no build at all (`build: null`), so a caller that forgets
 *      to check `ok` still has nothing to persist.
 *   2. **Exact shapes.** Unknown keys on the envelope, the spec, a part or its
 *      attributes are refused, never silently dropped.
 *   3. **No prototype walk.** `__proto__`, `constructor` and `prototype` are
 *      unknown keys like any other; after parsing and editing, `Object.prototype`
 *      has gained nothing.
 *   4. **The accepted build is a copy.** Mutating the input after a successful
 *      parse does not change the returned build.
 *   5. **Edits keep the guarantees.** `setAttribute` refuses attribute keys the
 *      part does not have, including prototype keys.
 */
/* eslint-disable security/detect-object-injection -- an index into our own fixture */
import { describe, expect, it } from "vitest";

import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { checkBuild } from "@/lib/domain/engine/compatibility";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import { buildForSpec } from "@/lib/domain/engine/parts-for-spec";
import { setAttribute, validateBuild } from "@/lib/domain/engine/validate-build";

const GRAVEL = buildForSpec(buildBikeSpec(answerWithDefaults(BIKE_PRESETS["gravel-1x11"])));
const WHEEL_REAR = GRAVEL.parts.findIndex((part) => part.partId === "wheel-rear");

/**
 * The fixture, as raw JSON text: `JSON.parse` creates `__proto__` as an OWN
 * property, which is exactly what reaches a server action.
 */
function maliciousFixture(): unknown {
  const parts = JSON.parse(JSON.stringify(GRAVEL.parts)) as Record<string, unknown>[];
  const text = JSON.stringify({
    spec: { ...GRAVEL.spec, owner: "attacker" },
    parts: [
      { ...parts[0], id: "00000000-0000-4000-8000-0000000000ff" },
      ...parts.slice(1),
      { partId: "rotor-front-titanium", attributes: {} },
      { partId: "lights", attributes: { "light-power": "dynamo" }, userId: "attacker" },
    ],
    userId: "00000000-0000-4000-8000-0000000000ff",
    guestLocalId: "00000000-0000-4000-8000-000000000001",
    createdAt: "1970-01-01T00:00:00.000Z",
    PLACEHOLDER: true,
  }).replace(
    '"PLACEHOLDER":true',
    '"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}',
  );
  const input = JSON.parse(text) as { parts: { attributes: Record<string, unknown> }[] };
  // Prototype keys and a price inside the rear wheel's attributes, too.
  input.parts[WHEEL_REAR].attributes = JSON.parse(
    '{"__proto__":{"polluted":true},"freehub":"hg-l","price":0}',
  ) as Record<string, unknown>;
  return input;
}

describe("mass assignment through a build", () => {
  it("rejects the fixture with one issue per trick and no build", () => {
    const result = validateBuild(maliciousFixture());
    expect(result.ok).toBe(false);
    expect(result.build).toBeNull();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { path: "userId", code: "unknown-key" },
        { path: "guestLocalId", code: "unknown-key" },
        { path: "createdAt", code: "unknown-key" },
        { path: "__proto__", code: "unknown-key" },
        { path: "constructor", code: "unknown-key" },
        { path: "spec.owner", code: "unknown-key" },
      ]),
    );
    expect(result.issues).toHaveLength(6);
  });

  it("rejects the part-level tricks once the envelope is clean", () => {
    const input = maliciousFixture() as Record<string, unknown>;
    const clean = {
      spec: GRAVEL.spec,
      parts: (input.parts as unknown[]).filter(Boolean),
    };
    const result = validateBuild(JSON.parse(JSON.stringify(clean)));
    expect(result.ok).toBe(false);
    const last = GRAVEL.parts.length;
    expect(result.issues).toEqual([
      { path: "parts.0.id", code: "unknown-key" },
      { path: `parts.${WHEEL_REAR}.attributes.__proto__`, code: "unknown-attribute" },
      { path: `parts.${WHEEL_REAR}.attributes.price`, code: "unknown-attribute" },
      { path: `parts.${last}.partId`, code: "unknown-part" },
      { path: `parts.${last + 1}.userId`, code: "unknown-key" },
    ]);
  });

  it("refuses a prototype key inside attributes", () => {
    const input = JSON.parse(JSON.stringify(GRAVEL)) as {
      parts: { attributes: Record<string, unknown> }[];
    };
    input.parts[0].attributes = JSON.parse('{"__proto__":{"polluted":true}}') as Record<
      string,
      unknown
    >;
    expect(validateBuild(input).issues).toEqual([
      { path: "parts.0.attributes.__proto__", code: "unknown-attribute" },
    ]);
  });

  it("leaves Object.prototype untouched", () => {
    validateBuild(maliciousFixture());
    setAttribute(GRAVEL, "frame", "__proto__", "x");
    setAttribute(GRAVEL, "frame", "constructor", "x");
    checkBuild(GRAVEL);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("returns a copy that later mutation of the input cannot reach", () => {
    const input = JSON.parse(JSON.stringify(GRAVEL)) as typeof GRAVEL;
    const result = validateBuild(input);
    expect(result.ok).toBe(true);
    input.spec.discipline = "road";
    input.parts[0].attributes.material = "carbon";
    expect(result.build!.spec.discipline).toBe("gravel");
    expect(result.build!.parts[0].attributes.material).toBe("aluminium");
  });

  it("refuses prototype keys through setAttribute", () => {
    expect(setAttribute(GRAVEL, "frame", "__proto__", "x")).toEqual({
      ok: false,
      code: "unknown-attribute",
    });
    expect(setAttribute(GRAVEL, "__proto__", "material", "carbon")).toEqual({
      ok: false,
      code: "unknown-part",
    });
  });
});
