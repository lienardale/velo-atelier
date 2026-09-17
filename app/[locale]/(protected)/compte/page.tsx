import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { ConfirmWithGoogleForm } from "@/components/account/ConfirmWithGoogleForm";
import { DeleteAccountDialog } from "@/components/account/DeleteAccountDialog";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SetPasswordForm } from "@/components/account/SetPasswordForm";
import { redirectToSignIn, requireSignedInUser } from "@/lib/actions/with-user";
import { hasFreshGoogleAuth } from "@/lib/auth/reauth";
import { prisma } from "@/lib/db/prisma";
import { buildMetadata } from "@/lib/seo/metadata";
import type { Locale } from "@/lib/i18n/routing";

/**
 * `/fr/compte` · `/en/account` (§6.2).
 *
 * Calls `auth()` itself rather than relying on the `(protected)` layout: a
 * layout is not re-run when the visitor moves between its own children, so a
 * check there would be made once and trusted afterwards. The proxy has already
 * redirected anonymous requests; this is the second lock, and the one that holds
 * if the matcher ever changes.
 *
 * One query, three facts: whether the account has a password (which decides
 * between "change" and "set"), whether a Google account is linked (shown as a
 * line of prose, so nobody has to guess how they log in), and how many bikes
 * deletion would take with it.
 */

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return buildMetadata({
    locale,
    pathname: "/compte",
    title: t("metaTitle"),
    description: t("metaDescription"),
    index: false,
  });
}

export default async function AccountPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSignedInUser(locale, "/compte");

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      email: true,
      name: true,
      locale: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
      _count: { select: { bikes: true } },
    },
  });
  // A valid token for a deleted account: clear it rather than loop.
  if (!account) return redirectToSignIn(locale, "/compte");

  const t = await getTranslations({ locale, namespace: "account" });
  const hasPassword = account.passwordHash !== null;
  const hasGoogle = account.accounts.some((entry) => entry.provider === "google");
  const signedInWith = hasPassword && hasGoogle ? "both" : hasGoogle ? "google" : "password";

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("subtitle")}</p>
        <p className="mt-2 text-sm text-ink-muted" data-testid="signed-in-with">
          {t(`signedInWith.${signedInWith}`)}
        </p>
      </header>

      <section aria-labelledby="profile-heading" className="space-y-3">
        <h2 id="profile-heading" className="font-display text-lg font-semibold text-ink">
          {t("profile.title")}
        </h2>
        <p className="text-sm text-ink-muted">{t("profile.description")}</p>
        <ProfileForm email={account.email} name={account.name} locale={account.locale} />
      </section>

      <section aria-labelledby="password-heading" className="space-y-3">
        <h2 id="password-heading" className="font-display text-lg font-semibold text-ink">
          {hasPassword ? t("password.changeTitle") : t("password.setTitle")}
        </h2>
        <p className="text-sm text-ink-muted">
          {hasPassword ? t("password.changeDescription") : t("password.setDescription")}
        </p>
        {hasPassword ? (
          <ChangePasswordForm email={account.email} />
        ) : hasFreshGoogleAuth(user) ? (
          <SetPasswordForm email={account.email} />
        ) : (
          <ConfirmWithGoogleForm />
        )}
      </section>

      <section aria-labelledby="delete-heading" className="space-y-3 border-t border-rule pt-6">
        <h2 id="delete-heading" className="font-display text-lg font-semibold text-danger-fg">
          {t("delete.title")}
        </h2>
        <DeleteAccountDialog hasPassword={hasPassword} bikeCount={account._count.bikes} />
      </section>
    </div>
  );
}
