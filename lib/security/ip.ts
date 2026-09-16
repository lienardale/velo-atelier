/**
 * The client address, as far as it can be trusted (§4.3).
 *
 * Order matters, and it is the order of decreasing forgeability:
 *
 *   1. `x-vercel-forwarded-for` — set by Vercel's edge, stripped from any
 *      inbound request, so on Vercel it is the one value a caller cannot lie
 *      about;
 *   2. `x-real-ip` — what nginx / the Playwright web server set;
 *   3. the FIRST entry of `x-forwarded-for` — the original client in the chain
 *      a proxy appended to. Forgeable behind a proxy that does not rewrite it,
 *      which is why it is last;
 *   4. `'local'` — no proxy at all (a `next dev` request, a test).
 *
 * `'local'` is a sentinel, not an address: login and sign-up skip the per-IP
 * bucket for it outside production, so a developer on `next dev` is not locked
 * out of their own forms. It does not reach the e2e suite, which runs `next start`
 * (NODE_ENV=production): each e2e test sends its own `x-real-ip` instead, which
 * this function reads before `x-forwarded-for` (tests/e2e/_fixtures.ts).
 *
 * IPv6 addresses keep their brackets-free form; ports (`1.2.3.4:51000`, which
 * some proxies append) are stripped so the same client always hashes to the
 * same rate-limit bucket.
 */

/** The sentinel used when no proxy header identifies the caller. */
export const LOCAL_CLIENT_IP = "local";

/** Strip a trailing `:port` from an IPv4 address; leave IPv6 alone. */
function stripPort(value: string): string {
  const trimmed = value.trim();
  // `[::1]:8080` → `::1`. A numbered group, not a named one: `tsconfig.json`
  // targets ES2017, where named capture groups are a syntax error.
  // eslint-disable-next-line security/detect-unsafe-regex -- `[^\]]+` cannot backtrack into the literal `]` that follows it
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return bracketed[1];
  // An IPv6 address without brackets contains several colons: leave it whole.
  if ((trimmed.match(/:/g) ?? []).length > 1) return trimmed;
  return trimmed.replace(/:\d+$/, "");
}

/**
 * The caller's address, or `'local'`.
 *
 * Never returns an empty string, so it is always a usable rate-limit bucket
 * component.
 */
export function clientIp(headers: Headers): string {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const address = stripPort(candidate);
    if (address.length > 0) return address;
  }
  return LOCAL_CLIENT_IP;
}

/** Read the incoming request headers and resolve the caller's address. */
export async function requestClientIp(): Promise<string> {
  const { headers } = await import("next/headers");
  return clientIp(await headers());
}
