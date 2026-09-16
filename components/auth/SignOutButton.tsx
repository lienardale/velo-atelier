"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { signOutAction } from "@/app/[locale]/(auth)/connexion/actions";
import { IDLE } from "@/lib/actions/result";

/**
 * Sign out (§4.3).
 *
 * A `<form>` posting to a server action, not a link and not a `fetch`: signing
 * out is a state change, so it must be a POST, and the action is where the
 * session cookie is actually cleared. `tests/e2e/auth-login.spec.ts` asserts
 * `authjs.session-token` is gone from the context afterwards (§4.8 AC5).
 *
 * The locale rides along so the visitor lands on the home page they were
 * reading, not on `/fr` by default; the server re-validates it.
 */
export function SignOutButton({ className = "" }: { className?: string }): React.JSX.Element {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [, formAction] = useActionState(signOutAction, IDLE);

  return (
    <form action={formAction}>
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        data-testid="sign-out"
        className={`tap-target w-full justify-start rounded-md px-3 text-sm font-medium text-ink hover:bg-paper-2 ${className}`}
      >
        {t("signOut")}
      </button>
    </form>
  );
}
