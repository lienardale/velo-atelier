/**
 * MSW handlers — the only outbound HTTP this application is allowed to make
 * from a test.
 *
 * vélo-atelier has deliberately few network dependencies: no mailer (password
 * reset is out of MVP), no price scraping, no analytics, and retailer links are
 * plain `<a href>`s. What remains is Google sign-in, which Auth.js drives over
 * OpenID Connect. Those endpoints are answered here with deterministic fakes so
 * a unit test of the OAuth callbacks can run offline.
 *
 * Everything else is refused: tests/setup.ts starts the server with
 * `onUnhandledRequest: "error"`, so an accidental real request (a new SDK that
 * phones home, a forgotten `fetch`) fails the test that made it instead of
 * silently depending on the network.
 *
 * `mswState` records what was requested so a test can assert on it, and holds
 * the per-test knobs (e.g. an unverified Google e-mail). It is reset after
 * every test by tests/setup.ts.
 */
import { http, HttpResponse } from "msw";

export const GOOGLE_ISSUER = "https://accounts.google.com";

/** The Google profile the fake userinfo endpoint returns. */
export interface FakeGoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  locale?: string;
}

interface MswState {
  /** Every request that reached a handler, in order. */
  requests: Array<{ method: string; url: string }>;
  googleProfile: FakeGoogleProfile;
  /** When set, the token endpoint answers with this OAuth error. */
  googleTokenError: string | null;
}

function defaults(): MswState {
  return {
    requests: [],
    googleProfile: {
      sub: "google-oauth2|000000000000000000001",
      email: "google-user@velo-atelier.test",
      email_verified: true,
      name: "Google User",
      picture: "https://lh3.googleusercontent.com/a/velo-atelier-test",
      locale: "fr",
    },
    googleTokenError: null,
  };
}

export const mswState: MswState = defaults();

/** Called by tests/setup.ts after every test. */
export function resetMswState(): void {
  Object.assign(mswState, defaults());
}

function record(request: Request): void {
  mswState.requests.push({ method: request.method, url: request.url });
}

/** Unsigned (`alg: none`) id_token carrying the current fake profile. Tests only. */
function fakeIdToken(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      iss: GOOGLE_ISSUER,
      aud: process.env.AUTH_GOOGLE_ID ?? "ci-dummy",
      iat: now,
      exp: now + 3600,
      ...mswState.googleProfile,
    }),
    "",
  ].join(".");
}

export const handlers = [
  // ── Google OpenID Connect discovery ────────────────────────────────────────
  http.get(`${GOOGLE_ISSUER}/.well-known/openid-configuration`, ({ request }) => {
    record(request);
    return HttpResponse.json({
      issuer: GOOGLE_ISSUER,
      authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
      token_endpoint: "https://oauth2.googleapis.com/token",
      userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email", "profile"],
    });
  }),

  // ── Token exchange ─────────────────────────────────────────────────────────
  http.post("https://oauth2.googleapis.com/token", ({ request }) => {
    record(request);
    if (mswState.googleTokenError) {
      return HttpResponse.json({ error: mswState.googleTokenError }, { status: 400 });
    }
    return HttpResponse.json({
      access_token: "ya29.fake-access-token",
      expires_in: 3599,
      token_type: "Bearer",
      scope: "openid email profile",
      id_token: fakeIdToken(),
    });
  }),

  // ── Userinfo ───────────────────────────────────────────────────────────────
  http.get("https://openidconnect.googleapis.com/v1/userinfo", ({ request }) => {
    record(request);
    return HttpResponse.json(mswState.googleProfile);
  }),

  // ── JWKS (empty: the fake id_token is unsigned and must never be trusted) ───
  http.get("https://www.googleapis.com/oauth2/v3/certs", ({ request }) => {
    record(request);
    return HttpResponse.json({ keys: [] });
  }),
];
