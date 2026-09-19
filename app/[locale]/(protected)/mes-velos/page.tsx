import { Bike } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BikeCard } from "@/components/account/BikeCard";
import { GuestBanner } from "@/components/auth/GuestBanner";
import { Button } from "@/components/ui/button";
import { currentUser, redirectToSignIn } from "@/lib/actions/with-user";
import { describeDetails } from "@/lib/bike/describe";
import { deriveBike } from "@/lib/bike/rules";
import { prisma } from "@/lib/db/prisma";
import type { Answers } from "@/lib/domain/schema/decision";
import { Link } from "@/lib/i18n/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import type { Locale } from "@/lib/i18n/routing";

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "bike.myBikes" });
  return buildMetadata({
    locale,
    pathname: "/mes-velos",
    title: t("metaTitle"),
    description: t("metaDescription"),
    index: false,
  });
}

/**
 * `/fr/mes-velos` · `/en/my-bikes` — the garage (§6.2).
 *
 * `auth()` here rather than in the `(protected)` layout: a layout does not
 * re-run when the visitor moves between two of its own children, so a guard
 * there would be checked once and then trusted (§4.3). `requireSignedInUser`
 * is what makes an expired-but-still-present cookie go through
 * `/api/session-expired` instead of looping on the sign-in page.
 *
 * The summary under each name is `describeDetails(spec)` — the decision tree's
 * own words, so a bike is described in the vocabulary its owner answered in,
 * and a new option is described the day its label is written.
 *
 * Empty state (§6.7): an icon, one sentence and the CTA that fills it —
 * describing a bike takes two minutes and is the only thing to do here.
 */
export default async function MyBikesPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) return redirectToSignIn(locale, "/mes-velos");

  const t = await getTranslations({ locale, namespace: "bike.myBikes" });

  const rows = await prisma.bike.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, answers: true, updatedAt: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-ink text-2xl font-semibold">{t("title")}</h1>
        <Button asChild className="min-h-[var(--tap-min)]">
          <Link href="/" data-testid="add-bike">
            {t("add")}
          </Link>
        </Button>
      </header>

      {/*
       * The one entry point to `/import` (W3-T3): a guest bike lives in this
       * browser's `localStorage`, which the server cannot see, so the invitation
       * to import it can only be raised on the client. It renders nothing when
       * there is nothing stored.
       */}
      <GuestBanner />

      {rows.length === 0 ? (
        <section
          className="border-rule flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center"
          data-testid="my-bikes-empty"
        >
          <Bike aria-hidden="true" className="text-ink-muted size-10" />
          <p className="text-ink font-medium">{t("emptyTitle")}</p>
          <p className="text-ink-muted text-sm">{t("emptyHelp")}</p>
          <Button asChild className="min-h-[var(--tap-min)]">
            <Link href="/" data-testid="my-bikes-empty-cta">
              {t("emptyCta")}
            </Link>
          </Button>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="my-bikes-list">
          {rows.map((row) => (
            <li key={row.id}>
              <BikeCard
                id={row.id}
                name={row.name}
                summary={summaryOf(row.answers, locale)}
                updatedAt={row.updatedAt.toISOString()}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The first three answers of the tree, in the visitor's language. */
function summaryOf(answers: unknown, locale: Locale): string {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return "";
  const { spec } = deriveBike(answers as Answers);
  return describeDetails(spec, locale).slice(0, 3).join(" · ");
}
