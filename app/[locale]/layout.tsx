import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SessionProvider } from "next-auth/react";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Notices } from "@/components/ui-ext/Notices";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/ui-ext/SkipLink";
import { routing } from "@/lib/i18n/routing";

import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/** Both locales are prerendered; any other first segment never reaches here (the proxy prefixes it). */
export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Content may extend under the notch / home indicator; the header, footer
  // and MobileSheet pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  // --color-paper in each scheme (styles/globals.css).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#161412" },
  ],
};

export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common" });
  const siteName = t("site.name");

  return {
    // NEXT_PUBLIC_* is inlined at build time: every canonical / hreflang / OG
    // URL built by lib/seo/metadata.ts is resolved against it.
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: siteName, template: `%s · ${siteName}` },
    description: t("site.description"),
    applicationName: siteName,
    openGraph: { siteName },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

/**
 * The root layout of every page (there is no app/layout.tsx): `<html lang>`,
 * fonts, the next-intl client provider, skip link, header, `<main>`, footer.
 *
 * It reads no request API, so each page under it decides for itself whether it
 * is static. An unknown locale is a 404 here — the proxy already redirects
 * unprefixed paths, so this only guards direct hits on the route.
 */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${inter.variable} ${grotesk.variable}`}>
      <body className="flex min-h-dvh flex-col">
        {/* Inherits locale and messages from lib/i18n/request.ts (next-intl v4). */}
        <NextIntlClientProvider>
          {/*
           * No `session` prop on purpose (W1-T3): passing one would mean calling
           * `auth()` here, and a layout that reads a request API opts every page
           * under it out of static rendering (§6.8 AC2). `AccountMenu` fetches
           * the session from `/api/auth/session` after hydration instead.
           */}
          <SessionProvider>
            <SkipLink />
            <SiteHeader />
            <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex flex-1 flex-col">
              {children}
            </main>
            <SiteFooter />
            {/*
             * Mounted once here because the notices it shows are raised from
             * anywhere: `/velo/local` without a stored bike (§6.7) today, guest
             * import (§6.5) from W3 on. It loads sonner lazily — see Notices.
             */}
            <Notices />
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
