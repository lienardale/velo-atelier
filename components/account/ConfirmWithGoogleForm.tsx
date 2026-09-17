"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { reauthenticateWithGoogleAction } from "@/app/[locale]/(protected)/compte/actions";
import { FormError, SubmitButton } from "@/components/auth/form-parts";
import { IDLE } from "@/lib/actions/result";

/**
 * Shown instead of `SetPasswordForm` when the session's Google sign-in is older
 * than the re-authentication window (lib/auth/reauth.ts): a stolen cookie must not
 * be able to give a Google-only account a password. The button re-runs Google
 * sign-in with `prompt=login` and comes back to this page.
 */
export function ConfirmWithGoogleForm(): React.JSX.Element {
  const t = useTranslations("account");
  const [result, formAction] = useActionState(reauthenticateWithGoogleAction, IDLE);

  return (
    <form action={formAction} className="space-y-3" data-testid="confirm-with-google-form">
      <p className="text-sm text-ink-muted">{t("password.reauthDescription")}</p>
      <FormError result={result} testId="confirm-with-google-error" />
      <SubmitButton
        label={t("password.reauthButton")}
        pendingLabel={t("password.submitting")}
        tone="ghost"
      />
    </form>
  );
}
