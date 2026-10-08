"use client";

/**
 * The client half of `/import` — everything that has to read `localStorage`.
 *
 * It lives beside the page rather than inside it because the page itself must
 * stay a SERVER component: §4.3/§4.4 have each `(protected)` page call `auth()`
 * for itself (a layout does not re-run between two of its own children), and
 * §6.6 has every page carry `buildMetadata(…)`. A `"use client"` module can
 * export neither. Same split as `app/[locale]/dev/bike3d/{page,DevBike3dHarness}.tsx`.
 *
 * It runs by itself on arrival — there is nothing to choose, and a visitor who
 * followed "import my bike" has already chosen. Three outcomes:
 *
 *   nothing stored   → `/mes-velos`, with no notice: an empty import is not an
 *                      error, it is a visitor who has no guest bike on this
 *                      device (§6.2).
 *   imported         → a toast says what happened and the bike opens at
 *                      `/velo/<uuid>`. The keys this browser may forget are the
 *                      ones `settleGuestImport` names, and no other: the bike
 *                      and the list, and the checkup ONLY when the server said
 *                      it is in the account (or there was none to import).
 *   refused          → the keys are KEPT and the reason is shown with a retry.
 *                      Clearing storage after a failure would lose the bike.
 *
 * **A checkup that was not imported is said, and stays.** Unreadable in this
 * browser, nothing the server could keep, or a bike that was already in the
 * account: the toast carries a second sentence naming which, in the visitor's
 * language, and stays up long enough to be read. Until 2026-10-07 this
 * component cleared all three keys after any successful import — including the
 * checkup the importer had silently skipped (`.debug/017` §5.6).
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

/** How long the toast stays when it has to say a checkup was NOT imported (sonner's default is 4 s). */
const CHECKUP_KEPT_TOAST_MS = 20_000;

export function GuestImport(): React.JSX.Element {
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
    // Reading removes nothing: a checkup this browser cannot read is still
    // there afterwards, whatever the server answers.
    const collection = guest.collectGuestState({
      bikeName: t("import.bikeName"),
      listName: t("import.listName"),
    });

    if (guest.isEmptyGuestState(collection.state)) {
      router.replace({ pathname: "/mes-velos" });
      return;
    }

    const result = await importGuestStateAction(collection.state);
    if (!result.ok) {
      setCode(result.code);
      setPhase("failed");
      return;
    }

    // Only now, and only what the answer allows: a browser whose bike is in the
    // account no longer needs its copy — keeping it would offer the import
    // again for ever — but a checkup the server did not confirm is NOT its to
    // delete.
    const settlement = guest.settleGuestImport(collection, result.data);
    guest.clearGuestKeys(settlement.clear);

    const { bikeId, imported } = result.data;
    if (bikeId === null) {
      router.replace({ pathname: "/mes-velos" });
      return;
    }

    const title = imported === 0 ? t("import.alreadyDone") : t("import.done");
    const kept =
      settlement.checkup.status === "skipped"
        ? {
            unreadable: t("import.checkupKept.unreadable"),
            "nothing-kept": t("import.checkupKept.nothingKept"),
            "bike-already-imported": t("import.checkupKept.bikeAlreadyImported"),
            unconfirmed: t("import.checkupKept.unconfirmed"),
          }[settlement.checkup.reason]
        : null;
    // Imported here, not at module scope: a static import would put sonner in
    // this route's first-load JS (see components/ui-ext/Notices.tsx).
    void import("sonner").then(({ toast }) =>
      kept === null
        ? toast(title)
        : toast(title, { description: kept, duration: CHECKUP_KEPT_TOAST_MS }),
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
