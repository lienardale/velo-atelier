import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ClientMessages } from "@/components/i18n/ClientMessages";
import { GuideLayout } from "@/components/guides/GuideLayout";
import { GuideContent } from "@/components/mdx";
import { JsonLd, techArticle } from "@/components/seo/JsonLd";
import { REPOSITORY_URL } from "@/components/layout/SiteFooter";
import { GUIDES } from "@/lib/content/collection";
import { findGuide, guideSlugsForLocale, prevNextOf, relatedGuides } from "@/lib/content/guides";
import { isGuideSlug } from "@/lib/content/schema";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { getPathname } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata, siteUrl } from "@/lib/seo/metadata";

interface GuidePageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/** Only the guides that exist are built; anything else is a 404 (no runtime rendering). */
export const dynamicParams = false;

export function generateStaticParams({
  params,
}: {
  params: { locale: string };
}): Array<{ slug: string }> {
  if (!hasLocale(routing.locales, params.locale)) return [];
  return guideSlugsForLocale(GUIDES, params.locale).map((slug) => ({ slug }));
}

async function resolve(params: GuidePageProps["params"]) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale) || !isGuideSlug(slug)) return null;
  const guide = findGuide(GUIDES, slug, locale);
  return guide ? { locale, guide } : null;
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const resolved = await resolve(params);
  if (!resolved) return {};
  const { locale, guide } = resolved;
  return buildMetadata({
    locale,
    pathname: { pathname: "/guides/[slug]", params: { slug: guide.slug } },
    title: guide.title,
    description: guide.summary,
    // Stubs are published for readers but kept out of search results (§5.7).
    index: guide.status === "full",
  });
}

/** `difficulty` (1 | 2 | 3) as schema.org's `proficiencyLevel` vocabulary. */
const PROFICIENCY = { 1: "Beginner", 2: "Intermediate", 3: "Expert" } as const;

/**
 * `/guides/[slug]` — one guide, prerendered for every locale (§6.2). The MDX is
 * rendered here, in the server component tree; only the client leaves reach
 * the browser (§5.2).
 *
 * The page also carries its `TechArticle` structured data (§6.8 AC10). It is
 * emitted for stubs too: `generateMetadata` keeps them out of the index and
 * `app/sitemap.ts` out of the crawl, which is where that decision belongs —
 * the JSON-LD only describes what the document *is*.
 */
export default async function GuidePage({ params }: GuidePageProps): Promise<React.JSX.Element> {
  const resolved = await resolve(params);
  if (!resolved) notFound();
  const { locale, guide } = resolved;
  setRequestLocale(locale);
  const { previous, next } = prevNextOf(GUIDES, guide);
  const tc = await getTranslations({ locale, namespace: "common" });

  return (
    <ClientMessages
      locale={locale}
      namespaces={CLIENT_NAMESPACES["app/[locale]/guides/[slug]/page.tsx"]}
    >
      <JsonLd
        data={techArticle({
          headline: guide.title,
          description: guide.summary,
          url: `${siteUrl()}${getPathname({ href: { pathname: "/guides/[slug]", params: { slug: guide.slug } }, locale })}`,
          inLanguage: locale,
          publisherName: tc("site.name"),
          publisherUrl: REPOSITORY_URL,
          totalTimeMinutes: guide.minutes,
          proficiencyLevel: PROFICIENCY[guide.difficulty],
        })}
      />
      <GuideLayout
        guide={guide}
        related={relatedGuides(GUIDES, guide)}
        previous={previous}
        next={next}
      >
        <GuideContent guide={guide} />
      </GuideLayout>
    </ClientMessages>
  );
}
