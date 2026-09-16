import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { GuideLayout } from "@/components/guides/GuideLayout";
import { GuideContent } from "@/components/mdx";
import { GUIDES } from "@/lib/content/collection";
import { findGuide, guideSlugsForLocale, prevNextOf, relatedGuides } from "@/lib/content/guides";
import { isGuideSlug } from "@/lib/content/schema";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

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

/**
 * `/guides/[slug]` — one guide, prerendered for every locale (§6.2). The MDX is
 * rendered here, in the server component tree; only the client leaves reach
 * the browser (§5.2).
 */
export default async function GuidePage({ params }: GuidePageProps): Promise<React.JSX.Element> {
  const resolved = await resolve(params);
  if (!resolved) notFound();
  const { locale, guide } = resolved;
  setRequestLocale(locale);
  const { previous, next } = prevNextOf(GUIDES, guide);

  return (
    <GuideLayout
      guide={guide}
      related={relatedGuides(GUIDES, guide)}
      previous={previous}
      next={next}
    >
      <GuideContent guide={guide} />
    </GuideLayout>
  );
}
