"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { googleSignInAction } from "@/app/[locale]/(auth)/connexion/actions";
import { IDLE } from "@/lib/actions/result";
import type { Locale } from "@/lib/i18n/routing";

import { FormError, SubmitButton } from "./form-parts";

/**
 * "Continue with Google" (§4.3).
 *
 * A form posting to a server action rather than `signIn('google')` from the
 * browser, for one reason: the action writes the `NEXT_LOCALE` cookie **before**
 * the round trip starts. Google's callback lands on `/api/auth/callback/google`,
 * a path with no locale in it, and both the `signIn` callback (refusing an
 * unverified address) and the `createUser` event (setting the new account's
 * language) have nothing but that cookie to go on.
 *
 * `data-provider="google"` is what `tests/e2e/auth-login.spec.ts` asserts on:
 * the button's presence is verified in every project, and it is **never
 * clicked** — no test drives a real OAuth flow, and Google is never mocked.
 * The manual checklist is `docs/qa/google-oauth.md`.
 *
 * The Google mark is inlined as SVG: the CSP allows images from `'self'` and
 * `lh3.googleusercontent.com` only, and a remote button asset would be one more
 * render-blocking request on the login page.
 */
export function GoogleButton({
  locale,
  callbackUrl,
}: {
  locale: Locale;
  callbackUrl?: string;
}): React.JSX.Element {
  const t = useTranslations("auth");
  const [result, formAction] = useActionState(googleSignInAction, IDLE);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="locale" value={locale} />
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <FormError result={result} testId="google-error" />
      <div data-provider="google">
        <SubmitButton label={t("google.signIn")} pendingLabel={t("google.signIn")} tone="ghost">
          <GoogleMark />
        </SubmitButton>
      </div>
    </form>
  );
}

/** Google's four-colour "G", inlined (the CSP allows no third-party image host). */
function GoogleMark(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5 shrink-0">
      <path
        fill="#ea4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.5 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285f4"
        d="M46.9 24.5c0-1.6-.15-3.2-.43-4.7H24v9h12.9c-.56 3-2.24 5.5-4.77 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.3z"
      />
      <path
        fill="#fbbc05"
        d="M10.4 28.6a14.4 14.4 0 0 1 0-9.2l-7.8-6.1a24 24 0 0 0 0 21.4l7.8-6.1z"
      />
      <path
        fill="#34a853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.2-8.4 2.2-6.4 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

/** The "or" rule between the credentials form and the Google button. */
export function AuthSeparator(): React.JSX.Element {
  const t = useTranslations("auth");
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
      <span>{t("google.separator")}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
    </div>
  );
}
