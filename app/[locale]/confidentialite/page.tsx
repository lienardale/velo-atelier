import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { LegalContent } from "@/components/mdx/LegalContent";
import { LEGAL } from "@/lib/content/collection";
import { findLegal, legalUpdatedAt } from "@/lib/content/legal";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const HEADING_ID = "privacy-title";

/** `confidentialite.<locale>.mdx`, or `null` when the locale is not ours. */
async function resolve(params: PageProps["params"]) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return null;
  const document = findLegal(LEGAL, "confidentialite", locale);
  return document ? { locale, document } : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await resolve(params);
  if (!resolved) return {};
  const { locale, document } = resolved;
  return buildMetadata({
    locale,
    pathname: "/confidentialite",
    title: document.title,
    description: document.summary,
  });
}

/**
 * `/fr/confidentialite` · `/en/privacy` (§6.6) — what the site stores, why, and
 * how to get rid of it, from `content/legal/confidentialite.<locale>.mdx`.
 *
 * The twin of `mentions-legales/page.tsx`: same shape, different document. Both
 * are static (`setRequestLocale`, no request API) and both are indexable — a
 * privacy policy nobody can find is not one.
 */
export default async function PrivacyPage({ params }: PageProps): Promise<React.JSX.Element> {
  const resolved = await resolve(params);
  if (!resolved) notFound();
  const { locale, document } = resolved;
  setRequestLocale(locale);

  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: "seo" }),
    getFormatter({ locale }),
  ]);

  return (
    <LegalContent
      document={document}
      headingId={HEADING_ID}
      updatedLabel={t("legal.updated", {
        date: format.dateTime(legalUpdatedAt(document), { dateStyle: "long", timeZone: "UTC" }),
      })}
    />
  );
}
