import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { OUTBOUND_REL, OUTBOUND_TARGET } from "@/lib/shop/outbound";
import { cn } from "@/lib/utils";

/**
 * The only way this site links out (§5.5, §5.8 AC5, §6.8 AC7).
 *
 * Every outbound `<a>` — a vendor button on the build list, a category card,
 * the free-text search — goes through this component so the contract is written
 * once:
 *
 *   target="_blank"                          the visitor is mid-task
 *   rel="noopener noreferrer nofollow"       no opener handle, no referrer, no endorsement
 *   an external icon, `aria-hidden`          the picture never carries meaning alone
 *   "(nouvelle fenêtre)" in an sr-only span  …so the meaning is in the accessible name
 *
 * It is a plain `<a>`, never `next/link`: these URLs leave the application, and
 * the router has nothing to prefetch.
 *
 * **It makes no request of its own.** No `fetch`, no `sendBeacon`, no
 * `onClick` — clicking it is a navigation and nothing else, which is what
 * `OutboundLink.test.tsx` asserts with msw watching (§5.8 AC5: zero network
 * calls on click). There are no affiliate ids and no click tracking anywhere in
 * this project; adding either would start here, and that test is the tripwire.
 *
 * Not a `"use client"` module: it renders on the server inside `<CategoryGrid>`
 * and is compiled into the client bundle inside `<VendorButtons>`, unchanged.
 */
export interface OutboundLinkProps extends Omit<React.ComponentProps<"a">, "target" | "rel"> {
  /** The absolute https URL, from `outboundUrl()`. */
  href: string;
  children: React.ReactNode;
  /** Hide the trailing icon where the row already shows one (the icon is decorative). */
  showIcon?: boolean;
}

export function OutboundLink({
  href,
  children,
  className,
  showIcon = true,
  ...props
}: OutboundLinkProps): React.JSX.Element {
  const t = useTranslations("shop");
  return (
    <a
      href={href}
      target={OUTBOUND_TARGET}
      rel={OUTBOUND_REL}
      data-outbound="true"
      className={cn(
        "tap-target text-ink border-rule hover:bg-paper-2 inline-flex gap-2 rounded-md border px-3 py-2 text-sm font-medium",
        className,
      )}
      {...props}
    >
      <span className="min-w-0">{children}</span>
      {showIcon ? <ExternalLink aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
      <span className="sr-only">{t("outbound.newWindow")}</span>
    </a>
  );
}
