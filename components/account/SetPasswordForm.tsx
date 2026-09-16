"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";

import { setPasswordAction } from "@/app/[locale]/(protected)/compte/actions";
import {
  FormError,
  PasswordField,
  SubmitButton,
  SuccessNote,
  useFieldMessage,
} from "@/components/auth/form-parts";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { IDLE } from "@/lib/actions/result";

/**
 * Give a Google-only account a password (§4.3).
 *
 * Shown instead of `ChangePasswordForm` when `User.passwordHash` is null. There
 * is no "current password" to ask for — there isn't one — which is exactly why
 * the *server* re-checks that the account really has no hash before writing one
 * (`setPasswordAction` answers `FORBIDDEN` otherwise). Without that check,
 * anyone holding a session could overwrite a password they do not know.
 *
 * This is also the MVP's answer to "I lost access to my Google account": add a
 * password while you still can. Password reset by e-mail is out of scope
 * (`docs/backlog.md`).
 */
export function SetPasswordForm({ email }: { email: string }): React.JSX.Element {
  const t = useTranslations("account.password");
  const [result, formAction] = useActionState(setPasswordAction, IDLE);
  const messageFor = useFieldMessage(result);
  const [next, setNext] = useState("");
  const meterId = useId();

  return (
    <form action={formAction} className="space-y-4" data-testid="set-password-form">
      <FormError result={result} testId="set-password-error" />

      <PasswordField
        name="next"
        label={t("next")}
        autoComplete="new-password"
        value={next}
        onValueChange={setNext}
        describedById={meterId}
        error={messageFor("next")}
      >
        <PasswordStrength password={next} email={email} describedById={meterId} />
      </PasswordField>

      <SubmitButton label={t("submitSet")} pendingLabel={t("submitting")} />
      <SuccessNote testId="set-password-success" result={result} message={t("set")} />
    </form>
  );
}
