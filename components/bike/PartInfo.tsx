"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { PartStatusValue } from "@/lib/bike/load-bike";
import { partActionGuides, PART_ACTION_KINDS, type GuideRef } from "@/lib/bike/queries";
import type { BikeRepo } from "@/lib/bike/repo";
import { partDefinition } from "@/lib/domain/data/parts";
import { isAttributePresent } from "@/lib/domain/engine/parts-for-spec";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

import { PartEditForm } from "./PartEditForm";

/**
 * The "Infos" tab (§6.4): what this part is, what state it is in, what it is
 * made of, and the three things you can do to it.
 *
 * The guide links are the interesting part. "Changer / Nettoyer / Régler"
 * resolve through `partActionGuides`, so a tubeless gravel bike is offered
 * `replace-tire-tubeless` and a tubed road bike `replace-tube-tire` from the
 * same row — the panel never shows a procedure that does not apply to the bike
 * in front of it (§6.8 AC11 opens all three and asserts they answer 200).
 *
 * On the demo bike the edit form is replaced by "Modifier ce vélo → copie
 * locale" (§6.4): the demo is shared, so the first edit forks it into the
 * visitor's own guest bike instead of changing what everyone else sees.
 */
export interface PartInfoProps {
  build: BikeBuild;
  partId: string | null;
  repo: BikeRepo;
  guides: readonly GuideRef[];
  statuses?: Partial<Record<string, PartStatusValue>>;
  /** `[id]` of the bike, for the deep link and the guide "on my bike" links. */
  bikeParam: string;
  /** `?spec=` to carry on links out of a `local` bike (§5.4). */
  specCode?: string | null;
  onSaved?: (build: BikeBuild) => void;
  /** The demo bike's "fork to a local copy" CTA. */
  onFork?: () => void;
  className?: string;
}

export function PartInfo({
  build,
  partId,
  repo,
  guides,
  statuses,
  bikeParam,
  specCode,
  onSaved,
  onFork,
  className,
}: PartInfoProps): React.JSX.Element {
  const t = useTranslations("bike");
  const tParts = useTranslations("parts");
  const tRoot = useTranslations();

  if (partId === null) {
    return (
      <div className={cn("text-ink-muted text-sm", className)} data-testid="part-panel-empty">
        <p className="text-ink font-medium">{t("panel.emptyTitle")}</p>
        <p className="mt-1">{t("panel.emptyHelp")}</p>
      </div>
    );
  }

  const definition = partDefinition(partId);
  const part = build.parts.find((candidate) => candidate.partId === partId);
  if (definition === undefined || part === undefined) {
    return (
      <p className={cn("text-ink-muted text-sm", className)} data-testid="part-panel-empty">
        {t("panel.emptyTitle")}
      </p>
    );
  }

  // eslint-disable-next-line security/detect-object-injection -- `partId` is a catalogue id
  const status = statuses?.[partId] ?? "UNKNOWN";
  const actions = partActionGuides(guides, build, partId);
  const shown = definition.attributes.filter(
    (attribute) =>
      isAttributePresent(attribute, build.spec) && part.attributes[attribute.key] !== undefined,
  );
  const query = specCode ? { spec: specCode } : undefined;

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="part-panel">
      <div>
        <h2 className="font-display text-ink text-lg font-semibold" data-testid="part-panel-title">
          {tParts(`${partId}.label` as never)}
        </h2>
        <p className="text-ink-muted mt-1 text-sm">{tParts(`${partId}.description` as never)}</p>
      </div>

      <p className="text-sm" data-testid="part-status">
        <span className="text-ink-muted">{t("panel.status")} </span>
        <span data-status={status}>{t(`status.${status}` as never)}</span>
      </p>

      {shown.length > 0 ? (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
          data-testid="part-attributes"
        >
          {shown.map((attribute) => (
            <div key={attribute.key} className="contents" data-attr-row={attribute.key}>
              <dt className="text-ink-muted">{tRoot(attribute.labelKey as never)}</dt>
              <dd className="text-ink">
                <AttributeValueText
                  attributeKey={attribute.key}
                  kind={attribute.kind}
                  unit={attribute.unit}
                  value={part.attributes[attribute.key]}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {repo.canEdit ? (
        <section aria-labelledby={`edit-${partId}`}>
          <h3 id={`edit-${partId}`} className="text-ink mb-2 text-sm font-semibold">
            {t("panel.edit")}
          </h3>
          <PartEditForm build={build} partId={partId} repo={repo} onSaved={onSaved} />
        </section>
      ) : (
        <div className="border-rule rounded-md border p-3" data-testid="part-panel-fork">
          <p className="text-ink-muted text-sm">{t("panel.demoNotice")}</p>
          <Button type="button" className="mt-2 min-h-[var(--tap-min)]" onClick={onFork}>
            {t("panel.demoFork")}
          </Button>
        </div>
      )}

      <nav aria-label={t("panel.guidesLabel")} className="flex flex-col gap-1">
        {PART_ACTION_KINDS.map((kind) => {
          // eslint-disable-next-line security/detect-object-injection -- a PART_ACTION_KINDS literal
          const guide = actions[kind];
          if (!guide) return null;
          return (
            <Link
              key={kind}
              href={{ pathname: "/guides/[slug]", params: { slug: guide.slug } }}
              prefetch={false}
              className="text-accent flex min-h-[var(--tap-min)] items-center underline"
              data-guide-action={kind}
            >
              {t(`guides.${kind}` as never)} — {guide.title}
            </Link>
          );
        })}
      </nav>

      <Link
        href={{
          pathname: "/velo/[id]/piece/[partId]",
          params: { id: bikeParam, partId },
          ...(query === undefined ? {} : { query }),
        }}
        prefetch={false}
        className="text-ink-muted flex min-h-[var(--tap-min)] items-center text-sm underline"
        data-testid="part-permalink"
      >
        {t("panel.permalink")}
      </Link>
    </div>
  );
}

/** One attribute value, translated when it is an enum and formatted when it has a unit. */
function AttributeValueText({
  attributeKey,
  kind,
  unit,
  value,
}: {
  attributeKey: string;
  kind: string;
  unit: string | undefined;
  value: unknown;
}): React.JSX.Element {
  const t = useTranslations("bike");
  const tParts = useTranslations("parts");

  if (typeof value === "boolean") return <>{t(value ? "panel.yes" : "panel.no")}</>;
  if (kind === "enum") {
    return <>{tParts(`values.${attributeKey}.${String(value)}` as never)}</>;
  }
  if (unit !== undefined) {
    return <>{tParts(`units.${unit}` as never, { value: String(value) } as never)}</>;
  }
  return <>{String(value)}</>;
}
