/**
 * `/[locale]/dev/bike3d-perf` — test page for the 3D viewer (§3.5, §3.6 AC7).
 *
 * 404 unless the RUNNING server has `ENABLE_TEST_PAGES=1`: the page is
 * `force-dynamic` and awaits `connection()` before reading the variable, so
 * the value is read per request and never baked into a prerender. The
 * `window.__va` hooks it relies on are a separate, BUILD-time gate
 * (`NEXT_PUBLIC_TEST_HOOKS=1`, see components/bike3d/BikeViewer.tsx).
 *
 * Query (untrusted, whitelisted by lib/bike3d/query.ts): `?preset=`, `?part=`,
 * `?parts=`, `?mode=pick`, `?quality=low|med|high`.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { parseViewerQuery } from "@/lib/bike3d/query";
import { DEMO_PRESET_ID } from "@/lib/domain";
import { routing } from "@/lib/i18n/routing";

import { DevBike3dHarness } from "../bike3d/DevBike3dHarness";
import { testPagesEnabled } from "../bike3d/gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface DevPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DevBike3dPage({
  params,
  searchParams,
}: DevPageProps): Promise<React.JSX.Element> {
  await connection();
  if (!testPagesEnabled()) notFound();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const query = parseViewerQuery(await searchParams);
  const t = await getTranslations({ locale, namespace: "bike3d.dev" });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t("perfTitle")}</h1>
      <p className="text-ink-muted mb-4 text-sm">{t("intro")}</p>
      <DevBike3dHarness
        locale={locale}
        variant="perf"
        initialPreset={query.preset ?? DEMO_PRESET_ID}
        initialPartId={query.part}
        initialPickedIds={query.parts}
        initialMode={query.mode}
        initialQuality={query.quality}
      />
    </div>
  );
}
