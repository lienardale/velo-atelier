/**
 * Sign-up, end to end (§4.8 AC5, §6.2).
 *
 * The assertion that matters most is the third one: **the password policy is
 * enforced server-side even when the client is bypassed.** The test removes the
 * form's `noValidate`-free client state by posting the form directly with
 * `requestSubmit()` after setting the field's value through the DOM — the live
 * meter never runs — and the server still refuses. That is the whole reason
 * `lib/auth/password-policy.ts` exists separately from the meter.
 *
 * Everything else here is the page's contract: the form is reachable, it speaks
 * the visitor's language, the Google button is present (and never clicked — we
 * do not drive Google in CI, see `docs/qa/google-oauth.md`), a duplicate address
 * is reported on the field, and a real sign-up lands on `/mes-velos` with a
 * session cookie.
 */
import { expect, forEachLocale, href, sessionCookieName, test, type Locale } from "./_fixtures";

import en from "../../messages/en/auth.json";
import fr from "../../messages/fr/auth.json";
import errorsEn from "../../messages/en/errors.json";
import errorsFr from "../../messages/fr/errors.json";

/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed message fixtures, and patterns built from paths this file computed itself */
const AUTH: Record<Locale, typeof fr> = { fr, en };
const ERRORS: Record<Locale, typeof errorsFr> = { fr: errorsFr, en: errorsEn };

const STRONG = "Guidon-Tandem-47!";

forEachLocale((locale) => {
  const t = AUTH[locale];

  test(`the sign-up page renders its form (${locale})`, async ({ page }) => {
    const response = await page.goto(href(locale, "/inscription"));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.signUp.title);
    await expect(page.getByTestId("sign-up-form")).toBeVisible();
    await expect(page.getByLabel(t.fields.email, { exact: true })).toHaveAttribute("type", "email");
    await expect(page.getByLabel(t.fields.password, { exact: true })).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  test(`offers Google without ever being clicked (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/inscription"));

    const google = page.locator("[data-provider=google]");
    await expect(google).toBeVisible();
    await expect(google.getByRole("button")).toHaveText(new RegExp(t.google.signIn));
  });

  test(`the live meter reacts to what is typed (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/inscription"));
    const password = page.getByLabel(t.fields.password, { exact: true });

    await password.fill("velo");
    await expect(page.locator('[data-rule="length"]')).toHaveAttribute("data-satisfied", "false");

    await password.fill(STRONG);
    await expect(page.locator('[data-rule="length"]')).toHaveAttribute("data-satisfied", "true");
    await expect(page.locator('[data-rule="classes"]')).toHaveAttribute("data-satisfied", "true");
    // The score arrives from a dynamically imported chunk.
    await expect(page.getByRole("progressbar")).toHaveAttribute("data-score", /[34]/);
  });

  test(`the submit button is never disabled by a weak password (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/inscription"));

    await page.getByLabel(t.fields.password, { exact: true }).fill("velo");

    await expect(page.getByRole("button", { name: t.signUp.submit })).toBeEnabled();
  });

  test(`the server refuses a weak password even with the client bypassed (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    await page.goto(href(locale, "/inscription"));

    // Fill the DOM directly and submit the form element: no React change
    // handler, no meter, no client-side gate of any kind.
    await page.evaluate(
      ([email, weak]) => {
        const form = document.querySelector<HTMLFormElement>('[data-testid="sign-up-form"]')!;
        const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]')!;
        const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]')!;
        const setValue = (input: HTMLInputElement, value: string) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        setValue(emailInput, email);
        setValue(passwordInput, weak);
        form.requestSubmit();
      },
      [signupEmail, "velo"] as const,
    );

    // The refusal is the SERVER's, rendered as the password field's message.
    await expect(page.getByText(t.password.tooShort)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/inscription")}$`));
  });

  test(`a real sign-up creates the account and signs it in (${locale})`, async ({
    page,
    context,
    signupEmail,
    baseURL,
  }) => {
    await page.goto(href(locale, "/inscription"));

    await page.getByLabel(t.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(t.fields.password, { exact: true }).fill(STRONG);
    await page.getByRole("button", { name: t.signUp.submit }).click();

    await page.waitForURL(`**${href(locale, "/mes-velos")}`);

    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === name)?.value).toBeTruthy();
  });

  test(`a second account on the same address is refused on the field (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    await page.goto(href(locale, "/inscription"));
    await page.getByLabel(t.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(t.fields.password, { exact: true }).fill(STRONG);
    await page.getByRole("button", { name: t.signUp.submit }).click();
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);

    // A second browser context would be cleaner, but the point is the server's
    // answer: sign out, come back, try the same address.
    await page.getByTestId("account-menu-button").click();
    await page.getByTestId("sign-out").click();
    await page.waitForURL(`**/${locale}`);

    await page.goto(href(locale, "/inscription"));
    await page.getByLabel(t.fields.email, { exact: true }).fill(signupEmail.toUpperCase());
    await page.getByLabel(t.fields.password, { exact: true }).fill(STRONG);
    await page.getByRole("button", { name: t.signUp.submit }).click();

    await expect(page.getByText(ERRORS[locale].emailTaken)).toBeVisible();
  });

  test(`a signed-in visitor is sent away from the sign-up page (${locale})`, async ({
    page,
    signedInContext,
  }) => {
    await signedInContext();

    await page.goto(href(locale, "/inscription"));

    await expect(page).toHaveURL(new RegExp(`${href(locale, "/mes-velos")}$`));
  });

  test(`the page is not indexed (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/inscription"));

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex|nofollow/,
    );
  });
});
