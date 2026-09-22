/**
 * The client address, as far as it can be trusted (§4.3) — and, for an IPv6
 * caller, the network it can rotate inside.
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
 * ## What comes out is a BUCKET, not a log line
 *
 * The only use of this value is the per-address rate-limit key (login and
 * sign-up), so it is canonicalised for that job:
 *
 *   - a port some proxies append (`1.2.3.4:51000`, `[2001:db8::1]:443`) is
 *     stripped, so one client always lands in one bucket;
 *   - an IPv4-mapped IPv6 address (`::ffff:192.0.2.1`, however it is spelled)
 *     is the IPv4 address it maps — one host, one bucket, whichever stack the
 *     connection came in on;
 *   - any other IPv6 address is reduced to its /64. A single host routinely
 *     holds a whole /64 and can pick a fresh address per request; bucketing on
 *     the full address would hand it 2⁶⁴ buckets. The /64 is written in one
 *     canonical form (lower case, zeros compressed, `2001:db8:1:2::/64`), so
 *     `2001:0DB8:0001:0002::1` and `2001:db8:1:2:ffff::9` are the same bucket.
 *
 * Trusting the headers at all is a deployment fact (Vercel's edge overwrites
 * them); a trusted-proxy switch for other hosts is in `docs/backlog.md`.
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

/** `192.0.2.1` as four octets, or `null`. */
function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/** An IPv6 address as its eight 16-bit groups, or `null` when it is not one. */
function parseIpv6(value: string): number[] | null {
  // A zone id (`fe80::1%eth0`) names an interface of THIS host, not the peer.
  let text = value.toLowerCase().replace(/%.*$/, "");
  if (!text.includes(":") || !/^[0-9a-f:.]+$/.test(text)) return null;

  // An embedded IPv4 tail (`::ffff:192.0.2.1`) is the last two groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = parseIpv4(tail);
    if (octets === null) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...rest];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** RFC 5952 text for eight groups: lower case, the longest run of ≥ 2 zero groups as `::`. */
function formatIpv6(groups: readonly number[]): string {
  /* eslint-disable security/detect-object-injection -- `start` and `end` are loop indexes into a fixed-length array */
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== 0) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  /* eslint-enable security/detect-object-injection */
  const hex = groups.map((group) => group.toString(16));
  if (bestStart === -1) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

/**
 * The rate-limit identity of one address: IPv4 as it is, an IPv4-mapped IPv6
 * address as its IPv4, any other IPv6 address as its /64. Anything that parses
 * as neither (a proxy's garbage) is returned lower-cased, as its own bucket.
 */
export function rateLimitSubject(address: string): string {
  const groups = parseIpv6(address);
  if (groups === null) return address.toLowerCase();
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${formatIpv6([...groups.slice(0, 4), 0, 0, 0, 0])}/64`;
}

/**
 * The caller's rate-limit bucket (see the file header), or `'local'`.
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
    if (address.length > 0) return rateLimitSubject(address);
  }
  return LOCAL_CLIENT_IP;
}

/** Read the incoming request headers and resolve the caller's bucket. */
export async function requestClientIp(): Promise<string> {
  const { headers } = await import("next/headers");
  return clientIp(await headers());
}
