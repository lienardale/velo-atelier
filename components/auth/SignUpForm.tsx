"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";

import { signUpAction } from "@/app/[locale]/(auth)/inscription/actions";
import { IDLE } from "@/lib/actions/result";
import type { Locale } from "@/lib/i18n/routing";

import { FormError, PasswordField, SubmitButton, TextField, useFieldMessage } from "./form-parts";
import { PasswordStrength } from "./PasswordStrength";

/**
 * The sign-up form (§4.3, §6.2).
 *
 * The password field is controlled — the only one in the project that is —
 * because the strength meter needs every keystroke, and the e-mail field is
 * watched for the same reason: `containsEmail` is one of the four rules, and a
 * meter that says "don't use your address" without knowing the address would be
 * theatre.
 *
 * **The submit button stays enabled whatever the meter says.** The meter is
 * advisory; `lib/auth/password-policy.ts` is the decision, it runs on every
 * submission, and `tests/e2e/auth-signup.spec.ts` proves it by posting a weak
 * password with the client bypassed. Disabling the button would only hide the
 * server's message from the people most likely to need it.
 */
export function SignUpForm({
  locale,
  callbackUrl,
}: {
  locale: Locale;
  callbackUrl?: string;
}): React.JSX.Element {
  const t = useTranslations("auth");
  const [result, formAction] = useActionState(signUpAction, IDLE);
  const messageFor = useFieldMessage(result);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const meterId = useId();

  return (
    <form action={formAction} noValidate className="space-y-4" data-testid="sign-up-form">
      <input type="hidden" name="locale" value={locale} />
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}

      <FormError result={result} />

      <div className="space-y-1">
        <label htmlFor={`${meterId}-email`} className="block text-sm font-medium text-ink">
          {t("fields.email")}
        </label>
        <input
          id={`${meterId}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={messageFor("email") ? true : undefined}
          aria-describedby={messageFor("email") ? `${meterId}-email-error` : undefined}
          className="min-h-[var(--tap-min)] w-full rounded-md border border-rule bg-paper px-3 py-2 text-base text-ink aria-[invalid=true]:border-danger"
        />
        {messageFor("email") ? (
          <p id={`${meterId}-email-error`} className="text-sm text-danger-fg">
            {messageFor("email")}
          </p>
        ) : null}
      </div>

      <TextField
        name="name"
        label={t("fields.name")}
        hint={t("fields.nameHint")}
        autoComplete="name"
        error={messageFor("name")}
      />

      <PasswordField
        name="password"
        label={t("fields.password")}
        autoComplete="new-password"
        hint={t("password.requirements")}
        value={password}
        onValueChange={setPassword}
        describedById={meterId}
        error={messageFor("password")}
      >
        <PasswordStrength password={password} email={email} describedById={meterId} />
      </PasswordField>

      <SubmitButton label={t("signUp.submit")} pendingLabel={t("signUp.submitting")} />
    </form>
  );
}
