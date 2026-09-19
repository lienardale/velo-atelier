"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BuildListItem } from "@/lib/checkup/types";
import { partLabel } from "@/lib/domain/i18n";
import type { Locale } from "@/lib/i18n/routing";

/**
 * "Copier la liste" (§6.5) — the list as plain text, for a message to the shop
 * or to the friend who has the right tool.
 *
 * Plain text on purpose: no link, no markup, nothing that only renders in one
 * app. One line per open item, the part and why it is there.
 *
 * `navigator.clipboard` needs a secure context and, in some browsers, a
 * permission — it is not something to assume. A refusal says so in the button
 * rather than failing silently, which is the difference between "I pressed it
 * and nothing happened" and "I know I have to copy it by hand".
 */
export interface CopyButtonProps {
  items: readonly BuildListItem[];
  locale: Locale;
  label: string;
  doneLabel: string;
  failedLabel: string;
  /** Resolves `guides.reasons.<key>`; omitted, the reason key is printed as is. */
  reasonText?: (reasonKey: string) => string;
  className?: string;
}

/** One line per open item: "Chaîne — élongation de la chaîne". */
export function buildListAsText(
  items: readonly BuildListItem[],
  locale: Locale,
  reasonText: (reasonKey: string) => string = (key) => key,
): string {
  return items
    .filter((item) => !item.done)
    .map((item) => `${partLabel(locale, item.partId)} — ${reasonText(item.reasonKey)}`)
    .join("\n");
}

export function CopyButton({
  items,
  locale,
  label,
  doneLabel,
  failedLabel,
  reasonText,
  className,
}: CopyButtonProps): React.JSX.Element {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async (): Promise<void> => {
    const text = buildListAsText(items, locale, reasonText);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="inline-flex items-center gap-2" data-print="hide">
      <Button
        type="button"
        variant="outline"
        className={className ?? "min-h-[var(--tap-min)]"}
        onClick={() => void copy()}
        data-testid="build-list-copy"
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {label}
      </Button>
      <span
        role="status"
        aria-live="polite"
        className="text-ink-muted text-xs"
        data-testid="build-list-copy-status"
      >
        {state === "copied" ? doneLabel : state === "failed" ? failedLabel : ""}
      </span>
    </span>
  );
}
