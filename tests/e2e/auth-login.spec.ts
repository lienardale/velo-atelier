/**
 * Sign-in, sign-out and the route guard, end to end (§4.8 AC5, §6.2).
 *
 * Four claims, all of them ones that only a real browser against a real build
 * can settle:
 *
 * 1. **No account enumeration.** An unknown address and a wrong password
 *    produce the *identical* message, through the same code path. This is the
 *    one place the project refuses to be helpful on purpose.
 * 2. **The guard redirects with a callbackUrl, in the right locale.**
 *    `/fr/mes-velos` → `/fr/connexion?callbackUrl=%2Ffr%2Fmes-velos`, and
 *    `/en/my-bikes` → `/en/sign-in?callbackUrl=%2Fen%2Fmy-bikes`. That URL is
 *    produced by `authorized()` inside the proxy, so it exercises the whole
 *    Auth.js-over-next-intl stack, not a unit.
 * 3. **Signing out really clears `authjs.session-token`**, rather than leaving
 *    a cookie the next request would still decode.
 * 4. **Google is offered, never driven.** The button is asserted as present;
 *    the round trip is a manual checklist (`docs/qa/google-oauth.md`).
 */
import {
  DEMO_USER,
  expect,
  forEachLocale,
  href,
  sessionCookieName,
  test,
  type Locale,
  signInContext,
} from "./_fixtures";

import en from "../../messages/en/auth.json";
import fr from "../../messages/fr/auth.json";
import errorsEn from "../../messages/en/errors.json";
import errorsFr from "../../messages/fr/errors.json";

/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed message fixtures, and patterns built from paths this file computed itself */
const AUTH: Record<Locale, typeof fr> = { fr, en };
const ERRORS: Record<Locale, typeof errorsFr> = { fr: errorsFr, en: errorsEn };

forEachLocale((locale) => {
  const t = AUTH[locale];
  const errors = ERRORS[locale];

  test(`the sign-in page renders its form (${locale})`, async ({ page }) => {
    const response = await page.goto(href(locale, "/connexion"));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.signIn.title);
    await expect(page.getByTestId("sign-in-form")).toBeVisible();
    await expect(page.getByLabel(t.fields.email, { exact: true })).toHaveAttribute(
      "autocomplete",
      "email",
    );
    await expect(page.getByLabel(t.fields.password, { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex|nofollow/,
    );
  });

  test(`offers Google, and never clicks it (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/connexion"));

    await expect(page.locator("[data-provider=google]")).toBeVisible();
    await expect(page.locator("[data-provider=google]").getByRole("button")).toHaveText(
      new RegExp(t.google.signIn),
    );
  });

  test(`an unknown address and a wrong password say exactly the same thing (${locale})`, async ({
    page,
  }) => {
    const messages: string[] = [];

    for (const [email, password] of [
      ["personne-ici@velo-atelier.test", "Guidon-Tandem-47!"],
      [DEMO_USER.email, "Guidon-Tandem-48!"],
    ] as const) {
      await page.goto(href(locale, "/connexion"));
      await page.getByLabel(t.fields.email, { exact: true }).fill(email);
      await page.getByLabel(t.fields.password, { exact: true }).fill(password);
      await page.getByRole("button", { name: t.signIn.submit }).click();

      const error = page.getByTestId("form-error");
      await expect(error).toHaveText(errors.invalidCredentials);
      messages.push((await error.textContent()) ?? "");
    }

    expect(messages[0]).toBe(messages[1]);
  });

  test(`a correct pair signs in and lands on the bikes page (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto(href(locale, "/connexion"));
    await page.getByLabel(t.fields.email, { exact: true }).fill(DEMO_USER.email);
    await page.getByLabel(t.fields.password, { exact: true }).fill(DEMO_USER.password);
    await page.getByRole("button", { name: t.signIn.submit }).click();

    await page.waitForURL(`**${href(locale, "/mes-velos")}`);

    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    expect((await context.cookies()).some((cookie) => cookie.name === name)).toBe(true);
  });

  test(`the demo callout fills the form when NEXT_PUBLIC_DEMO_LOGIN=1 (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/connexion"));

    await expect(page.getByTestId("demo-callout")).toBeVisible();
    await page.getByRole("button", { name: t.demo.fill }).click();

    await expect(page.getByLabel(t.fields.email, { exact: true })).toHaveValue(DEMO_USER.email);
  });

  test(`a protected page redirects to the localized form with a callbackUrl (${locale})`, async ({
    page,
  }) => {
    const target = href(locale, "/mes-velos");

    await page.goto(target);

    await expect(page).toHaveURL(
      new RegExp(
        `${href(locale, "/connexion")}\\?callbackUrl=${encodeURIComponent(target).replace(
          /%/g,
          "%",
        )}$`,
      ),
    );
  });

  test(`signing in from that redirect returns to where the visitor was going (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/compte"));
    await expect(page).toHaveURL(new RegExp("callbackUrl="));

    await page.getByLabel(t.fields.email, { exact: true }).fill(DEMO_USER.email);
    await page.getByLabel(t.fields.password, { exact: true }).fill(DEMO_USER.password);
    await page.getByRole("button", { name: t.signIn.submit }).click();

    await page.waitForURL(`**${href(locale, "/compte")}`);
  });

  test(`an off-site callbackUrl is replaced by the visitor's own page (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${href(locale, "/connexion")}?callbackUrl=https%3A%2F%2Fevil.test`);

    await page.getByLabel(t.fields.email, { exact: true }).fill(DEMO_USER.email);
    await page.getByLabel(t.fields.password, { exact: true }).fill(DEMO_USER.password);
    await page.getByRole("button", { name: t.signIn.submit }).click();

    await page.waitForURL(`**${href(locale, "/mes-velos")}`);
    expect(page.url()).not.toContain("evil.test");
  });

  test(`a signed-in visitor is sent away from the sign-in page (${locale})`, async ({
    page,
    signedInContext,
  }) => {
    await signedInContext();

    await page.goto(href(locale, "/connexion"));

    await expect(page).toHaveURL(new RegExp(`${href(locale, "/mes-velos")}$`));
  });

  test(`an invalidated session is cleared instead of looping (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    // The cookie of a device whose password was changed elsewhere: an older
    // sessionVersion than the row, last checked more than 5 minutes ago. The proxy
    // cannot check sessionVersion and still sees a signed-in visitor; before the
    // fix, page and proxy bounced it between /mes-velos and /connexion forever.
    await signInContext(
      context,
      { ...DEMO_USER, sessionVersion: 41, checkedAt: Date.now() - 10 * 60_000 },
      baseURL ?? "http://localhost:3100",
    );

    const response = await page.goto(href(locale, "/mes-velos"));

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/connexion")}\\?callbackUrl=`));
    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    expect((await context.cookies()).find((entry) => entry.name === name)?.value ?? "").toBe("");
  });

  test(`an invalidated session reached by a client-side click also ends on the form (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    // Same dead cookie, but the visitor clicks "Connexion" in the header: a router
    // (RSC) request, not a page load. The proxy still believes the session and
    // redirects to /mes-velos; the page rejects it; the background request that
    // reaches /api/session-expired gets a 401 (it must not delete cookies — see
    // .debug/003), and the router's full-page fallback clears the cookie.
    await signInContext(
      context,
      { ...DEMO_USER, sessionVersion: 41, checkedAt: Date.now() - 10 * 60_000 },
      baseURL ?? "http://localhost:3100",
    );
    await page.goto(href(locale, "/"));

    await page.getByTestId("account-sign-in").click();

    await expect(page).toHaveURL(new RegExp(`${href(locale, "/connexion")}(\\?|$)`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.signIn.title);
    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    await expect
      .poll(async () => (await context.cookies()).find((entry) => entry.name === name)?.value ?? "")
      .toBe("");
  });

  test(`signing out clears the session cookie (${locale})`, async ({
    page,
    context,
    signedInContext,
    baseURL,
  }) => {
    await signedInContext();
    await page.goto(href(locale, "/mes-velos"));

    await page.getByTestId("account-menu-button").click();
    await page.getByTestId("sign-out").click();
    await page.waitForURL(`**/${locale}`);

    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    const cookie = (await context.cookies()).find((entry) => entry.name === name);
    expect(cookie?.value ?? "").toBe("");

    // And the guard now behaves as it does for anyone else.
    await page.goto(href(locale, "/mes-velos"));
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/connexion")}\\?callbackUrl=`));
  });

  test(`an Auth.js ?error= is rendered from the fixed map, never echoed (${locale})`, async ({
    page,
  }) => {
    await page.goto(
      `${href(locale, "/connexion")}?error=${encodeURIComponent("<img src=x onerror=alert(1)>")}`,
    );

    await expect(page.getByTestId("auth-error")).toHaveText(errors.authFailed);
    expect(await page.locator("img[src='x']").count()).toBe(0);
  });

  test(`OAuthAccountNotLinked explains itself (${locale})`, async ({ page }) => {
    await page.goto(`${href(locale, "/connexion")}?error=OAuthAccountNotLinked`);

    await expect(page.getByTestId("auth-error")).toHaveText(errors.oauthAccountNotLinked);
  });
});

// English only, on purpose: French is the default locale, so a French cookie
// would land on /fr/connexion whether the cookie was read or ignored. Only the
// non-default locale proves the cookie decides.
test("the unprefixed Auth.js page gets a locale from the cookie", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", domain: "localhost", path: "/" }]);

  await page.goto("/connexion?error=AccessDenied");

  await expect(page).toHaveURL(/\/en\/sign-in\?error=AccessDenied$/);
  await expect(page.getByTestId("auth-error")).toHaveText(errorsEn.accessDenied);
});
