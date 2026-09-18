import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ClientMessages } from "@/components/i18n/ClientMessages";
import { AuthSeparator, GoogleButton } from "@/components/auth/GoogleButton";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { buildMetadata } from "@/lib/seo/metadata";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";

/**
 * `/fr/inscription` · `/en/sign-up` (§6.2).
 *
 * Anonymous only, `noindex`, and — like the login page — it accepts exactly one
 * query parameter: `?callbackUrl=`, carried into the form as a hidden input and
 * re-sanitised server-side when the action runs.
 *
 * There is no "accept the terms" checkbox: the site sets no third-party cookie,
 * runs no analytics and asks for nothing beyond an address and a password, so a
 * consent checkbox would be ceremony. The privacy page says what is stored and
 * `/compte` is where it is deleted.
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
  const t = await getTranslations({ locale, namespace: "auth.signUp" });
  return buildMetadata({
    locale,
    pathname: "/inscription",
    title: t("metaTitle"),
    description: t("metaDescription"),
    index: false,
  });
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  const callbackUrl = single((await searchParams).callbackUrl);
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <ClientMessages
      locale={locale}
      namespaces={CLIENT_NAMESPACES["app/[locale]/(auth)/inscription/page.tsx"]}
    >
      <div className="mx-auto w-full max-w-sm px-4 py-10">
        <h1 className="font-display text-2xl font-semibold text-ink">{t("signUp.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("signUp.subtitle")}</p>

        <div className="mt-6 space-y-5">
          <SignUpForm locale={locale} callbackUrl={callbackUrl} />
          <AuthSeparator />
          <GoogleButton locale={locale} callbackUrl={callbackUrl} />
        </div>

        <p className="mt-6 text-sm text-ink-muted">
          {t("signUp.haveAccount")}{" "}
          <Link
            href={callbackUrl ? { pathname: "/connexion", query: { callbackUrl } } : "/connexion"}
            className="inline-flex min-h-[var(--tap-min)] items-center font-medium text-accent underline underline-offset-2"
          >
            {t("signUp.signInLink")}
          </Link>
        </p>
      </div>
    </ClientMessages>
  );
}
