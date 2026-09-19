"use client";

/**
 * `/fr/import` · `/en/import` — the page that moves a guest's work into their
 * account (§6.2).
 *
 * A **client** page, and it has to be: everything it imports lives in
 * `localStorage`, which the server cannot read. It therefore does not call
 * `auth()` the way `/compte` and `/mes-velos` do; the session is enforced twice
 * over anyway, by `authorized()` in `proxy.ts` (`/import` is in
 * `PROTECTED_KEYS`) and by `withUser()` inside `importGuestStateAction`, which
 * is the only thing on this page that touches data.
 *
 * It runs by itself on arrival — there is nothing to choose, and a visitor who
 * followed "import my bike" has already chosen. Three outcomes:
 *
 *   nothing stored   → `/mes-velos`, with no notice: an empty import is not an
 *                      error, it is a visitor who has no guest bike on this
 *                      device (§6.2).
 *   imported         → the guest keys are cleared, a toast says what happened,
 *                      and the bike opens at `/velo/<uuid>`.
 *   refused          → the keys are KEPT and the reason is shown with a retry.
 *                      Clearing storage after a failure would lose the bike.
 *
 * `lib/guest/schema` is imported on demand rather than at module scope: it
 * pulls the part catalogue in (through `readLocalBike`), and there is no reason
 * for that to be in the first paint of a page whose first paint is a spinner.
 */

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Callout } from "@/components/ui-ext/Callout";
import { Button } from "@/components/ui/button";
import type { ActionErrorCode } from "@/lib/actions/result";
import { Link, useRouter } from "@/lib/i18n/navigation";

import { importGuestStateAction } from "./actions";

type Phase = "running" | "failed";

export default function ImportPage(): React.JSX.Element {
  const t = useTranslations("account");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("running");
  const [code, setCode] = useState<ActionErrorCode | null>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setPhase("running");
    setCode(null);

    const guest = await import("@/lib/guest/schema");
    const state = guest.collectGuestState({
      bikeName: t("import.bikeName"),
      listName: t("import.listName"),
    });

    if (guest.isEmptyGuestState(state)) {
      router.replace({ pathname: "/mes-velos" });
      return;
    }

    const result = await importGuestStateAction(state);
    if (!result.ok) {
      setCode(result.code);
      setPhase("failed");
      return;
    }

    // Only now: a browser whose bike is in the account no longer needs its copy,
    // and keeping it would offer the import again for ever.
    guest.clearGuestState();

    const { bikeId, imported } = result.data;
    if (bikeId === null) {
      router.replace({ pathname: "/mes-velos" });
      return;
    }
    // Imported here, not at module scope: a static import would put sonner in
    // this route's first-load JS (see components/ui-ext/Notices.tsx).
    void import("sonner").then(({ toast }) =>
      toast(imported === 0 ? t("import.alreadyDone") : t("import.done")),
    );
    router.replace({ pathname: "/velo/[id]", params: { id: bikeId } });
  }, [router, t]);

  useEffect(() => {
    // React runs effects twice in development's Strict Mode; an import must be
    // attempted once per visit, whatever the runtime does with the effect.
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <div className="flex flex-col gap-6" data-testid="guest-import">
      <h1 className="font-display text-ink text-2xl font-semibold">{t("import.title")}</h1>

      <p className="text-ink-muted" aria-live="polite" data-testid="guest-import-status">
        {phase === "running" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {t("import.running")}
          </span>
        ) : (
          t("import.failedHelp")
        )}
      </p>

      {phase === "failed" && code !== null ? (
        <>
          <Callout tone="danger" role="alert" data-testid="guest-import-error">
            {tErrors(code)}
          </Callout>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => void run()}
              className="min-h-[var(--tap-min)]"
              data-testid="guest-import-retry"
            >
              {t("import.retry")}
            </Button>
            <Button asChild variant="outline" className="min-h-[var(--tap-min)]">
              <Link href={{ pathname: "/mes-velos" }}>{t("import.skip")}</Link>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
