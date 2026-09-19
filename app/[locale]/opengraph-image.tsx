import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/lib/i18n/routing";

/**
 * The site's Open Graph card (§6.6) — 1200 × 630 PNG, generated at build time
 * for each locale and used by every page that does not ship its own (today only
 * `/guides/[slug]` does).
 *
 * **Why it is here and not at `app/opengraph-image.tsx`.** The plan puts it at
 * the app root (§1.1, §6.6). Measured on Next 16.3.4, a root-level card reaches
 * exactly one route — Next's own `/_not-found` — and no page of the site:
 * `lib/seo/metadata.ts` gives every page an explicit `openGraph` object, and an
 * explicit `openGraph` in a descendant segment replaces the parent's, images
 * included. `/fr` and `/en` came out of the build with no `og:image` at all,
 * while `/_not-found` (whose metadata declares no `openGraph`) inherited it and
 * warned that it had no `metadataBase` to resolve it against, five times per
 * build. Moving the file into `[locale]` — the segment `page.tsx` lives in, the
 * same arrangement that makes the guide card work — gives the home page the
 * card the plan asks for, and gives it in the visitor's language.
 *
 * An image route inherits no params from the locale layout (verified on 16.3.4
 * by the guide card, which enumerates them itself), so `generateStaticParams`
 * spells out both locales here too.
 *
 * Font: Geist Regular (SIL OFL 1.1, `assets/fonts/OFL.txt`), read from the repo
 * because Satori needs a TTF/OTF and must not fetch anything at build time.
 */
export const alt = "vélo-atelier";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function SiteOpenGraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ImageResponse> {
  const { locale: requested } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const [t, font] = await Promise.all([
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
      <div style={{ display: "flex", fontSize: 32, color: "#1f5f8b" }}>{t("site.name")}</div>
      <div style={{ display: "flex", fontSize: 68, lineHeight: 1.1 }}>{t("site.tagline")}</div>
      <div style={{ display: "flex", fontSize: 28, color: "#5c574f" }}>{t("footer.license")}</div>
    </div>,
    { ...size, fonts: [{ name: "Geist", data: font, style: "normal", weight: 400 }] },
  );
}
