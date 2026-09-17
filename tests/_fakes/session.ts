/**
 * The request as server code sees it: headers, cookies, the Auth.js session,
 * and the control-flow interrupts (`redirect()`, `notFound()`) Next throws.
 *
 * `tests/setup.ts` routes `next/headers` and `next/navigation` here for every
 * project, so a server action or a route handler can be called as a plain
 * function in a node test and still read `cookies()` / `headers()` and throw
 * the redirects Next would throw. State is reset after every test by
 * `resetRequestContext()` (called from setup.ts).
 *
 * Auth.js (`@/auth`, written in W1-T3) is NOT mocked globally — the modules
 * that test `auth.ts` itself need the real one. A test that needs a session
 * opts in with:
 *
 *   vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());
 *   ...
 *   setSession(sessionFor(DEMO_USER));   // or setSession(null) for anonymous
 *
 * Interrupt errors carry the same `digest` format as Next 16.3's own
 * (`NEXT_REDIRECT;<type>;<url>;<status>;` and `NEXT_HTTP_ERROR_FALLBACK;<status>`,
 * read from next/dist/client/components/{redirect-error,http-access-fallback}),
 * so `isRedirectError()` / `unstable_rethrow()` behave in tests as they do in
 * production code.
 */
import { vi } from "vitest";

// ───────────────────────────────────────────────────────── headers + cookies ──

let requestHeaders = new Map<string, string>();
let requestCookies = new Map<string, string>();

/** Replace the incoming request headers (names are case-insensitive). */
export function setRequestHeaders(headers: Record<string, string> | Map<string, string>): void {
  const entries = headers instanceof Map ? [...headers] : Object.entries(headers);
  requestHeaders = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
}

/** Replace the incoming request cookies. */
export function setRequestCookies(cookies: Record<string, string> | Map<string, string>): void {
  requestCookies = new Map(cookies instanceof Map ? cookies : Object.entries(cookies));
}

/** The cookie jar after the code under test ran (what `cookies().set()` wrote). */
export function cookieJar(): ReadonlyMap<string, string> {
  return requestCookies;
}

/**
 * Headers for a same-origin browser POST from `origin` — what a server action
 * sees when a real form is submitted (`assertSameOrigin()` compares `origin`
 * with `x-forwarded-host ?? host`).
 */
export function sameOriginHeaders(origin = "http://localhost:3100"): Record<string, string> {
  const { host } = new URL(origin);
  return { origin, host, "x-forwarded-host": host, "x-forwarded-proto": "http" };
}

function readonlyHeaders(): Headers {
  return new Headers([...requestHeaders]);
}

function cookieStore() {
  const entry = (name: string) => {
    const value = requestCookies.get(name);
    return value === undefined ? undefined : { name, value };
  };
  const store = {
    get: (name: string | { name: string }) => entry(typeof name === "string" ? name : name.name),
    getAll: (name?: string) =>
      [...requestCookies]
        .filter(([key]) => name === undefined || key === name)
        .map(([key, value]) => ({ name: key, value })),
    has: (name: string) => requestCookies.has(name),
    set: (...args: [string, string, unknown?] | [{ name: string; value: string }]) => {
      const [name, value] =
        typeof args[0] === "string" ? [args[0], args[1] as string] : [args[0].name, args[0].value];
      requestCookies.set(name, value);
      return store;
    },
    delete: (name: string | { name: string }) => {
      requestCookies.delete(typeof name === "string" ? name : name.name);
      return store;
    },
    clear: () => {
      requestCookies.clear();
      return store;
    },
    get size() {
      return requestCookies.size;
    },
    toString: () => [...requestCookies].map(([k, v]) => `${k}=${v}`).join("; "),
    [Symbol.iterator]: () =>
      [...requestCookies]
        .map(([name, value]) => [name, { name, value }] as const)
        [Symbol.iterator](),
  };
  return store;
}

let draftModeEnabled = false;

/** The `next/headers` module as seen by code under test. */
export const nextHeadersModule = {
  headers: vi.fn(async () => readonlyHeaders()),
  cookies: vi.fn(async () => cookieStore()),
  draftMode: vi.fn(async () => ({
    get isEnabled() {
      return draftModeEnabled;
    },
    enable: () => {
      draftModeEnabled = true;
    },
    disable: () => {
      draftModeEnabled = false;
    },
  })),
};

// ──────────────────────────────────────────────────────── navigation interrupts ──

/** Error thrown by the mocked `redirect()` / `permanentRedirect()`. */
export interface RedirectInterrupt extends Error {
  digest: string;
  url: string;
  status: 307 | 308;
}

/** Error thrown by the mocked `notFound()` / `forbidden()` / `unauthorized()`. */
export interface HttpFallbackInterrupt extends Error {
  digest: string;
  status: 401 | 403 | 404;
}

export function redirectInterrupt(
  url: string,
  type: "replace" | "push" = "replace",
  status: 307 | 308 = 307,
): RedirectInterrupt {
  return Object.assign(new Error(`NEXT_REDIRECT:${url}`), {
    digest: `NEXT_REDIRECT;${type};${url};${status};`,
    url,
    status,
  });
}

export function httpFallbackInterrupt(status: 401 | 403 | 404): HttpFallbackInterrupt {
  const label = { 401: "NEXT_UNAUTHORIZED", 403: "NEXT_FORBIDDEN", 404: "NEXT_NOT_FOUND" }[status];
  return Object.assign(new Error(label), { digest: `NEXT_HTTP_ERROR_FALLBACK;${status}`, status });
}

export function isRedirectInterrupt(error: unknown): error is RedirectInterrupt {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT;")
  );
}

export function isNotFoundInterrupt(error: unknown): error is HttpFallbackInterrupt {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { digest?: unknown }).digest === "NEXT_HTTP_ERROR_FALLBACK;404"
  );
}

/**
 * Run `fn`, expect it to redirect, and return the target URL.
 * Throws (failing the test) if it returns normally or throws anything else.
 */
export async function captureRedirect(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (isRedirectInterrupt(error)) return error.url;
    if (isI18nRedirect(error)) return error.target;
    throw error;
  }
  throw new Error("expected a redirect, but the function returned normally");
}

function isNextInterrupt(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT;") ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;") ||
      digest === "I18N_REDIRECT")
  );
}

/** Router spies returned by the mocked `useRouter()` (both next/navigation and next-intl's). */
export const routerSpies = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let currentPathname = "/";
let currentSearchParams = new URLSearchParams();
let currentParams: Record<string, string | string[]> = {};

/** What `usePathname()` / `useSearchParams()` / `useParams()` return in client-component tests. */
export function setNavigationState(state: {
  pathname?: string;
  search?: string | URLSearchParams;
  params?: Record<string, string | string[]>;
}): void {
  if (state.pathname !== undefined) currentPathname = state.pathname;
  if (state.search !== undefined) currentSearchParams = new URLSearchParams(state.search);
  if (state.params !== undefined) currentParams = state.params;
}

/** The `next/navigation` module as seen by code under test. */
export const nextNavigationModule = {
  redirect: (url: string, type: "replace" | "push" = "replace"): never => {
    throw redirectInterrupt(url, type, 307);
  },
  permanentRedirect: (url: string, type: "replace" | "push" = "replace"): never => {
    throw redirectInterrupt(url, type, 308);
  },
  notFound: (): never => {
    throw httpFallbackInterrupt(404);
  },
  forbidden: (): never => {
    throw httpFallbackInterrupt(403);
  },
  unauthorized: (): never => {
    throw httpFallbackInterrupt(401);
  },
  unstable_rethrow: (error: unknown): void => {
    if (isNextInterrupt(error)) throw error;
  },
  RedirectType: { push: "push", replace: "replace" } as const,
  useRouter: () => routerSpies,
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(currentSearchParams),
  useParams: () => currentParams,
  useSelectedLayoutSegment: () => null,
  useSelectedLayoutSegments: () => [],
};

// ─────────────────────────────────────────────── next-intl navigation (@/lib/i18n) ──

/** Error thrown by the mocked locale-aware `redirect()` from `@/lib/i18n/navigation`. */
export interface I18nRedirect extends Error {
  digest: "I18N_REDIRECT";
  target: string;
  redirectTarget: unknown;
}

export function isI18nRedirect(error: unknown): error is I18nRedirect {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { digest?: unknown }).digest === "I18N_REDIRECT"
  );
}

type Href = string | { pathname: string; params?: Record<string, string>; query?: unknown };

/**
 * `/<locale><internal pathname>` with `[param]` segments filled in. This is
 * the *internal* (French) pathname, not the localized one: tests of the real
 * `routing.pathnames` mapping belong to the e2e `href()` fixture and to the
 * W0-T2 routing tests, not to a mock.
 */
export function i18nTarget(href: Href, locale?: string): string {
  const pathname =
    typeof href === "string"
      ? href
      : href.pathname.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, _rest, key: string) =>
          encodeURIComponent(href.params?.[key] ?? `[${key}]`),
        );
  if (!locale) return pathname;
  return pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
}

/** The `@/lib/i18n/navigation` module (createNavigation output) as seen by code under test. */
export function i18nNavigationModule(createElement: (...args: unknown[]) => unknown) {
  return {
    redirect: (arg: { href: Href; locale?: string } | Href): never => {
      const { href, locale } =
        typeof arg === "object" && "href" in arg ? arg : { href: arg, locale: undefined };
      const target = i18nTarget(href, locale);
      throw Object.assign(new Error(`I18N_REDIRECT:${target}`), {
        digest: "I18N_REDIRECT" as const,
        target,
        redirectTarget: arg,
      });
    },
    permanentRedirect: (arg: { href: Href; locale?: string }): never => {
      const target = i18nTarget(arg.href, arg.locale);
      throw Object.assign(new Error(`I18N_REDIRECT:${target}`), {
        digest: "I18N_REDIRECT" as const,
        target,
        redirectTarget: arg,
      });
    },
    getPathname: ({ href, locale }: { href: Href; locale?: string }) => i18nTarget(href, locale),
    usePathname: () => currentPathname,
    useRouter: () => routerSpies,
    Link: ({
      href,
      locale,
      children,
      ...rest
    }: {
      href: Href;
      locale?: string;
      children?: unknown;
      [prop: string]: unknown;
    }) => createElement("a", { ...rest, href: i18nTarget(href, locale) }, children),
  };
}

// ─────────────────────────────────────────────────────────────── Auth.js session ──

/** Shape of `Session` after `types/next-auth.d.ts` augmentation (§4.3). */
export interface FakeSession {
  user: {
    id: string;
    email: string;
    name?: string | null;
    locale: "fr" | "en";
    authAt?: number;
    authProvider?: string;
  };
  expires: string;
}

let currentSession: FakeSession | null = null;

/** A signed-in session for a seeded or ad-hoc user (`DEMO_USER` fits). */
export function sessionFor(user: {
  id: string;
  email: string;
  name?: string | null;
  locale?: "fr" | "en";
  authAt?: number;
  authProvider?: string;
}): FakeSession {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      locale: user.locale ?? "fr",
      authAt: user.authAt,
      authProvider: user.authProvider,
    },
    expires: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  };
}

/** `null` = anonymous. */
export function setSession(session: FakeSession | null): void {
  currentSession = session;
}

export function currentFakeSession(): FakeSession | null {
  return currentSession;
}

/** Spies standing in for the exports of `auth.ts`. */
export const authSpies = {
  auth: vi.fn(async () => currentSession),
  signIn: vi.fn(async (_provider?: string, options?: { redirectTo?: string }) => {
    if (options?.redirectTo) throw redirectInterrupt(options.redirectTo);
    return undefined;
  }),
  signOut: vi.fn(async (options?: { redirectTo?: string }) => {
    currentSession = null;
    if (options?.redirectTo) throw redirectInterrupt(options.redirectTo);
    return undefined;
  }),
  unstable_update: vi.fn(async (data: Partial<FakeSession>) => {
    if (currentSession && data.user) {
      currentSession = { ...currentSession, user: { ...currentSession.user, ...data.user } };
    }
    return currentSession;
  }),
};

/** Factory for `vi.mock("@/auth", …)` — see the header comment. */
export function authModule() {
  return {
    ...authSpies,
    handlers: {
      GET: vi.fn(async () => new Response(null, { status: 404 })),
      POST: vi.fn(async () => new Response(null, { status: 404 })),
    },
  };
}

// ────────────────────────────────────────────────────────────────────── reset ──

/** Called by tests/setup.ts after every test. */
export function resetRequestContext(): void {
  requestHeaders = new Map();
  requestCookies = new Map();
  draftModeEnabled = false;
  currentSession = null;
  currentPathname = "/";
  currentSearchParams = new URLSearchParams();
  currentParams = {};
}
