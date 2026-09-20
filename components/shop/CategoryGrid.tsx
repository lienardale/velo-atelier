import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { domainMessage } from "@/lib/domain/i18n";
import { outboundUrl, retailerLabelKey, SHOP_RETAILERS } from "@/lib/shop/outbound";
import type { RetailerId } from "@/lib/domain/schema/retailer";
import type { Locale } from "@/lib/i18n/routing";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

import { OutboundLink } from "./OutboundLink";

/**
 * The grid of `/acheter` (§5.5): eleven starting points, three shops each.
 *
 * One card per entry of `content/shop/categories.yaml`. The card's own title
 * links to the part panel (`?part=<id>`), which is where the questions and the
 * brand tiers are; the three buttons below are the same search at the three
 * retailers, so a visitor who already knows what they want does not have to
 * answer anything.
 *
 * **Plain props, already in one language.** The YAML is read server-side
 * (`lib/shop/retailers.ts`, which touches `node:fs`); this component receives
 * what that reader produced for the request's locale, so it renders identically
 * on the server and inside a client subtree.
 */
export interface CategoryCard {
  id: string;
  label: string;
  hint: string;
  /** The search text for the search retailers. */
  query: string;
  /** The category's main part — what a category retailer's page is chosen by. */
  partId: string;
  retailers: readonly RetailerId[];
}

export interface CategoryGridProps {
  categories: readonly CategoryCard[];
  locale: Locale;
  className?: string;
}

export function CategoryGrid({
  categories,
  locale,
  className,
}: CategoryGridProps): React.JSX.Element {
  return (
    <ul
      className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}
      data-testid="category-grid"
    >
      {categories.map((category) => (
        <li key={category.id}>
          <Card className="h-full" data-category={category.id} data-print-card>
            <CardHeader>
              <CardTitle className="text-lg">
                <Link
                  href={{ pathname: "/acheter", query: { part: category.partId } }}
                  className="text-ink hover:text-accent flex min-h-[var(--tap-min)] items-center underline-offset-2 hover:underline"
                  data-testid={`category-link-${category.id}`}
                >
                  {category.label}
                </Link>
              </CardTitle>
              <p className="text-ink-muted text-sm">{category.hint}</p>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2">
                {(category.retailers.length > 0 ? category.retailers : SHOP_RETAILERS).map(
                  (retailer) => (
                    <li key={retailer}>
                      <OutboundLink
                        href={outboundUrl(retailer, locale, category.query, category.partId)}
                        data-retailer={retailer}
                        data-category={category.id}
                      >
                        {domainMessage(locale, retailerLabelKey(retailer))}
                      </OutboundLink>
                    </li>
                  ),
                )}
              </ul>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
