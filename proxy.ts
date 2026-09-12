/**
 * Request proxy (Next 16's `middleware`).
 *
 * For now it only runs next-intl: `/` → 307 `/fr`, a localized external path
 * (`/en/bike/demo`) is rewritten to its internal route (`/en/velo/demo`), and
 * the `NEXT_LOCALE` cookie is kept in sync. W1-T3 wraps this in Auth.js
 * `auth()` (bd-platform shape: server-action requests skip the intl step) and
 * adds the redirect of the unprefixed Auth.js pages (`/connexion`,
 * `/inscription`).
 *
 * Next 16 runs `proxy.ts` on the Node runtime. Never export `runtime` from
 * this file, and keep it free of Prisma / bcrypt (ESLint enforces it).
 */
import createMiddleware from "next-intl/middleware";

import { routing } from "@/lib/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, Vercel internals, the
  // metadata files and any path with a dot (static assets).
  matcher: "/((?!api|_next|_vercel|sitemap\\.xml|robots\\.txt|opengraph-image|.*\\..*).*)",
};
