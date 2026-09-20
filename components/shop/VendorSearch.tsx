"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { domainMessage } from "@/lib/domain/i18n";
import { normalizeQuery } from "@/lib/shop/query";
import { outboundUrl, retailerLabelKey, SHOP_RETAILERS } from "@/lib/shop/outbound";
import type { Locale } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

import { OutboundLink } from "./OutboundLink";

/**
 * The free-text box of `/acheter` (§5.5).
 *
 * Someone who already knows they want a "chaîne 11 vitesses" should not have to
 * pick a category first. They type it, and the three links point at that search
 * in the three shops.
 *
 * **There is no form submission and no request.** The links are rebuilt as the
 * visitor types, so there is nothing to submit to: pressing Enter in the field
 * does nothing, and the only navigation is the visitor choosing a shop. That is
 * also why the field is not `<form>`-wrapped — a form with no action would
 * reload the page on Enter and lose what was typed.
 *
 * `normalizeQuery` is what stands between a paste and a URL: whitespace
 * collapsed, control characters dropped, length capped. An empty result shows
 * the hint instead of three links to nothing.
 */
export interface VendorSearchProps {
  locale: Locale;
  /** Prefill, e.g. the query a build-list item arrived with. */
  defaultQuery?: string;
  className?: string;
}

export function VendorSearch({
  locale,
  defaultQuery = "",
  className,
}: VendorSearchProps): React.JSX.Element {
  const t = useTranslations("shop");
  const fieldId = useId();
  const [raw, setRaw] = useState(defaultQuery);
  const query = normalizeQuery(raw);

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="vendor-search">
      <div className="flex flex-col gap-1">
        <Label htmlFor={fieldId}>{t("search.label")}</Label>
        <Input
          id={fieldId}
          type="search"
          value={raw}
          onChange={(event) => setRaw(event.currentTarget.value)}
          placeholder={t("search.placeholder")}
          aria-describedby={`${fieldId}-hint`}
          className="min-h-[var(--tap-min)] max-w-md text-base md:text-base"
          data-testid="vendor-search-input"
        />
        <p id={`${fieldId}-hint`} className="text-ink-muted text-sm">
          {t("search.hint")}
        </p>
      </div>

      {query === "" ? (
        <p className="text-ink-muted text-sm" data-testid="vendor-search-empty">
          {t("search.empty")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" data-testid="vendor-search-links">
          {SHOP_RETAILERS.map((retailer) => (
            <li key={retailer}>
              <OutboundLink
                href={outboundUrl(retailer, locale, query)}
                data-retailer={retailer}
                data-testid={`vendor-search-${retailer}`}
              >
                {domainMessage(locale, retailerLabelKey(retailer))}
              </OutboundLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
