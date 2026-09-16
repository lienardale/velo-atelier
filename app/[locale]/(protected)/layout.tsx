import { setRequestLocale } from "next-intl/server";

import { routing, type Locale } from "@/lib/i18n/routing";

/**
 * Shell for the signed-in pages (`/compte`, `/mes-velos`, `/import`).
 *
 * It deliberately does **not** call `auth()`. A layout does not re-run when the
 * visitor moves between two of its own children, so a guard here would be
 * checked once and then trusted for the rest of the visit. Each page calls
 * `auth()` for itself (§4.3), and `authorized()` in `auth.config.ts` has already
 * turned an anonymous request into a redirect before any of this renders.
 *
 * What it is for: the one-column container these pages share, and
 * `setRequestLocale` so a page under it can still be statically analysed.
 */
export default async function ProtectedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  return <div className="mx-auto w-full max-w-2xl px-4 py-10">{children}</div>;
}

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}
