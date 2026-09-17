/**
 * `/fr/compte` · `/en/account`, end to end (§4.8 AC5–AC6, §6.2).
 *
 * The account page is where a signed-in visitor changes their name, their
 * language, their password, and deletes everything. Three things are worth
 * proving in a real browser rather than in a unit test:
 *
 * 1. **Changing the password keeps THIS device signed in.** `changePasswordAction`
 *    bumps `User.sessionVersion` — which drops every other device — and then
 *    re-issues this device's session cookie with the new number
 *    (`lib/auth/session-cookie.ts`). If that ever broke, the visitor would be
 *    logged out by their own password change, and only a browser with a real
 *    cookie can tell.
 * 2. **The wrong current password is refused on the field**, and the old
 *    password still works afterwards.
 * 3. **Deletion is confirmed, then total**: the dialog asks, the account goes,
 *    the session goes with it, and the page is no longer reachable.
 *
 * Each `test` signs in with its own freshly created account rather than the
 * seeded demo user, because these mutate and delete. The demo user stays intact
 * for every other spec.
 */
import {
  ageSessionCookie,
  expect,
  forEachLocale,
  href,
  sessionCookieName,
  test,
  type Locale,
} from "./_fixtures";

import accountEn from "../../messages/en/account.json";
import accountFr from "../../messages/fr/account.json";
import authEn from "../../messages/en/auth.json";
import authFr from "../../messages/fr/auth.json";
import errorsEn from "../../messages/en/errors.json";
import errorsFr from "../../messages/fr/errors.json";

/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed message fixtures, and patterns built from paths this file computed itself */
const ACCOUNT: Record<Locale, typeof accountFr> = { fr: accountFr, en: accountEn };
const AUTH: Record<Locale, typeof authFr> = { fr: authFr, en: authEn };
const ERRORS: Record<Locale, typeof errorsFr> = { fr: errorsFr, en: errorsEn };

const PASSWORD = "Guidon-Tandem-47!";
const NEXT_PASSWORD = "Chaine-Cassette-58?";

forEachLocale((locale) => {
  const t = ACCOUNT[locale];
  const auth = AUTH[locale];
  const errors = ERRORS[locale];

  /** Create an account through the real sign-up form and land signed in. */
  async function register(
    page: import("@playwright/test").Page,
    email: string,
    password = PASSWORD,
  ): Promise<void> {
    await page.goto(href(locale, "/inscription"));
    await page.getByLabel(auth.fields.email, { exact: true }).fill(email);
    await page.getByLabel(auth.fields.password, { exact: true }).fill(password);
    await page.getByRole("button", { name: auth.signUp.submit }).click();
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);
  }

  test(`shows the profile, the password section and the danger zone (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    await register(page, signupEmail);

    const response = await page.goto(href(locale, "/compte"));
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId("signed-in-with")).toHaveText(t.signedInWith.password);
    await expect(page.getByTestId("profile-form")).toBeVisible();
    await expect(page.getByTestId("change-password-form")).toBeVisible();
    await expect(page.getByTestId("set-password-form")).toHaveCount(0);
    await expect(page.getByTestId("delete-account-open")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex|nofollow/,
    );
  });

  test(`shows the address read-only (${locale})`, async ({ page, signupEmail }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    const email = page.getByTestId("profile-form").getByRole("textbox", { name: t.profile.email });
    await expect(email).toHaveValue(signupEmail);
    await expect(email).toHaveAttribute("readonly", "");
  });

  test(`saves the display name (${locale})`, async ({ page, signupEmail }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    await page.locator('[data-testid="profile-form"] input[name="name"]').fill("Camille B.");
    await page.getByRole("button", { name: t.profile.submit }).click();

    await expect(page.getByTestId("profile-success")).toHaveText(t.profile.saved);
    await page.reload();
    await expect(page.locator('[data-testid="profile-form"] input[name="name"]')).toHaveValue(
      "Camille B.",
    );
  });

  test(`refuses a wrong current password on the field (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    const form = page.getByTestId("change-password-form");
    await form.locator('input[name="current"]').fill("Pas-Le-Bon-Mot-42!");
    await form.locator('input[name="next"]').fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: t.password.submitChange }).click();

    await expect(page.getByText(errors.wrongPassword)).toBeVisible();
  });

  test(`refuses a weak new password server-side (${locale})`, async ({ page, signupEmail }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    const form = page.getByTestId("change-password-form");
    await form.locator('input[name="current"]').fill(PASSWORD);
    await form.locator('input[name="next"]').fill("velo");
    await page.getByRole("button", { name: t.password.submitChange }).click();

    await expect(page.getByText(auth.password.tooShort)).toBeVisible();
  });

  test(`changes the password and keeps THIS device signed in (${locale})`, async ({
    page,
    context,
    signupEmail,
    baseURL,
  }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    const form = page.getByTestId("change-password-form");
    await form.locator('input[name="current"]').fill(PASSWORD);
    await form.locator('input[name="next"]').fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: t.password.submitChange }).click();

    await expect(page.getByText(t.password.changed)).toBeVisible();

    // Still signed in, still on the account page, cookie still present.
    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    expect((await context.cookies()).find((cookie) => cookie.name === name)?.value).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);

    // And the new password is the one that works now.
    await page.getByTestId("account-menu-button").click();
    await page.getByTestId("sign-out").click();
    await page.waitForURL(`**/${locale}`);

    await page.goto(href(locale, "/connexion"));
    await page.getByLabel(auth.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(auth.fields.password, { exact: true }).fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: auth.signIn.submit }).click();
    await page.waitForURL(`**${href(locale, "/mes-velos")}`);
  });

  test(`changes the password from an older session and stays on the page (${locale})`, async ({
    page,
    context,
    signupEmail,
    baseURL,
  }) => {
    // A session last checked more than 5 minutes ago, like most real ones. Before
    // the fix the same-response re-render read the old cookie, failed the
    // sessionVersion re-check and bounced the visitor off /compte.
    await register(page, signupEmail);
    await ageSessionCookie(context, baseURL ?? "http://localhost:3100", 10 * 60_000);
    await page.goto(href(locale, "/compte"));

    const form = page.getByTestId("change-password-form");
    await form.locator('input[name="current"]').fill(PASSWORD);
    await form.locator('input[name="next"]').fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: t.password.submitChange }).click();

    await expect(page.getByText(t.password.changed)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/compte")}$`));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
  });

  test(`a session read still in flight cannot sign this device out after a password change (${locale})`, async ({
    page,
    context,
    signupEmail,
    baseURL,
  }) => {
    // The losing interleaving, forced: the page's background session read leaves with
    // the pre-change cookie and is only answered AFTER the password change re-issued
    // this device's cookie. The server rejects that old token; before the fix its
    // answer carried `authjs.session-token=; Max-Age=0` and deleted the NEW cookie
    // (the CI flake in .debug/003). Session reads must write no session cookie.
    await register(page, signupEmail);
    await ageSessionCookie(context, baseURL ?? "http://localhost:3100", 10 * 60_000);

    // The cookie the in-flight read "left with". route.continue() would re-send the
    // held request with the browser's CURRENT cookie, which is not the race: replay
    // it with the old one and hand that late answer back to the browser.
    const name = sessionCookieName(baseURL ?? "http://localhost:3100");
    const oldCookie = (await context.cookies()).find((cookie) => cookie.name === name)?.value;
    expect(oldCookie).toBeTruthy();

    let releaseRead!: () => void;
    const readHeld = new Promise<void>((resolve) => (releaseRead = resolve));
    let heldOne = false;
    await page.route("**/api/auth/session", async (route) => {
      if (heldOne) return route.continue();
      heldOne = true;
      await readHeld;
      const late = await route.fetch({
        headers: { ...route.request().headers(), cookie: `${name}=${oldCookie}` },
      });
      await route.fulfill({ response: late });
    });

    await page.goto(href(locale, "/compte"));
    const form = page.getByTestId("change-password-form");
    await form.locator('input[name="current"]').fill(PASSWORD);
    await form.locator('input[name="next"]').fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: t.password.submitChange }).click();
    await expect(page.getByText(t.password.changed)).toBeVisible();

    const lateRead = page.waitForResponse("**/api/auth/session");
    releaseRead();
    await lateRead;
    await page.unrouteAll({ behavior: "ignoreErrors" });

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
  });

  test(`the delete dialog asks before it acts (${locale})`, async ({ page, signupEmail }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    const open = page.getByTestId("delete-account-open");
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(t.delete.dialogTitle);

    await dialog.getByRole("button", { name: t.delete.cancel }).click();
    await expect(dialog).toBeHidden();
    // Nothing happened: the page is still there.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
  });

  test(`a wrong confirmation deletes nothing (${locale})`, async ({ page, signupEmail }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    await page.getByTestId("delete-account-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="confirmation"]').fill("peut-etre");
    await dialog.getByRole("button", { name: t.delete.confirm }).click();

    await expect(page.getByText(errors.confirmationMismatch)).toBeVisible();
    await page.goto(href(locale, "/compte"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
  });

  test(`deleting the account signs out and closes the door (${locale})`, async ({
    page,
    signupEmail,
  }) => {
    await register(page, signupEmail);
    await page.goto(href(locale, "/compte"));

    await page.getByTestId("delete-account-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="confirmation"]').fill(PASSWORD);
    await dialog.getByRole("button", { name: t.delete.confirm }).click();

    await page.waitForURL(`**/${locale}`);

    // The account is gone: the page is behind the guard again…
    await page.goto(href(locale, "/compte"));
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/connexion")}\\?callbackUrl=`));

    // …and the old credentials no longer open anything.
    await page.getByLabel(auth.fields.email, { exact: true }).fill(signupEmail);
    await page.getByLabel(auth.fields.password, { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: auth.signIn.submit }).click();
    await expect(page.getByTestId("form-error")).toHaveText(errors.invalidCredentials);
  });

  test(`the account page is unreachable anonymously (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/compte"));

    await expect(page).toHaveURL(
      new RegExp(
        `${href(locale, "/connexion")}\\?callbackUrl=${encodeURIComponent(
          href(locale, "/compte"),
        )}$`,
      ),
    );
  });
});
