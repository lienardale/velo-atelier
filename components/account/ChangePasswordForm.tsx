"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";

import { changePasswordAction } from "@/app/[locale]/(protected)/compte/actions";
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
 * Change an existing password (§4.3).
 *
 * The current password is required — a session alone must never be enough to
 * replace a password, or a borrowed laptop becomes a stolen account. The new one
 * goes through the same meter and the same server policy as sign-up.
 *
 * The description under the heading says out loud that other devices will be
 * signed out: that is the visible half of the `sessionVersion` bump, and people
 * who change a password because they think it leaked need to know it worked.
 */
export function ChangePasswordForm({ email }: { email: string }): React.JSX.Element {
  const t = useTranslations("account.password");
  const [result, formAction] = useActionState(changePasswordAction, IDLE);
  const messageFor = useFieldMessage(result);
  const [next, setNext] = useState("");
  const meterId = useId();

  return (
    <form action={formAction} className="space-y-4" data-testid="change-password-form">
      <FormError result={result} testId="change-password-error" />

      <PasswordField
        name="current"
        label={t("current")}
        autoComplete="current-password"
        error={messageFor("current")}
      />

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

      <SubmitButton label={t("submitChange")} pendingLabel={t("submitting")} />
      <SuccessNote testId="change-password-success" result={result} message={t("changed")} />
    </form>
  );
}
