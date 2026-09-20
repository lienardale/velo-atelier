import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Wizard, type WizardGuideRef } from "@/components/checkup/Wizard";
import { GuideContent } from "@/components/mdx";
import { Button } from "@/components/ui/button";
import { firstValue, parsePartIds } from "@/lib/bike3d/query";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import { planCheckup, scopeFromPartIds, toolsFor, type PlannableGuide } from "@/lib/checkup/plan";
import type { StoredCheckup } from "@/lib/checkup/storage";
import { GUIDES } from "@/lib/content/collection";
import { CONTENT_VERSION } from "@/lib/content/generated/version";
import type { GuideDocument } from "@/lib/content/types";
import { Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface CheckupPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CheckupPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "checkup" });
  return buildMetadata({
    locale,
    pathname: { pathname: "/velo/[id]/controle", params: { id } },
    title: t("metaTitle"),
    description: t("metaDescription"),
    // A checkup is about one person's bike (§6.6).
    index: false,
  });
}

/**
 * `/velo/[id]/controle` · `/bike/[id]/checkup` — the checkup (§5.4, §6.5).
 *
 * ## What the server decides
 *
 * The plan, and nothing else. `planCheckup(build, scope, guides)` turns the
 * bike and `?parts=` into an ordered list of questions, and the client sends
 * back a step KEY — never a step (§4.4). Recomputing it here on every request
 * is what makes that safe, and it is also what makes a corpus that grew a
 * question show up for a visitor who is halfway through one.
 *
 * ## The guide trees travel as nodes
 *
 * Each planned guide is rendered ONCE, here, in an RSC
 * (`guideNodes: Record<slug, ReactNode>`, §5.2), and the wizard shows one step
 * of one of them by changing `<StepScope activeStepId>`. The compiled MDX is
 * evaluated on the server and never in the browser, which is what keeps the
 * static CSP of §1.3 (`no unsafe-eval`, no nonce) true on this route.
 *
 * ## The three bikes
 *
 *   demo   the preset — nothing here reads the request for it;
 *   local  the server cannot see `localStorage`, so the spec arrives in
 *          `?spec=` (§5.4); without it, the page says so instead of guessing;
 *   uuid   the owner is checked inside the query, and the stored checkup is
 *          read here so the wizard does not have to flash an empty one.
 */
export default async function CheckupPage({
  params,
  searchParams,
}: CheckupPageProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const resolvedLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  setRequestLocale(resolvedLocale);

  const ref = resolveBikeRef(id);
  const query = await searchParams;
  const specCode = firstValue(query.spec);
  const bike = await loadBikeForRequest(ref, { specCode });
  const t = await getTranslations({ locale: resolvedLocale, namespace: "checkup" });

  if (bike.build === null) {
    return (
      <Shell title={t("title")}>
        <p className="text-ink-muted">{t("needsBike")}</p>
        <Button asChild className="tap-target">
          <Link
            href={{ pathname: "/velo/[id]", params: { id: bike.param } }}
            data-testid="checkup-back-to-bike"
          >
            {t("openBike")}
          </Link>
        </Button>
      </Shell>
    );
  }

  const requestedPartIds = parsePartIds(query.parts);
  const scope = scopeFromPartIds(requestedPartIds);
  /**
   * §6.7: `?parts=` naming nothing this bike has falls back to a FULL checkup
   * — and says so. Silently widening the scope is the failure mode worth
   * naming: the visitor asked about their brakes and got a twelve-question
   * checkup with no explanation.
   */
  const scopeDropped = query.parts !== undefined && requestedPartIds.length === 0;
  const documents = GUIDES.filter((guide) => guide.locale === resolvedLocale);
  const steps = planCheckup(bike.build, scope, documents as unknown as PlannableGuide[]);

  if (steps.length === 0) {
    return (
      <Shell title={t("emptyTitle")}>
        <p className="text-ink-muted">{t("emptyBody")}</p>
        <Button asChild className="tap-target">
          <Link
            href={{
              pathname: "/velo/[id]/controle",
              params: { id: bike.param },
              ...(specCode === undefined ? {} : { query: { spec: specCode } }),
            }}
            data-testid="checkup-full-cta"
          >
            {t("emptyCta")}
          </Link>
        </Button>
      </Shell>
    );
  }

  const bySlug = new Map(documents.map((document) => [document.slug, document]));
  const guideNodes: Record<string, React.ReactNode> = {};
  for (const slug of new Set(steps.map((step) => step.guideSlug))) {
    const document = bySlug.get(slug);
    // eslint-disable-next-line security/detect-object-injection -- `slug` comes from the plan, and the object is a fresh literal
    if (document !== undefined) guideNodes[slug] = <GuideContent guide={document} />;
  }

  return (
    <Wizard
      locale={resolvedLocale as Locale}
      bikeRef={ref}
      bikeParam={bike.param}
      scope={scope}
      scopeDropped={scopeDropped}
      steps={steps}
      guideNodes={guideNodes}
      guideRefs={guideRefsFor(steps, bySlug)}
      tools={toolsFor(steps)}
      contentVersion={CONTENT_VERSION}
      newCheckupId={crypto.randomUUID()}
      initialStored={await storedFor(ref, bike.bikeId, resolvedLocale)}
      initialStepKey={firstValue(query.step) ?? null}
      specCode={specCode ?? null}
    />
  );
}

/** The header the two empty states share. */
function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 py-12">
      <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
      {children}
    </section>
  );
}

/**
 * Titles and stub flags for every guide the wizard can link to: the planned
 * ones, and the ones a symptom names as the way to fix it.
 */
function guideRefsFor(
  steps: readonly { guideSlug: string; ko: readonly { guideSlug?: string }[] }[],
  bySlug: ReadonlyMap<string, GuideDocument>,
): Record<string, WizardGuideRef> {
  const slugs = new Set<string>();
  for (const step of steps) {
    slugs.add(step.guideSlug);
    for (const consequence of step.ko) {
      if (consequence.guideSlug !== undefined) slugs.add(consequence.guideSlug);
    }
  }
  const refs: Record<string, WizardGuideRef> = {};
  for (const slug of slugs) {
    const document = bySlug.get(slug);
    if (document === undefined) continue;
    // eslint-disable-next-line security/detect-object-injection -- `slug` comes from the plan, and the object is a fresh literal
    refs[slug] = { title: document.title, stub: document.status === "stub" };
  }
  return refs;
}

/**
 * The stored checkup of a SAVED bike, read here so the wizard renders it on
 * first paint instead of flashing an empty one. A guest bike's copy lives in
 * `localStorage` and can only be read after hydration.
 *
 * Through `./load`, NOT through `loadCheckupAction`: a document GET carries no
 * `Origin` header and `withUser` refuses it (`lib/security/origin.ts`), so the
 * action would answer `FORBIDDEN` here and the wizard would start every reload
 * from nothing — minting a fresh `startedAt` and, with it, a second `Checkup`
 * row. That is the whole reason `load.ts` exists (CLAUDE.md), and
 * `tests/security/checkup-input.test.ts` pins both halves.
 *
 * The imports are dynamic so `server-only` and the Prisma client stay out of
 * the module graph of the `demo` and `local` branches, which reach neither.
 */
async function storedFor(
  ref: ReturnType<typeof resolveBikeRef>,
  bikeId: string | null,
  locale: Locale,
): Promise<StoredCheckup | null> {
  if (ref.kind !== "db" || bikeId === null) return null;
  const { currentUser } = await import("@/lib/actions/with-user");
  const user = await currentUser();
  if (user === null) return null;
  const { loadStoredCheckup } = await import("./load");
  return loadStoredCheckup(bikeId, user.id, locale);
}
