import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Wizard, type WizardGuideRef } from "@/components/checkup/Wizard";
import { ClientMessages } from "@/components/i18n/ClientMessages";
import { GuideContent } from "@/components/mdx";
import { Button } from "@/components/ui/button";
import { firstValue, parsePartIds } from "@/lib/bike3d/query";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import { planCheckup, scopeFromPartIds, toolsFor, type PlannableGuide } from "@/lib/checkup/plan";
import {
  FULL_SCOPE,
  recordedScope,
  savedResumeTarget,
  scopeFacts,
  type OtherPlan,
  type PartsScope,
  type PlannedQuestion,
} from "@/lib/checkup/scope";
import type { CheckStepRef, CheckupScope } from "@/lib/checkup/types";
import { GUIDES } from "@/lib/content/collection";
import { CONTENT_VERSION } from "@/lib/content/generated/version";
import type { GuideDocument } from "@/lib/content/types";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

import type { StoredRun } from "./load";

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
 *
 * ## An unfinished run is resumed where its answers mean what they meant
 *
 * The page plans the scope `?parts=` asks for — unless the bike has an
 * unfinished run that scope does not hold (`lib/checkup/scope.ts`): a full
 * one with answers; or a partial one with an answer the scope does not ask,
 * or asks about other parts than the ones it was given for (one question key
 * is about the rear pads in a rear-caliper checkup and about the front ones
 * in a front-caliper checkup), or asks without the symptom it was given with.
 *
 *   a saved bike   the page reads the run and decides here
 *                  (`savedResumeTarget`). Its row does not say which parts the
 *                  run was opened on; two things can. `?run=` — the run's
 *                  `startedAt`, which the wizard writes beside `?parts=` on
 *                  the page that shows the run — says this address IS the
 *                  run's own, so a reload, Back or Forward keeps it there.
 *                  And the rows, when they tell (`recordedScope`): a row on
 *                  the rear caliper is the rear pads' and nobody else's, and
 *                  the run is then planned HERE on those parts, the wizard
 *                  told (`resumedOwn`) and the address rewritten to them.
 *                  When neither tells — a row on the front caliper is the
 *                  front pads' or both pads', and one written before
 *                  2026-10-22 could be anything's — the page plans the FULL
 *                  checkup, which keeps every answer; the wizard says which
 *                  answers now count for every part their question names,
 *                  and opens on the first of them;
 *   a guest        the run is in `localStorage`, so the page hands the wizard
 *                  what its scope is against the full plan (`scopeFacts`) and
 *                  the wizard decides: it comes back here with `?parts=` the
 *                  run's own parts and `?resume=own`, or with the run's own
 *                  parts and `?resume=full` when the full checkup asks every
 *                  one of its answers about what it was given for — which
 *                  this page then plans, handing the wizard that run's own
 *                  plan (`widenedFrom`) so that it checks it again rather
 *                  than taking the address at its word.
 *
 * Until 2026-10-22 the run was resumed on whatever the page had planned,
 * trimmed to it, and a resumed partial run lost every stored answer
 * (`.debug/017` §5.10); then on any page that asked its questions, and its
 * answers changed sides (§5.12); then a saved bike's carried on as the full
 * checkup whenever the page's parts did not hold it, counting a rear-only
 * answer for the front too, and was held by any page whose parts held its
 * rows' parts, a both-calipers finding narrowed to the front (§5.13).
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
  const saved = ref.kind === "db";
  /**
   * `?resume=` is the wizard coming back for a GUEST's run that the page it
   * was opened on could not hold: `full`, the full checkup, for the run on
   * the parts of `?parts=`; `own`, the parts of `?parts=`, which are the run's
   * own (see the header). It decides nothing about which part an answer
   * counts for: the wizard checks the run against this page either way.
   * A saved bike's page decides from the run's rows and `?run=`.
   */
  const resume = saved ? undefined : firstValue(query.resume);
  const resumeWidened = resume === "full";
  const requested = resumeWidened ? FULL_SCOPE : scopeFromPartIds(requestedPartIds);
  /**
   * §6.7: `?parts=` naming nothing this bike has falls back to a FULL checkup
   * — and says so. Silently widening the scope is the failure mode worth
   * naming: the visitor asked about their brakes and got a twelve-question
   * checkup with no explanation.
   */
  const scopeDropped = !resumeWidened && query.parts !== undefined && requestedPartIds.length === 0;
  const documents = GUIDES.filter((guide) => guide.locale === resolvedLocale);
  const build = bike.build;
  const planFor = (scope: CheckupScope): CheckStepRef[] =>
    planCheckup(build, scope, documents as unknown as PlannableGuide[]);
  let fullPlan: CheckStepRef[] | null = null;
  const full = (): CheckStepRef[] => (fullPlan ??= planFor(FULL_SCOPE));
  const otherPlan = (scope: PartsScope): OtherPlan & { steps: CheckStepRef[] } => {
    const planned = planFor(scope);
    return { scope, steps: planned, facts: scopeFacts(scope, full(), planned) };
  };

  const run = await storedFor(ref, bike.bikeId, resolvedLocale);
  const initialStored = run?.checkup ?? null;
  let scope = requested;
  let steps = planFor(requested);
  // A saved bike's unfinished run, read above (see the header): resumed on
  // the requested scope only if that scope holds it as its own parts did —
  // by `?run=`, or by what the rows tell — otherwise on those parts, or on the
  // full checkup when nothing tells them (`.debug/017` §5.13).
  let widened = resumeWidened;
  let resumedOwn = resume === "own";
  if (run !== null && run.checkup.completedAt === undefined) {
    const answers = {
      answers: run.checkup.answers,
      symptoms: run.checkup.symptoms,
      recordedFor: run.recordedFor,
    };
    const recorded = recordedScope(answers, full(), planFor);
    const target = savedResumeTarget(
      { ...answers, scope: run.checkup.scope },
      requested,
      steps,
      scopeFacts(requested, full(), steps),
      {
        ownAddress: firstValue(query.run) === String(Date.parse(run.checkup.startedAt)),
        recorded: recorded === null ? null : otherPlan(recorded),
      },
    );
    if (target.kind === "full") {
      scope = FULL_SCOPE;
      steps = full();
      widened = requested.kind === "parts";
    } else if (target.kind === "own") {
      scope = target.scope;
      steps = planFor(target.scope);
      resumedOwn = true;
    }
  }
  // A guest's run, brought to the full checkup for the parts of `?parts=`:
  // what those parts are against it, for the wizard to check again.
  const widenedFrom =
    resumeWidened && requestedPartIds.length > 0
      ? otherPlan({ kind: "parts", partIds: requestedPartIds })
      : null;

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

  // Its own provider: the wizard reads `checkup`, `tools`, `guides` and `parts`,
  // which the rest of the segment does not (lib/i18n/client-namespaces.ts). The
  // two empty states above render no client component that reads a message, so
  // the layout's provider is all they need.
  return (
    <ClientMessages
      locale={resolvedLocale as Locale}
      namespaces={CLIENT_NAMESPACES["app/[locale]/velo/[id]/controle/page.tsx"]}
    >
      <Wizard
        locale={resolvedLocale as Locale}
        bikeRef={ref}
        bikeParam={bike.param}
        scope={scope}
        scopeDropped={scopeDropped}
        resumeWidened={widened}
        resumedOwn={resumedOwn}
        steps={steps}
        // With a parts scope, what this scope is against the full plan: a
        // guest's run is read in the browser, which decides whether this scope
        // holds it — by the same rule as above, a dropped question deciding
        // nothing — and the wizard keeps, unacted on, an answer to a question
        // this scope only touches (`lib/checkup/scope.ts`).
        {...(scope.kind === "parts" ? { scopeFacts: scopeFacts(scope, full(), steps) } : {})}
        {...(widenedFrom === null
          ? {}
          : {
              widenedFrom: {
                scope: widenedFrom.scope,
                steps: widenedFrom.steps.map(compactQuestion),
                facts: widenedFrom.facts,
              },
            })}
        guideNodes={guideNodes}
        guideRefs={guideRefsFor(steps, bySlug)}
        tools={toolsFor(steps)}
        contentVersion={CONTENT_VERSION}
        newCheckupId={crypto.randomUUID()}
        initialStored={initialStored}
        initialStepKey={firstValue(query.step) ?? null}
        specCode={specCode ?? null}
      />
    </ClientMessages>
  );
}

/** What the wizard needs of a plan it does not show: no title, no prompt, no tool. */
function compactQuestion(step: CheckStepRef): PlannedQuestion {
  return {
    key: step.key,
    partIds: step.partIds,
    ...(step.coveredParts === undefined ? {} : { coveredParts: step.coveredParts }),
  };
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
): Promise<StoredRun | null> {
  if (ref.kind !== "db" || bikeId === null) return null;
  const { currentUser } = await import("@/lib/actions/with-user");
  const user = await currentUser();
  if (user === null) return null;
  // With the part each row is recorded against: what tells which parts the
  // run was about (`recordedScope`, `savedResumeTarget`). The same single query.
  const { loadStoredCheckupRun } = await import("./load");
  return loadStoredCheckupRun(bikeId, user.id, locale);
}
