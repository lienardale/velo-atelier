# Manual QA — "Continue with Google"

Google is the only OAuth provider vélo-atelier accepts, and it is the one path
**no automated test drives**. Playwright asserts that the button exists
(`[data-provider=google]`) and never clicks it; the unit and security tiers
exercise the `signIn` callback with synthetic profiles. Everything between the
button and the callback — the consent screen, the redirect URI, the token
exchange — is Google's, and can only be checked by a person with a real account.

Run this checklist **on production** after any change to `auth.config.ts`,
`auth.ts`, `proxy.ts`, the Google console configuration, or the production
domain. It takes about ten minutes.

---

## Why Google is not automated

`allowDangerousEmailAccountLinking: true` is set on the provider, so a Google
sign-in attaches to an existing password account with the same address instead
of creating a duplicate the visitor cannot reach. The flag is only safe because
the `signIn` callback refuses any profile without `email_verified === true`
(`tests/security/oauth-linking.test.ts` covers that predicate exhaustively).

Automating the rest would mean either scripting a real Google account through a
consent screen — which Google detects and blocks, and which would put a real
credential in CI — or standing up a fake OIDC provider, which would test the
fake rather than Google. Neither buys anything the checklist below does not.

Preview deployments have **no** Google credentials (`AUTH_GOOGLE_ID` /
`AUTH_GOOGLE_SECRET` are production-only, §4.6), so the credentials form is the
sign-in path there. That is deliberate: a preview URL changes on every
deployment and could never be a registered redirect URI.

---

## Before you start

| Thing                               | Where                                                |
| ----------------------------------- | ---------------------------------------------------- |
| Production URL                      | `https://<prod-domain>`                              |
| Redirect URI registered with Google | `https://<prod-domain>/api/auth/callback/google`     |
| Google console                      | APIs & Services → Credentials → OAuth 2.0 Client IDs |
| Vercel env (Production scope only)  | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL`   |

You need two Google accounts, or one Google account and one password account on
the site:

- **G1** — a normal Google account with a verified address.
- **P1** — a vélo-atelier account created with e-mail + password, on an address
  you can also use with Google.

---

## 1. First sign-in with Google (new account)

1. Sign out completely; clear cookies for the production domain.
2. Go to `https://<prod-domain>/fr/connexion`.
3. Click **Continuer avec Google**.
4. Choose **G1** on Google's screen and accept.

Expected:

- [ ] You land on `/fr/mes-velos` (not on `/connexion`, not on an unprefixed
      `/mes-velos`).
- [ ] The header shows the account menu with G1's name.
- [ ] `/fr/compte` says **« Connexion avec Google. »** and offers _Définir un mot
      de passe_ (not _Changer de mot de passe_).
- [ ] In the database: one `User` row for G1's address, `passwordHash` NULL,
      `emailVerified` **set** (written by the `linkAccount` event), `locale` =
      `fr`.

## 2. The locale survives the round trip

1. Sign out. Switch the site to English (`/en`).
2. From `/en/sign-in`, click **Continue with Google** and sign in as G1.

Expected:

- [ ] You land on `/en/my-bikes`, in English.
- [ ] The `NEXT_LOCALE` cookie is `en` (it is written by `googleSignInAction`
      _before_ the redirect, which is the only reason the callback can know).

## 3. Linking Google to an existing password account

1. Sign out. Create (or reuse) **P1** with e-mail + password on the address G1
   also owns.
2. Sign out, then sign in with **Continue with Google** as that same address.

Expected:

- [ ] You land on the **same** account: `/fr/compte` shows the name P1 had, and
      `/fr/mes-velos` lists P1's bikes.
- [ ] `/fr/compte` now says **« Connexion par e-mail et mot de passe, ou avec
      Google. »**
- [ ] There is still exactly **one** `User` row for that address, now with a
      linked `Account` row (`provider = 'google'`), and `emailVerified` set.
- [ ] The original password still signs in.

## 4. Unverified address is refused

This is the control that makes step 3 safe. A Workspace account whose address
Google has not verified (or a test account configured that way) is the only way
to see it for real.

1. Sign out. Click **Continuer avec Google** and pick the unverified account.

Expected:

- [ ] You land on `/fr/connexion?error=OAuthAccountNotLinked` — **localized**,
      not a bare `/connexion`.
- [ ] The page shows _« Ce compte Google ne peut pas être relié : son adresse
      e-mail n'est pas vérifiée par Google. »_
- [ ] **No** `User` row and **no** `Account` row was created.
- [ ] Repeating it with `NEXT_LOCALE=en` lands on `/en/sign-in?error=OAuthAccountNotLinked`
      with the English sentence.

If you have no unverified account to hand, the predicate itself is covered by
`tests/security/oauth-linking.test.ts`; note in the PR that step 4 was not
exercised live.

## 5. Cancelling, and errors from Google

1. Click **Continuer avec Google**, then press **Back** / _Cancel_ on Google's
   screen.

Expected:

- [ ] You come back to a **localized** login page (`/fr/connexion?error=…`),
      never to a bare `/connexion` and never to Auth.js's own error page.
- [ ] The message is one of ours (`errors.accessDenied` or `errors.oauthFailed`),
      not a stack trace and not the raw `?error=` value.

## 6. Sign-out

1. Signed in through Google, open the account menu and click **Se déconnecter**.

Expected:

- [ ] You land on `/fr` (or `/en`).
- [ ] The `authjs.session-token` cookie (`__Secure-authjs.session-token` on
      https) is gone.
- [ ] `/fr/mes-velos` redirects to `/fr/connexion?callbackUrl=%2Ffr%2Fmes-velos`.

## 7. Deleting a Google-only account

1. Sign in as G1, go to `/fr/compte`, open **Supprimer mon compte**.

Expected:

- [ ] The confirmation asks for the word **SUPPRIMER** (not a password — there
      is none).
- [ ] After confirming you land on `/fr`, signed out.
- [ ] The `User` row and its `Account` row are both gone (the cascade).
- [ ] Signing in with Google again creates a **new**, empty account.

---

## If something fails

| Symptom                                    | Look at                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch` on Google's screen | the registered URI vs `AUTH_URL`; they must agree exactly, scheme and host included                                                      |
| Lands on a bare `/connexion`               | `localizeUnprefixedAuthPath` in `lib/auth/unprefixed-paths.ts`, and the proxy matcher in `proxy.ts`                                      |
| Lands on Auth.js's own error page          | a callback returned `false` somewhere — `authorized()` and `signIn` must return `true` or a URL (`tests/unit/auth/error-locale.test.ts`) |
| Two accounts for one address               | `allowDangerousEmailAccountLinking` was turned off, or the adapter is not wired                                                          |
| `Configuration` error                      | `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` missing in the Production scope                                                                  |

Record the run in the PR description: date, prod URL, which steps passed, and
any step you could not exercise.
