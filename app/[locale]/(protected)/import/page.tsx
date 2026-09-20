import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { requireSignedInUser } from "@/lib/actions/with-user";
import { buildMetadata } from "@/lib/seo/metadata";
import type { Locale } from "@/lib/i18n/routing";

import { GuestImport } from "./GuestImport";

/**
 * `/fr/import` · `/en/import` — the page that moves a guest's work into their
 * account (§6.2).
 *
 * `auth()` here rather than in the `(protected)` layout, exactly as `/compte`
 * and `/mes-velos` do it (§4.3, §4.4): a layout is not re-run when the visitor
 * moves between two of its own children, so a guard there would be checked once
 * and then trusted. Three locks in all — `authorized()` in `proxy.ts`
 * (`/import` is in `PROTECTED_KEYS`), `requireSignedInUser` here, and
 * `withUser()` inside `importGuestStateAction`, which is the only thing on this
 * page that touches data.
 *
 * The work itself is `<GuestImport/>`, a client component: everything it reads
 * lives in `localStorage`, which the server cannot see. Keeping the page on the
 * server is what lets the route carry `generateMetadata` — a private page is
 * `robots: noindex` (§6.6), and `app/robots.ts` (W3-T4) disallows it by name as
 * well.
 */

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return buildMetadata({
    locale,
    pathname: "/import",
    title: t("import.metaTitle"),
    description: t("import.metaDescription"),
    index: false,
  });
}

export default async function ImportPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireSignedInUser(locale, "/import");

  return <GuestImport />;
}
