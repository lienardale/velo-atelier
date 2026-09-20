import { useTranslations } from "next-intl";

import { OutboundLink } from "@/components/shop/OutboundLink";
import { domainMessage } from "@/lib/domain/i18n";
import {
  isRetailerVerified,
  outboundUrl,
  retailerLabelKey,
  SHOP_RETAILERS,
} from "@/lib/shop/outbound";
import type { Locale } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * "Où l'acheter" — the same three shops, everywhere (§5.5, §6.8 AC7).
 *
 * One `<OutboundLink>` per retailer of `SHOP_RETAILERS`, in the domain's
 * display order, each carrying the query this part and these refinements
 * produce. A shop with no search endpoint (Alltricks) gets its category page
 * for the part instead — same button, different kind of destination, which is
 * why `partId` is passed alongside the query.
 *
 * Shared by the build list and by `/acheter`'s part panel: the two surfaces ask
 * the same question and must not answer it with two different sets of links.
 *
 * ## `verifiedAt`
 *
 * A retailer's URLs are checked **by a human** opening them
 * (`docs/retailers.md`), and the date of that check lives in
 * `lib/domain/data/retailers.ts`. Today Rose Bikes is verified and the other
 * two are not, so the group carries one quiet line naming them (§5.5) rather
 * than a badge on each button. The note is driven by the data: the day someone
 * opens Alltricks and writes the date down, it disappears on its own.
 */
export interface VendorButtonsProps {
  partId: string;
  /** The search terms, already built (`buildQuery`). */
  query: string;
  locale: Locale;
  className?: string;
  /** `data-testid` of the wrapper, so a spec can scope to one item's links. */
  testId?: string;
}

export function VendorButtons({
  partId,
  query,
  locale,
  className,
  testId = "vendor-buttons",
}: VendorButtonsProps): React.JSX.Element {
  const t = useTranslations("shop");
  const unverified = SHOP_RETAILERS.filter((retailer) => !isRetailerVerified(retailer));

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid={testId}>
      <ul className="flex flex-wrap gap-2">
        {SHOP_RETAILERS.map((retailer) => (
          <li key={retailer}>
            <OutboundLink
              href={outboundUrl(retailer, locale, query, partId)}
              data-retailer={retailer}
              data-part-id={partId}
            >
              {domainMessage(locale, retailerLabelKey(retailer))}
            </OutboundLink>
          </li>
        ))}
      </ul>
      {unverified.length === 0 ? null : (
        <p className="text-ink-muted text-xs" data-testid={`${testId}-unverified`}>
          {unverified
            .map((retailer) => domainMessage(locale, retailerLabelKey(retailer)))
            .join(", ")}{" "}
          — {t("outbound.unverified")}
        </p>
      )}
    </div>
  );
}
