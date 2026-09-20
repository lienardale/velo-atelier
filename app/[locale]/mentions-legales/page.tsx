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

const HEADING_ID = "legal-notice-title";

/** `mentions.<locale>.mdx`, or `null` when the locale is not ours. */
async function resolve(params: PageProps["params"]) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return null;
  const document = findLegal(LEGAL, "mentions", locale);
  return document ? { locale, document } : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await resolve(params);
  if (!resolved) return {};
  const { locale, document } = resolved;
  return buildMetadata({
    locale,
    pathname: "/mentions-legales",
    title: document.title,
    description: document.summary,
  });
}

/**
 * `/fr/mentions-legales` · `/en/legal` (§6.6) — the publisher, the hosts and the
 * licences, from `content/legal/mentions.<locale>.mdx`.
 *
 * Static: `setRequestLocale` and no request API, so the page is prerendered for
 * both locales like `/guides` (§6.8 AC2). Indexable — a legal notice is meant
 * to be found, and `app/sitemap.ts` lists it.
 *
 * A missing document is a 404 rather than an empty page: the file is part of
 * the repository, so its absence is a build mistake, and a blank legal notice
 * is worse than no legal notice.
 */
export default async function LegalNoticePage({ params }: PageProps): Promise<React.JSX.Element> {
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
