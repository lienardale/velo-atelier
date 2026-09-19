"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Imprimer" (§6.5, §6.8 AC7).
 *
 * A build list is taken to a shop, and paper does not run out of battery. The
 * print sheet itself is `styles/print.css` — imported from `globals.css` with
 * `@import … print`, so its rules only ever apply to paper — which drops the
 * header, the footer, every `<nav>`, the 3D canvas and every `<button>` (this
 * one included) and keeps the cards.
 *
 * The button only asks the browser; it styles nothing. `data-print="hide"` is
 * belt and braces for the same reason — a `<button>` is already hidden on
 * paper, but the attribute says so out loud next to the thing it hides.
 */
export interface PrintButtonProps {
  label: string;
  className?: string;
}

export function PrintButton({ label, className }: PrintButtonProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      className={className ?? "min-h-[var(--tap-min)]"}
      onClick={() => window.print()}
      data-print="hide"
      data-testid="build-list-print"
    >
      <Printer aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
