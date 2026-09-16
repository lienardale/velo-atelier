import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthSeparator, GoogleButton } from "@/components/auth/GoogleButton";
import { SignInForm } from "@/components/auth/SignInForm";
import { authErrorMessageKey } from "@/lib/auth/errors";
import { buildMetadata } from "@/lib/seo/metadata";
import { Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
import { DEMO_USER } from "@/prisma/seed-data";

/**
 * `/fr/connexion` · `/en/sign-in` (§6.2).
 *
 * Anonymous only — a signed-in visitor never reaches it, because `authorized()`
 * in `auth.config.ts` redirects them to their bikes before the page renders.
 *
 * Three query parameters arrive here, all of them attacker-controlled and all of
 * them handled as data, not instructions:
 *
 *   `?callbackUrl=`  put in a hidden input, re-sanitised server-side by
 *                    `safeCallbackUrl()` when the action runs;
 *   `?error=`        an Auth.js error **type** — looked up in a fixed map
 *                    (`authErrorMessageKey`), never rendered;
 *   `?email=`        not accepted at all, deliberately: pre-filling an address
 *                    from a link is a phishing affordance.
 *
 * `noindex` (§6.6): there is nothing here for a search engine, and an indexed
 * login page with a `callbackUrl` in it is a redirect gadget waiting to happen.
 */

interface PageProps {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamicParams = false;

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signIn" });
  return buildMetadata({
    locale,
    pathname: "/connexion",
    title: t("metaTitle"),
    description: t("metaDescription"),
    index: false,
  });
}

/** The first value of a repeated query parameter, or `undefined`. */
function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });
  const tRoot = await getTranslations({ locale });

  const errorKey = authErrorMessageKey(single(query.error));
  const callbackUrl = single(query.callbackUrl);

  // `.env.example` and the Playwright web server set this; `lib/env.ts` refuses
  // to boot a production server that has it.
  const demo =
    process.env.NEXT_PUBLIC_DEMO_LOGIN === "1"
      ? { email: DEMO_USER.email, password: DEMO_USER.password }
      : undefined;

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">{t("signIn.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("signIn.subtitle")}</p>

      {errorKey ? (
        <p
          role="alert"
          data-testid="auth-error"
          className="mt-4 rounded-md bg-paper-2 p-3 text-sm text-danger-fg"
        >
          {/* A key from a fixed map, resolved with the root translator. */}
          {(tRoot as unknown as (key: string) => string)(errorKey)}
        </p>
      ) : null}

      <div className="mt-6 space-y-5">
        <SignInForm locale={locale} callbackUrl={callbackUrl} demo={demo} />
        <AuthSeparator />
        <GoogleButton locale={locale} callbackUrl={callbackUrl} />
      </div>

      <p className="mt-6 text-sm text-ink-muted">
        {t("signIn.noAccount")}{" "}
        <Link
          href={callbackUrl ? { pathname: "/inscription", query: { callbackUrl } } : "/inscription"}
          className="inline-flex min-h-[var(--tap-min)] items-center font-medium text-accent underline underline-offset-2"
        >
          {t("signIn.signUpLink")}
        </Link>
      </p>
    </div>
  );
}
