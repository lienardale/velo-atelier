/**
 * Global Vitest setup — runs first, before every test file of every project.
 *
 * Shape copied from skipper-website/tests/setup.ts:
 *
 * 1. Deterministic environment, assigned with `??=` BEFORE any module that
 *    reads `process.env` at import time. The values mirror `.env.test`, so a
 *    suite behaves the same whether or not the integration setup also loaded
 *    that file. Database URLs are deliberately NOT set here: the fake-DB tiers
 *    never open a connection, and the integration tier must get them from
 *    `.env.test` / the CI `env:` block so its `_test` guard means something.
 *
 * 2. `vi.mock` for the Next.js runtime surfaces that only exist inside a
 *    request, so server actions and route handlers run as plain functions:
 *    `server-only`, `next/cache`, `next/headers` (an in-memory cookie jar),
 *    `next/navigation` (tagged redirect / not-found errors), `next-intl/server`
 *    and the locale-aware `@/lib/i18n/navigation` (tagged `I18N_REDIRECT`).
 *    State lives in tests/_fakes/session.ts and is reset after every test.
 *
 * 3. MSW with `onUnhandledRequest: "error"` — no test reaches the network.
 *
 * Tier-specific setup lives next door: setup.dom.ts (jsdom), setup.bike3d.ts
 * (WebGL stubs), setup.fake-db.ts (recording Prisma fake), setup.integration.ts
 * (real `_test` database).
 */
import { afterAll, afterEach, beforeAll, vi } from "vitest";

// ── 1. Deterministic env ─────────────────────────────────────────────────────
process.env.AUTH_SECRET ??= "ci-only-secret-32-chars-minimum-abcdef";
process.env.AUTH_URL ??= "http://localhost:3100";
process.env.AUTH_TRUST_HOST ??= "true";
process.env.AUTH_GOOGLE_ID ??= "ci-dummy";
process.env.AUTH_GOOGLE_SECRET ??= "ci-dummy";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3100";
process.env.BCRYPT_COST ??= "4";
process.env.TZ ??= "Europe/Paris";

// ── 2. Next.js runtime stubs ─────────────────────────────────────────────────

// `import "server-only"` throws outside a React Server Component bundle; a
// node test is neither, and is allowed to import server modules.
vi.mock("server-only", () => ({}));

// Actions call these after writes; spies let a test assert the revalidation.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  refresh: vi.fn(),
  unstable_noStore: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("next/headers", async () => (await import("./_fakes/session")).nextHeadersModule);

vi.mock("next/navigation", async () => (await import("./_fakes/session")).nextNavigationModule);

// Server components and actions translate through these. The fake `t` echoes
// `namespace.key` so an assertion reads the key the code chose, which is the
// contract (actions return message KEYS, never strings). Client components use
// the real `NextIntlClientProvider` with real messages instead.
vi.mock("next-intl/server", () => {
  const translator = (namespace?: string) => {
    const qualify = (key: string) => (namespace ? `${namespace}.${key}` : key);
    return Object.assign((key: string) => qualify(key), {
      rich: (key: string) => qualify(key),
      markup: (key: string) => qualify(key),
      raw: (key: string) => qualify(key),
      has: () => true,
    });
  };
  const namespaceOf = (arg?: string | { namespace?: string }) =>
    typeof arg === "string" ? arg : arg?.namespace;
  return {
    getLocale: vi.fn(async () => "fr"),
    getMessages: vi.fn(async () => ({})),
    getNow: vi.fn(async () => new Date()),
    getTimeZone: vi.fn(async () => "Europe/Paris"),
    getTranslations: vi.fn(async (arg?: string | { namespace?: string }) =>
      translator(namespaceOf(arg)),
    ),
    getFormatter: vi.fn(async () => ({
      dateTime: (value: Date) => value.toISOString(),
      number: (value: number) => String(value),
      relativeTime: (value: Date) => value.toISOString(),
      list: (values: string[]) => values.join(", "),
    })),
    setRequestLocale: vi.fn(),
    // `lib/i18n/request.ts` default-exports getRequestConfig(fn): identity
    // makes the callback itself importable and testable.
    getRequestConfig: <T>(fn: T): T => fn,
  };
});

// `@/lib/i18n/navigation` is created by W0-T2 (createNavigation(routing)).
// Mocking it by path is fine before the file exists: the factory only runs
// when something imports it.
vi.mock("@/lib/i18n/navigation", async () => {
  const [{ i18nNavigationModule }, { createElement }] = await Promise.all([
    import("./_fakes/session"),
    import("react"),
  ]);
  return i18nNavigationModule(createElement as (...args: unknown[]) => unknown);
});

// ── 3. MSW: network isolation ────────────────────────────────────────────────
import { setupServer } from "msw/node";

import { resetRequestContext } from "./_fakes/session";
import { handlers, resetMswState } from "./_mocks/handlers";

const mswServer = setupServer(...handlers);

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  mswServer.resetHandlers();
  resetMswState();
  resetRequestContext();
  vi.clearAllMocks();
});

afterAll(() => {
  mswServer.close();
});
