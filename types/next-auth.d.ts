/**
 * Auth.js module augmentation (§4.3).
 *
 * Shape copied from bd-platform's `types/next-auth.d.ts`, with `role` dropped
 * (there is no admin role in this project — §"Out of scope") and three fields
 * added:
 *
 *   `id`              the `User.id` uuid. Auth.js puts the subject in
 *                     `token.sub`, but `session.user.id` is what every server
 *                     action and ownership predicate reads, so it is copied
 *                     across explicitly in the `session` callback.
 *   `locale`          the account's preferred locale. It follows the JWT so a
 *                     signed-in visitor lands on their own language without a
 *                     database read per request.
 *   `sessionVersion`  bumped by `changePasswordAction`. The `jwt` callback
 *                     re-reads the row at most every five minutes and returns
 *                     `null` when the numbers disagree, which logs the other
 *                     devices out.
 *
 * `checkedAt` lives on the JWT only (never on the session): it is bookkeeping
 * for that five-minute re-check, not something a client should see.
 */

import type { DefaultSession, DefaultUser } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

type UserLocale = "fr" | "en";

declare module "next-auth" {
  interface User extends DefaultUser {
    locale?: UserLocale;
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      locale: UserLocale;
      /** When this session signed in (ms) and with which provider — lib/auth/reauth.ts. */
      authAt?: number;
      authProvider?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    locale?: UserLocale;
    sessionVersion?: number;
    /** Epoch ms of the last `sessionVersion` re-check. */
    checkedAt?: number;
    authAt?: number;
    authProvider?: string;
  }
}
