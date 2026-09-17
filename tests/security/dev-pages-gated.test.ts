/**
 * THREAT — Test-only pages reachable in production.
 *
 * `/[locale]/dev/bike3d` and `/[locale]/dev/bike3d-perf` exist so Playwright
 * can drive the 3D viewer through a harness with preset switches and the
 * `window.__va` hooks. In production they would be an unreviewed, unindexed
 * surface (and, in a build that has the hooks, a remote control).
 *
 * CONTROLS PINNED (§1.2, §3.6 AC7):
 *   1. both pages 404 unless the RUNNING server has `ENABLE_TEST_PAGES` set to
 *      exactly "1" — unset, "0", "true", " 1" are all off;
 *   2. the variable is read per request: the pages are `force-dynamic` and
 *      await `connection()` BEFORE reading it, so `next build` cannot freeze a
 *      value into a prerendered page;
 *   3. with the gate open, query parameters reach the harness only through the
 *      whitelist of lib/bike3d/query.ts;
 *   4. an unknown locale is still a 404.
 * The build-time half (no `__va` code without NEXT_PUBLIC_TEST_HOOKS=1) is
 * checked on the build output, see docs/bike3d.md.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed paths under the repo root */
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isNotFoundInterrupt } from "@/tests/_fakes/session";

const calls: string[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {
    calls.push("connection");
  }),
}));

vi.mock("@/app/[locale]/dev/bike3d/DevBike3dHarness", () => ({
  DevBike3dHarness: function DevBike3dHarness() {
    return null;
  },
}));

vi.mock("@/app/[locale]/dev/bike3d/gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/[locale]/dev/bike3d/gate")>();
  return {
    testPagesEnabled: (...args: Parameters<typeof actual.testPagesEnabled>) => {
      calls.push("gate");
      return actual.testPagesEnabled(...args);
    },
  };
});

const PAGES = {
  "dev/bike3d": () => import("@/app/[locale]/dev/bike3d/page"),
  "dev/bike3d-perf": () => import("@/app/[locale]/dev/bike3d-perf/page"),
} as const;

type SearchParams = Record<string, string | string[] | undefined>;

async function render(page: keyof typeof PAGES, locale: string, searchParams: SearchParams = {}) {
  const mod = await PAGES[page]();
  return mod.default({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(searchParams),
  });
}

async function expectNotFound(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isNotFoundInterrupt(error), String(error)).toBe(true);
}

function findHarnessProps(node: ReactNode): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if ((element.type as { name?: string }).name === "DevBike3dHarness") return element.props;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findHarnessProps(child as ReactNode);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(Object.keys(PAGES) as Array<keyof typeof PAGES>)("%s", (page) => {
  it("is force-dynamic", async () => {
    expect((await PAGES[page]()).dynamic).toBe("force-dynamic");
  });

  it.each(["fr", "en"])("404s with ENABLE_TEST_PAGES unset (%s)", async (locale) => {
    vi.stubEnv("ENABLE_TEST_PAGES", undefined);
    await expectNotFound(render(page, locale));
    // Request-time read: connection() is awaited before the gate is consulted.
    expect(calls).toEqual(["connection", "gate"]);
  });

  it.each(["0", "true", "yes", " 1", "1 ", ""])("404s with ENABLE_TEST_PAGES=%j", async (value) => {
    vi.stubEnv("ENABLE_TEST_PAGES", value);
    await expectNotFound(render(page, "fr"));
  });

  it("renders with ENABLE_TEST_PAGES=1, whitelisting the query", async () => {
    vi.stubEnv("ENABLE_TEST_PAGES", "1");
    const tree = await render(page, "en", {
      preset: "../../etc/passwd",
      part: ["__proto__", "saddle"],
      parts: "chain,constructor,<img src=x onerror=alert(1)>,saddle",
      mode: "pick",
      quality: "ultra",
      extra: "ignored",
    });
    const props = findHarnessProps(tree);
    expect(props).toEqual({
      locale: "en",
      variant: page === "dev/bike3d" ? "viewer" : "perf",
      initialPreset: "gravel-1x11",
      initialPartId: null,
      initialPickedIds: ["chain", "saddle"],
      initialMode: "pick",
      initialQuality: null,
    });
  });

  it("404s on an unknown locale even with the gate open", async () => {
    vi.stubEnv("ENABLE_TEST_PAGES", "1");
    await expectNotFound(render(page, "de"));
  });

  it("reads the gate after connection() in the source, too", () => {
    const source = readFileSync(`app/[locale]/${page}/page.tsx`, "utf8");
    const connectionAt = source.indexOf("await connection()");
    const gateAt = source.indexOf("testPagesEnabled()");
    expect(connectionAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(connectionAt);
    expect(source).toMatch(/export const dynamic = "force-dynamic"/);
  });
});

describe("testPagesEnabled", () => {
  it("is on only for the exact string 1", async () => {
    const { testPagesEnabled } = await vi.importActual<
      typeof import("@/app/[locale]/dev/bike3d/gate")
    >("@/app/[locale]/dev/bike3d/gate");
    expect(testPagesEnabled({ ENABLE_TEST_PAGES: "1" })).toBe(true);
    expect(testPagesEnabled({})).toBe(false);
    expect(testPagesEnabled({ ENABLE_TEST_PAGES: "TRUE" })).toBe(false);
  });
});
