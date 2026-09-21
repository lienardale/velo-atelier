/**
 * The auth and account forms render the message KEY a server action returned
 * (§1.2 `ActionResult`, §4.3) — `errors.*` and `auth.password.<issue>` — and
 * their routes now ship only `auth` and `errors` (plus the account pages' own
 * namespaces) instead of the whole catalogue (`lib/i18n/client-namespaces.ts`,
 * `.debug/008`). These tests hold the forms to that: every key those actions
 * can return renders from `auth` + `errors` alone, with nothing reported
 * missing.
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import type { FormResult } from "@/lib/actions/result";
import { PASSWORD_ISSUES } from "@/lib/auth/password-strength";
import { loadMessages } from "@/lib/i18n/request";
import type { Locale } from "@/lib/i18n/routing";

import { FormError, useFieldMessage } from "./form-parts";

/** `errors.*` messages that take no ICU argument: the ones an action names as a field or form error. */
async function plainErrorKeys(locale: Locale): Promise<string[]> {
  const errors = (await loadMessages(locale)).errors as Record<string, string>;
  return Object.entries(errors)
    .filter(([, message]) => !message.includes("{"))
    .map(([key]) => `errors.${key}`);
}

const PASSWORD_KEYS = PASSWORD_ISSUES.map((issue) => `auth.password.${issue}`);

function FieldProbe({ result, fields }: { result: FormResult; fields: string[] }) {
  const message = useFieldMessage(result);
  return (
    <ul>
      {fields.map((field) => (
        <li key={field} data-testid={`field-${field}`}>
          {message(field) ?? ""}
        </li>
      ))}
    </ul>
  );
}

/** The catalogue cut down to `namespaces`, as `ClientMessages` sends it. */
function only(all: Record<string, unknown>, namespaces: string[]): Record<string, unknown> {
  return Object.fromEntries(namespaces.map((namespace) => [namespace, all[namespace]]));
}

async function scoped(locale: Locale, ui: React.ReactNode) {
  const all = await loadMessages(locale);
  const onError = vi.fn();
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Europe/Paris"
      messages={only(all, ["auth", "errors"])}
      onError={onError}
    >
      {ui}
    </NextIntlClientProvider>,
  );
  return { all, onError };
}

function messageOf(all: Record<string, unknown>, key: string): string {
  const [namespace, ...path] = key.split(".");
  let node: unknown = all[namespace!];
  for (const segment of path) node = (node as Record<string, unknown>)[segment];
  return node as string;
}

describe("form-parts under the auth routes' own namespaces", () => {
  for (const locale of ["fr", "en"] as const) {
    it(`renders every field message an action can return (${locale})`, async () => {
      const keys = [...(await plainErrorKeys(locale)), ...PASSWORD_KEYS];
      const fields = keys.map((_, index) => `f${index}`);
      const result: FormResult = {
        ok: false,
        code: "VALIDATION",
        fieldErrors: Object.fromEntries(fields.map((field, index) => [field, keys[index]!])),
      };
      const { all, onError } = await scoped(locale, <FieldProbe result={result} fields={fields} />);
      keys.forEach((key, index) => {
        expect(screen.getByTestId(`field-${fields[index]}`).textContent, key).toBe(
          messageOf(all, key),
        );
      });
      expect(onError).not.toHaveBeenCalled();
    });

    it(`renders a form-level key and a bare code in the error region (${locale})`, async () => {
      const { all, onError } = await scoped(
        locale,
        <>
          <FormError
            testId="with-key"
            result={{ ok: false, code: "FORBIDDEN", fieldErrors: { form: "auth.password.weak" } }}
          />
          <FormError testId="bare-code" result={{ ok: false, code: "RATE_LIMITED" }} />
        </>,
      );
      expect(screen.getByTestId("with-key").textContent).toBe(messageOf(all, "auth.password.weak"));
      expect(screen.getByTestId("bare-code").textContent).toBe(
        messageOf(all, "errors.RATE_LIMITED"),
      );
      expect(onError).not.toHaveBeenCalled();
    });
  }

  it("reports a key outside auth and errors instead of rendering it from elsewhere", async () => {
    const { onError } = await scoped(
      "fr",
      <FormError
        result={{ ok: false, code: "VALIDATION", fieldErrors: { form: "bike.errors.fitRange" } }}
      />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![0])).toMatch(/MISSING_MESSAGE/);
  });
});
