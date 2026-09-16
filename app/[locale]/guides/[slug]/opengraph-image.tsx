import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { GUIDES } from "@/lib/content/collection";
import { findGuide, guideSlugsForLocale } from "@/lib/content/guides";
import { isGuideSlug } from "@/lib/content/schema";
import { routing } from "@/lib/i18n/routing";

/**
 * The Open Graph card of a guide (§6.2): 1200 × 630 PNG, generated at build
 * time for every prerendered guide (static — no request API), Node runtime.
 *
 * Font: Geist Regular (SIL OFL 1.1, `assets/fonts/OFL.txt`), read from the repo
 * because Satori needs a TTF/OTF and must not fetch anything at build time.
 */
export const alt = "vélo-atelier";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Every (locale, slug) pair. An image route handler does not inherit the locale
 * layout's params (verified on Next 16.3.4: `params` arrives empty and a
 * locale-only answer prerendered nothing), so it generates both segments itself.
 */
export function generateStaticParams({
  params,
}: {
  params?: { locale?: string };
}): Array<{ locale: string; slug: string }> {
  const locales = routing.locales.filter((locale) => !params?.locale || params.locale === locale);
  return locales.flatMap((locale) =>
    guideSlugsForLocale(GUIDES, locale).map((slug) => ({ locale, slug })),
  );
}

export default async function GuideOpenGraphImage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<ImageResponse> {
  const { locale: requested, slug } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const guide = isGuideSlug(slug) ? findGuide(GUIDES, slug, locale) : undefined;
  const [t, tc, font] = await Promise.all([
    getTranslations({ locale, namespace: "guides" }),
    getTranslations({ locale, namespace: "common" }),
    readFile(join(process.cwd(), "assets", "fonts", "Geist-Regular.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#f7f4ee",
        color: "#1c1a17",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", fontSize: 32, color: "#1f5f8b" }}>
        {guide ? `${t(`kinds.${guide.kind}`)} · ${t("og.tagline")}` : t("og.tagline")}
      </div>
      <div style={{ display: "flex", fontSize: 72, lineHeight: 1.1 }}>
        {guide ? guide.title : tc("site.name")}
      </div>
      <div style={{ display: "flex", fontSize: 30, color: "#5c574f" }}>{tc("site.name")}</div>
    </div>,
    { ...size, fonts: [{ name: "Geist", data: font, style: "normal", weight: 400 }] },
  );
}
