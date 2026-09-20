"use client";

import { Bike } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Callout } from "@/components/ui-ext/Callout";
import { Button } from "@/components/ui/button";
import { LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { Link } from "@/lib/i18n/navigation";

/**
 * "You built a bike on this device — put it in your account" (§6.5).
 *
 * Without this, `/import` is a page nobody can find: a guest who describes a
 * bike, then signs in, lands on `/mes-velos` and sees an empty garage next to a
 * `localStorage` full of their work.
 *
 * **It only ever checks whether the key exists.** Reading the bike properly
 * means `readLocalBike`, and that pulls the whole part catalogue into
 * `/mes-velos` — a budgeted route (`perf.budgets.json`). Presence is all this
 * decides; `/import` does the parsing, and sends an unreadable payload back to
 * `/mes-velos` on its own.
 *
 * The server (and the first client render) renders nothing, so the garage's
 * HTML does not depend on a storage the server cannot read and hydration
 * matches. The banner appears immediately after hydration, and follows other
 * tabs through the `storage` event — signing in on one tab and importing on
 * another should not leave a stale invitation behind.
 */

function hasGuestBike(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_BIKE_KEY) !== null;
  } catch {
    // Storage disabled (Safari private mode, blocked site data): nothing to import.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function GuestBanner(): React.JSX.Element | null {
  const t = useTranslations("account");
  const present = useSyncExternalStore(subscribe, hasGuestBike, () => false);
  if (!present) return null;

  return (
    <Callout
      tone="info"
      title={t("guestBanner.title")}
      icon={<Bike aria-hidden="true" className="size-5" />}
      data-testid="guest-banner"
    >
      <div className="flex flex-col items-start gap-3">
        <p>{t("guestBanner.text")}</p>
        <Button asChild size="sm" className="min-h-[var(--tap-min)]">
          <Link href={{ pathname: "/import" }} data-testid="guest-banner-cta">
            {t("guestBanner.cta")}
          </Link>
        </Button>
      </div>
    </Callout>
  );
}
