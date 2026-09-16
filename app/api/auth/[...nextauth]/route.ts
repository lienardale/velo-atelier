/**
 * Auth.js endpoints: `/api/auth/session`, `/callback/google`, `/signin`,
 * `/signout`, `/csrf`, `/providers` (§4.3).
 *
 * The whole route is four lines because every decision lives in `auth.ts` and
 * `auth.config.ts`. `proxy.ts`'s matcher excludes `/api`, so these are the one
 * family of paths the locale machinery never touches — which is why the
 * redirect targets Auth.js produces are unprefixed, and why `proxy.ts`
 * re-prefixes them on the way back.
 *
 * `SessionProvider` (`app/[locale]/layout.tsx`) calls `/api/auth/session` from
 * the browser; `signIn('google', …)` posts to `/api/auth/signin/google`.
 */

import type { NextRequest } from "next/server";

import { handlers } from "@/auth";
import { withoutSessionRefresh } from "@/lib/auth/session-cookie";

export const { POST } = handlers;

/**
 * Every Auth.js GET, with one change on `/api/auth/session`: the refreshed
 * session cookie is not written (see `withoutSessionRefresh`). The OAuth
 * callback and the other GETs are untouched — they are where a session cookie
 * is legitimately set.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const response = await handlers.GET(request);
  return new URL(request.url).pathname.endsWith("/api/auth/session")
    ? withoutSessionRefresh(response)
    : response;
}
