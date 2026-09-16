"use client";

import { useActionState, useId } from "react";
import { useTranslations } from "next-intl";

import { updateProfileAction } from "@/app/[locale]/(protected)/compte/actions";
import {
  FormError,
  SubmitButton,
  SuccessNote,
  TextField,
  useFieldMessage,
} from "@/components/auth/form-parts";
import { IDLE } from "@/lib/actions/result";
import { routing, type Locale } from "@/lib/i18n/routing";

/**
 * Name and interface language (§4.3).
 *
 * The e-mail address is shown `readOnly` rather than hidden: people look for it
 * to check which account they are in, and an address they can see but not edit
 * is honest about what the MVP supports (changing it needs a verification
 * e-mail, which is out of scope). It is not submitted — the action's schema is
 * `.strict()` and would reject it.
 *
 * Changing the language here changes the **account's** language, which is what
 * follows the visitor onto another device. `LocaleSwitcher` in the header
 * changes only the page being read. Both exist on purpose.
 */
export function ProfileForm({
  email,
  name,
  locale,
}: {
  email: string;
  name: string | null;
  locale: Locale;
}): React.JSX.Element {
  const t = useTranslations("account.profile");
  const tCommon = useTranslations("common.localeNames");
  const [result, formAction] = useActionState(updateProfileAction, IDLE);
  const messageFor = useFieldMessage(result);
  const selectId = useId();

  return (
    <form action={formAction} className="space-y-4" data-testid="profile-form">
      <FormError result={result} testId="profile-error" />

      <TextField
        label={t("email")}
        hint={t("emailHint")}
        type="email"
        defaultValue={email}
        readOnly
      />

      <TextField
        name="name"
        label={t("name")}
        autoComplete="name"
        defaultValue={name ?? ""}
        error={messageFor("name")}
      />

      <div className="space-y-1">
        <label htmlFor={selectId} className="block text-sm font-medium text-ink">
          {t("locale")}
        </label>
        <select
          id={selectId}
          name="locale"
          defaultValue={locale}
          aria-invalid={messageFor("locale") ? true : undefined}
          className="min-h-[var(--tap-min)] w-full rounded-md border border-rule bg-paper px-3 text-base text-ink"
        >
          {routing.locales.map((value) => (
            <option key={value} value={value}>
              {tCommon(value)}
            </option>
          ))}
        </select>
        {messageFor("locale") ? (
          <p className="text-sm text-danger-fg">{messageFor("locale")}</p>
        ) : null}
      </div>

      <SubmitButton label={t("submit")} pendingLabel={t("submitting")} />
      <SuccessNote testId="profile-success" result={result} message={t("saved")} />
    </form>
  );
}
