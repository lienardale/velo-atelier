/**
 * Same-origin check for server actions (§4.3).
 *
 * Next.js already refuses a Server Action whose `Origin` does not match the
 * host it was served from. This is the second lock on the same door: it is
 * cheap, it is ours, and it is asserted by `tests/security/csrf-and-actions.test.ts`
 * — so a future `experimental.serverActions.allowedOrigins` entry (which we
 * deliberately do NOT set, see `next.config.ts`) cannot silently widen the
 * surface without a test going red.
 *
 * The comparison is `Origin`'s host against `x-forwarded-host ?? host`, which
 * is what a reverse proxy (Vercel, the Playwright web server) actually sets.
 * A request with no `Origin` at all is refused: every browser sends it on a
 * cross-origin POST and on same-origin POSTs from a form, and a server action
 * is always a POST.
 */

export class CrossOriginRequestError extends Error {
  readonly origin: string | null;
  readonly host: string | null;

  constructor(origin: string | null, host: string | null) {
    super(`Cross-origin request refused: Origin ${origin ?? "(none)"} ≠ host ${host ?? "(none)"}`);
    this.name = "CrossOriginRequestError";
    this.origin = origin;
    this.host = host;
  }
}

/** The host the request was actually served from, as the edge saw it. */
export function requestHost(headers: Headers): string | null {
  return headers.get("x-forwarded-host") ?? headers.get("host");
}

/**
 * True when the `Origin` header names the same host the request arrived on.
 *
 * Only the host is compared, not the scheme: a proxy that terminates TLS sends
 * `Origin: https://example.com` with `x-forwarded-host: example.com`, and the
 * port is part of the host on both sides (`localhost:3100`), so a request from
 * `localhost:3000` to `localhost:3100` is still cross-origin.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = requestHost(headers);
  if (!origin || !host) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost.toLowerCase() === host.toLowerCase();
}

/**
 * Throw `CrossOriginRequestError` unless the request is same-origin.
 *
 * Called with no argument it reads `next/headers`, which is why it is async:
 * `headers()` is a Promise in Next 16. Callers turn the error into
 * `{ ok: false, code: 'FORBIDDEN' }` (`lib/actions/with-user.ts`, and the auth
 * actions, which have no session to wrap).
 */
export async function assertSameOrigin(headers?: Headers): Promise<void> {
  const actual = headers ?? (await (await import("next/headers")).headers());
  if (isSameOrigin(actual)) return;
  throw new CrossOriginRequestError(actual.get("origin"), requestHost(actual));
}
