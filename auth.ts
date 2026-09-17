/**
 * The Node half of Auth.js (§4.3): adapter, Credentials provider, `jwt`.
 *
 * `auth.config.ts` is the proxy-safe half; this file adds everything that needs
 * a database. `proxy.ts` never imports it.
 *
 * ## `jwt` and `sessionVersion`
 *
 * Sessions are JWTs, so there is no server-side row to delete when a password
 * changes. `User.sessionVersion` is the substitute: `changePasswordAction`
 * bumps it, and this callback re-reads the row at most every five minutes
 * (`SESSION_RECHECK_MS`) or immediately on `trigger === 'update'`. A token whose
 * copy disagrees is dropped by returning `null`, which is how the *other*
 * devices get logged out — the device that changed the password calls
 * `unstable_update()`, which re-runs this callback with the fresh number and
 * keeps its session.
 *
 * Five minutes is the trade: a stolen token stays usable for at most that long
 * after a password change, and a signed-in visitor costs one indexed
 * `findUnique` per five minutes rather than one per request.
 *
 * ## Google
 *
 * `allowDangerousEmailAccountLinking` (auth.config.ts) links a Google sign-in to
 * an existing password account with the same address. The `signIn` callback
 * below is what makes that safe: a Google profile without
 * `email_verified === true` is refused and sent to the localized login page with
 * `?error=OAuthAccountNotLinked`. `linkAccount` then stamps `User.emailVerified`,
 * because by that point Google has vouched for the address.
 */

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig, LOCALE_COOKIE, localeFromCookie } from "@/auth.config";
import { authorizeCredentials } from "@/lib/auth/authorize";
import { refreshSessionToken } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { clientIp } from "@/lib/security/ip";
import { createPrismaRateLimiter } from "@/lib/security/rate-limit";

const rateLimiter = createPrismaRateLimiter(prisma);

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,

  // The adapter's signature is written against the stock `@prisma/client`,
  // while ours is the Prisma 7 generator's output in `lib/generated/prisma`.
  // The plan expected a type-only `import type { PrismaClient } from '@prisma/client'`
  // for this cast; @prisma/client 7.10.0 no longer exports that type (it is a
  // thin re-export shim now), so the parameter type is taken from the adapter
  // itself — which is more honest anyway: it says "whatever PrismaAdapter wants".
  adapter: PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]),

  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials, request) =>
        authorizeCredentials(credentials, {
          prisma,
          rateLimiter,
          ip: clientIp(request.headers),
          isProduction: process.env.NODE_ENV === "production",
        }),
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /** The whole decision table lives in `lib/auth/jwt.ts`, where it is testable. */
    jwt: ({ token, user, account, trigger }) =>
      refreshSessionToken({ token, user, account, trigger }, { prisma }),
  },

  events: {
    /**
     * A linked Google account proves the address (the `signIn` callback let it
     * through only with `email_verified === true`), so stamp it on the user.
     */
    async linkAccount({ user, account }) {
      if (account.provider !== "google" || !user.id) return;
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    },

    /** A brand-new Google account starts in the language the visitor was browsing in. */
    async createUser({ user }) {
      if (!user.id) return;
      const { cookies } = await import("next/headers");
      const locale = localeFromCookie((await cookies()).get(LOCALE_COOKIE)?.value);
      await prisma.user.update({ where: { id: user.id }, data: { locale } });
    },
  },
});
