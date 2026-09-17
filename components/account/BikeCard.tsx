"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { deleteBikeAction, renameBikeAction } from "@/app/[locale]/(protected)/mes-velos/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Disclosure } from "@/components/ui-ext/Disclosure";
import { translateMessageKey } from "@/lib/actions/result";
import { BIKE_NAME_MAX } from "@/lib/bike/rules";
import { Link, useRouter } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * One saved bike on `/mes-velos` (§6.2).
 *
 * A card, not a table row: the interesting facts about a bike are its name,
 * what kind of bike it is and when it was last touched, and those do not line
 * up in columns on a phone. The title's link is stretched over the whole card,
 * so a thumb anywhere opens the workspace — the same treatment `GuideCard`
 * gets, for the same reason.
 *
 * ## Rename and delete
 *
 * Folded into a `<details>`, and **above** the stretched link (`relative z-10`)
 * so their own clicks are their own. Deleting takes two presses: the first
 * arms the button, the second does it. Not a `confirm()` dialog — that is
 * unstyled, untranslatable and blocked in some browsers — and not a typed
 * confirmation either, which is the ceremony an account deletion deserves and a
 * bike does not. A bike is re-describable in two minutes from the tree.
 */
export interface BikeCardProps {
  id: string;
  name: string;
  /** Localized discipline and drive, already resolved by the page. */
  summary: string;
  /** ISO 8601. */
  updatedAt: string;
  /** Rendered next to the title — an unfinished checkup, a part count… */
  badge?: string;
  className?: string;
}

export function BikeCard({
  id,
  name,
  summary,
  updatedAt,
  badge,
  className,
}: BikeCardProps): React.JSX.Element {
  const t = useTranslations("bike");
  const tRoot = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const [currentName, setCurrentName] = useState(name);
  const [draft, setDraft] = useState(name);
  const [armed, setArmed] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const updated = new Date(updatedAt);

  const rename = (): void => {
    setErrorKey(null);
    startTransition(async () => {
      const result = await renameBikeAction({ bikeId: id, name: draft.trim() });
      if (result.ok) {
        setCurrentName(result.data.name);
        router.refresh();
        return;
      }
      setErrorKey(result.fieldErrors?.name ?? `errors.${result.code}`);
    });
  };

  const remove = (): void => {
    setErrorKey(null);
    startTransition(async () => {
      const result = await deleteBikeAction({ bikeId: id });
      if (result.ok) {
        router.refresh();
        return;
      }
      setErrorKey(`errors.${result.code}`);
    });
  };

  return (
    <article
      data-testid="bike-card"
      data-bike-id={id}
      className={cn(
        "border-rule bg-paper focus-within:ring-ring relative rounded-lg border p-4 focus-within:ring-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-display text-ink text-lg font-semibold">
          <Link
            href={{ pathname: "/velo/[id]", params: { id } }}
            className="after:absolute after:inset-0 after:content-['']"
            data-testid="bike-card-link"
          >
            {currentName}
          </Link>
        </h2>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>

      <p className="text-ink-muted mt-1 text-sm">{summary}</p>
      {Number.isNaN(updated.getTime()) ? null : (
        <p className="text-ink-muted mt-1 text-xs">
          {t("myBikes.updated", { date: format.dateTime(updated, { dateStyle: "medium" }) })}
        </p>
      )}

      <div className="relative z-10 mt-3">
        <Disclosure summary={t("myBikes.manage")}>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`rename-${id}`}>{t("myBikes.nameLabel")}</Label>
              <Input
                id={`rename-${id}`}
                value={draft}
                maxLength={BIKE_NAME_MAX}
                className="min-h-[var(--tap-min)] text-base md:text-base"
                data-testid="rename-input"
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-[var(--tap-min)]"
                disabled={pending || draft.trim() === "" || draft.trim() === currentName}
                onClick={rename}
                data-testid="rename-submit"
              >
                {t("myBikes.rename")}
              </Button>
              <Button
                type="button"
                variant={armed ? "destructive" : "outline"}
                className="min-h-[var(--tap-min)]"
                disabled={pending}
                onClick={() => (armed ? remove() : setArmed(true))}
                data-testid="delete-bike"
              >
                {armed ? t("myBikes.deleteConfirm") : t("myBikes.delete")}
              </Button>
            </div>
            {errorKey ? (
              <p role="alert" className="text-danger-fg text-sm" data-testid="bike-card-error">
                {translateMessageKey(tRoot, errorKey)}
              </p>
            ) : null}
          </div>
        </Disclosure>
      </div>
    </article>
  );
}
