/**
 * THREAT — a caller choosing its own rate-limit bucket.
 *
 * Every per-address limit of §4.3 (`login:<ip>` 10 / 15 min, `signup:<ip>`
 * 5 / h) is only as good as the address it keys on. `lib/security/ip.ts` is
 * that address, and nothing tested it directly until W4 (it was exercised only
 * through `x-forwarded-for`).
 *
 * CONTROLS PINNED
 *
 *   1. **Precedence is decreasing forgeability**: `x-vercel-forwarded-for`
 *      (set by Vercel's edge) over `x-real-ip` over the FIRST `x-forwarded-for`
 *      entry, then the `'local'` sentinel. An empty header is skipped, never an
 *      empty bucket.
 *   2. **A port is not an identity**: `1.2.3.4:51000` and `[v6]:443` are the
 *      address without it.
 *   3. **One IPv4 host is one bucket** whether it arrives as `192.0.2.1` or as
 *      an IPv4-mapped IPv6 address, however that is spelled.
 *   4. **One IPv6 /64 is one bucket** (backlog, W4-T1): a host holding a /64 —
 *      routine — could otherwise pick a fresh address per attempt. Proven end
 *      to end through `signUpAction`: rotating inside one /64 hits the limit,
 *      a different /64 does not.
 *
 * The trusted-proxy switch (honour these headers only behind a known proxy) is
 * re-scoped to post-MVP: production is Vercel, whose edge overwrites them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientIp, LOCAL_CLIENT_IP, rateLimitSubject } from "@/lib/security/ip";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { fakeDb } from "@/tests/_fakes/prisma";
import { sameOriginHeaders, setRequestHeaders, setSession } from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { signUpAction } = await import("@/app/[locale]/(auth)/inscription/actions");
const { IDLE } = await import("@/lib/actions/result");

const headers = (init: Record<string, string>) => new Headers(init);

describe("precedence", () => {
  const ALL = {
    "x-vercel-forwarded-for": "198.51.100.1",
    "x-real-ip": "198.51.100.2",
    "x-forwarded-for": "198.51.100.3, 10.0.0.1",
  };

  it("takes Vercel's header first, then x-real-ip, then the FIRST x-forwarded-for hop", () => {
    expect(clientIp(headers(ALL))).toBe("198.51.100.1");
    const noVercel = { "x-real-ip": ALL["x-real-ip"], "x-forwarded-for": ALL["x-forwarded-for"] };
    expect(clientIp(headers(noVercel))).toBe("198.51.100.2");
    expect(clientIp(headers({ "x-forwarded-for": ALL["x-forwarded-for"] }))).toBe("198.51.100.3");
  });

  it("falls back to the 'local' sentinel, and never to an empty bucket", () => {
    expect(clientIp(headers({}))).toBe(LOCAL_CLIENT_IP);
    expect(clientIp(headers({ "x-real-ip": "   ", "x-forwarded-for": " , 10.0.0.1" }))).toBe(
      LOCAL_CLIENT_IP,
    );
    expect(clientIp(headers({ "x-real-ip": "", "x-forwarded-for": "198.51.100.3" }))).toBe(
      "198.51.100.3",
    );
  });
});

describe("canonical form", () => {
  it("strips a port, IPv4 and bracketed IPv6 alike", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.7:51000" }))).toBe("203.0.113.7");
    expect(clientIp(headers({ "x-real-ip": "[2001:db8:1:2::7]:443" }))).toBe("2001:db8:1:2::/64");
  });

  it.each([
    "::ffff:192.0.2.1",
    "::FFFF:c000:201",
    "0:0:0:0:0:ffff:192.0.2.1",
    "[::ffff:192.0.2.1]:8080",
  ])("reads the IPv4-mapped %s as the IPv4 host it is", (mapped) => {
    expect(clientIp(headers({ "x-real-ip": mapped }))).toBe("192.0.2.1");
  });

  it("keys every address of one /64 on the same bucket, however it is spelled", () => {
    const bucket = rateLimitSubject("2001:db8:1:2::1");
    expect(bucket).toBe("2001:db8:1:2::/64");
    for (const spelling of [
      "2001:DB8:1:2:ffff:ffff:ffff:ffff",
      "2001:0db8:0001:0002:0000:0000:0000:0009",
      "2001:db8:1:2:a:b:c:d%eth0",
    ]) {
      expect(rateLimitSubject(spelling), spelling).toBe(bucket);
    }
  });

  it("keeps two /64s apart, and compresses only a real run of zeros", () => {
    expect(rateLimitSubject("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(rateLimitSubject("2001:db8::1")).toBe("2001:db8::/64");
    expect(rateLimitSubject("::1")).toBe("::/64");
    expect(rateLimitSubject("fe80:1:2:3:4:5:6:7")).toBe("fe80:1:2:3::/64");
  });

  it("leaves IPv4 alone, and turns what is not an address into its own bucket", () => {
    expect(rateLimitSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("Unknown")).toBe("unknown");
    expect(rateLimitSubject("1::2::3")).toBe("1::2::3");
    expect(rateLimitSubject("::ffff:300.0.0.1")).toBe("::ffff:300.0.0.1");
  });
});

describe("rotating inside one /64 does not buy a fresh bucket", () => {
  function signUpFrom(address: string, index: number) {
    setRequestHeaders({ ...sameOriginHeaders(), "x-real-ip": address });
    // An invalid password: the bucket is consumed BEFORE the payload is read,
    // so the test pays for no hashing and creates no account.
    const data = new FormData();
    data.append("email", `rotation${index}@velo-atelier.test`);
    data.append("password", "x");
    data.append("locale", "fr");
    return signUpAction(IDLE, data);
  }

  beforeEach(() => {
    fakeDb.reset();
    setSession(null);
  });

  it("refuses the sign-up after the limit, even from an address never seen before", async () => {
    const limit = RATE_LIMITS.signupPerIp.max;
    for (let index = 0; index < limit; index += 1) {
      const result = await signUpFrom(`2001:db8:1:2::${(index + 1).toString(16)}`, index);
      expect(result).toMatchObject({ code: "VALIDATION" });
    }

    const rotated = await signUpFrom("2001:db8:1:2:dead:beef:0:1", limit);
    expect(rotated).toMatchObject({ ok: false, code: "RATE_LIMITED" });

    // …while the next /64 over is somebody else entirely.
    const neighbour = await signUpFrom("2001:db8:1:3::1", limit + 1);
    expect(neighbour).toMatchObject({ code: "VALIDATION" });
  });
});
