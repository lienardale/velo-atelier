"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { deleteAccountAction } from "@/app/[locale]/(protected)/compte/actions";
import {
  FormError,
  PasswordField,
  SubmitButton,
  TextField,
  useFieldMessage,
} from "@/components/auth/form-parts";
import { IDLE } from "@/lib/actions/result";

/**
 * Account deletion, behind a modal confirmation (§4.3, RGPD "right to erasure").
 *
 * A native `<dialog showModal()>`, the same primitive `MobileNav` uses: the rest
 * of the page is inert while it is open, focus cannot leave it, Escape closes
 * it, and focus returns to the trigger — with no focus-trap library.
 *
 * The confirmation is the account's **password** when it has one, and the word
 * `SUPPRIMER` / `DELETE` for a Google-only account. The dialog also says what
 * disappears, with the bike count spelled out, because "are you sure?" is not
 * informed consent and there is no undo.
 */
export function DeleteAccountDialog({
  hasPassword,
  bikeCount,
}: {
  hasPassword: boolean;
  bikeCount: number;
}): React.JSX.Element {
  const t = useTranslations("account.delete");
  const [result, formAction] = useActionState(deleteAccountAction, IDLE);
  const messageFor = useFieldMessage(result);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // A failed confirmation must be readable: re-open the dialog the action's
  // response closed.
  useEffect(() => {
    if (!result.ok && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
      setOpen(true);
    }
  }, [result]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">{t("description")}</p>

      <button
        ref={triggerRef}
        type="button"
        data-testid="delete-account-open"
        aria-expanded={open}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        className="tap-target rounded-md border border-danger px-4 text-sm font-semibold text-danger-fg hover:bg-paper-2"
      >
        {t("open")}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="delete-account-title"
        onClose={() => setOpen(false)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-rule bg-paper p-5 text-ink backdrop:bg-black/50"
      >
        <h2 id="delete-account-title" className="text-lg font-semibold">
          {t("dialogTitle")}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {t("dialogDescription", { bikes: t("bikesCount", { count: bikeCount }) })}
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <FormError result={result} testId="delete-account-error" />
          {hasPassword ? (
            <PasswordField
              name="confirmation"
              label={t("confirmLabelPassword")}
              autoComplete="current-password"
              error={messageFor("confirmation")}
            />
          ) : (
            <TextField
              name="confirmation"
              label={t("confirmLabelWord")}
              autoComplete="off"
              required
              error={messageFor("confirmation")}
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <SubmitButton
              label={t("confirm")}
              pendingLabel={t("submitting")}
              tone="danger"
              className="sm:flex-1"
            />
            <button
              type="button"
              onClick={close}
              className="tap-target w-full rounded-md border border-rule px-4 text-base font-medium text-ink hover:bg-paper-2 sm:flex-1"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
