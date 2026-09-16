"use client";

import { useActionState, useRef } from "react";
import { useTranslations } from "next-intl";

import { loginAction } from "@/app/[locale]/(auth)/connexion/actions";
import { IDLE } from "@/lib/actions/result";
import type { Locale } from "@/lib/i18n/routing";

import { FormError, PasswordField, SubmitButton, TextField, useFieldMessage } from "./form-parts";

/**
 * The sign-in form (§4.3, §6.2).
 *
 * Single column, `max-w-sm`, every control ≥ 44 px, `autocomplete="email"` and
 * `"current-password"` so a password manager fills it, `inputMode="email"` so a
 * phone shows the right keyboard, and 16 px text so iOS does not zoom on focus.
 *
 * The submit button is **not** disabled when a field is empty: the browser's own
 * `required` handles that, and a disabled button hides the reason from anyone
 * relying on a screen reader.
 *
 * `callbackUrl` and `locale` travel as hidden inputs rather than being read from
 * the server: the action is a POST to this same page and must not depend on
 * next-intl's request context to know where to send the visitor next. Both are
 * re-validated server-side (`safeCallbackUrl`, `isLocale`) — a hidden input is a
 * suggestion, never a fact.
 *
 * The demo callout appears only when `NEXT_PUBLIC_DEMO_LOGIN=1`, which is set in
 * `.env.example` and by the Playwright web server, and never on Vercel
 * (`lib/env.ts` fails the boot if it is).
 */
export function SignInForm({
  locale,
  callbackUrl,
  demo,
}: {
  locale: Locale;
  callbackUrl?: string;
  /** Credentials shown in the dev-only "fill in the demo account" callout. */
  demo?: { email: string; password: string };
}): React.JSX.Element {
  const t = useTranslations("auth");
  const [result, formAction] = useActionState(loginAction, IDLE);
  const messageFor = useFieldMessage(result);
  const formRef = useRef<HTMLFormElement>(null);

  function fillDemo() {
    const form = formRef.current;
    if (!form || !demo) return;
    const email = form.elements.namedItem("email") as HTMLInputElement | null;
    const password = form.elements.namedItem("password") as HTMLInputElement | null;
    if (email) email.value = demo.email;
    if (password) password.value = demo.password;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="space-y-4"
      data-testid="sign-in-form"
    >
      <input type="hidden" name="locale" value={locale} />
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}

      <FormError result={result} />

      <TextField
        name="email"
        label={t("fields.email")}
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        error={messageFor("email")}
      />

      <PasswordField
        name="password"
        label={t("fields.password")}
        autoComplete="current-password"
        error={messageFor("password")}
      />

      <SubmitButton label={t("signIn.submit")} pendingLabel={t("signIn.submitting")} />

      {demo ? (
        <div
          className="rounded-md border border-rule bg-paper-2 p-3 text-sm"
          data-testid="demo-callout"
        >
          <p className="font-medium text-ink">{t("demo.title")}</p>
          <p className="text-ink-muted">{t("demo.description")}</p>
          <button
            type="button"
            onClick={fillDemo}
            className="tap-target mt-2 rounded-md border border-rule px-3 text-sm font-medium text-ink hover:bg-paper"
          >
            {t("demo.fill")}
          </button>
        </div>
      ) : null}
    </form>
  );
}
