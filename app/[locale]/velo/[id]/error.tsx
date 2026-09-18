"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";

/**
 * Error boundary for the workspace and its sub-routes.
 *
 * It exists rather than letting `app/[locale]/error.tsx` catch these, because
 * what went wrong here has a specific way out: the **demo bike**. A solver that
 * threw on an odd geometry, a stored build that no longer validates, a part
 * catalogue that moved under a saved bike — in every one of those the site
 * still works, just not for this bike, and sending the visitor to the home page
 * is worse advice than sending them to a bike that is known to render.
 *
 * `error.message` is never shown (§ the locale boundary's reasoning): in
 * production React replaces it anyway, and in development it can put internals
 * into a screenshot. The `digest` correlates with the server log.
 */
export default function BikeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const t = useTranslations("bike");
  const tCommon = useTranslations("common");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      role="alert"
      aria-labelledby="bike-error-title"
      className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-16 text-center"
    >
      <h1 id="bike-error-title" className="font-display text-ink text-2xl font-semibold">
        {t("error.title")}
      </h1>
      <p className="text-ink-muted">{t("error.description")}</p>
      {error.digest ? (
        <p className="text-ink-muted text-sm">
          {tCommon("error.reference", { digest: error.digest })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={reset} className="min-h-[var(--tap-min)]">
          {tCommon("error.retry")}
        </Button>
        <Button asChild variant="outline" className="min-h-[var(--tap-min)]">
          <Link href={{ pathname: "/velo/[id]", params: { id: "demo" } }}>
            {t("error.openDemo")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
