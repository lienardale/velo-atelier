import { setRequestLocale } from "next-intl/server";

import { ClientMessages } from "@/components/i18n/ClientMessages";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import type { Locale } from "@/lib/i18n/routing";

/**
 * The shell every `/velo/[id]/**` page shares.
 *
 * It does **nothing that reads the request** — no `auth()`, no `cookies()`, no
 * `headers()`. That is the whole contract of this file (§6.2): a layout that
 * touched a request API would opt every page under it into dynamic rendering,
 * and `/[locale]/velo/demo` has to come out of `next build` prerendered (`●`,
 * §6.8 AC2). The `db` branch's `auth()` call lives inside
 * `loadBikeForRequest`, reached only when the id is a UUID.
 *
 * Wide and flush, unlike the account pages' `max-w-2xl`: the workspace is a
 * viewer plus a 22 rem panel, and on a phone it is a full-height viewer with a
 * bottom sheet — neither wants a reading column.
 */
export default async function BikeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <ClientMessages
        locale={locale}
        namespaces={CLIENT_NAMESPACES["app/[locale]/velo/[id]/layout.tsx"]}
      >
        {children}
      </ClientMessages>
    </div>
  );
}

// No `generateStaticParams` here on purpose. This layout sits on the `[id]`
// segment, so anything it returned would have to enumerate bike ids — and a
// copy of the locale list (the mistake this comment replaces) makes Next treat
// every page under it as having unknown params, which cost `/velo/demo` its
// prerender. The page enumerates `[{ id: "demo" }]`; that is the whole set.
