"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { CheckupAnswer } from "@/lib/checkup/types";
import { cn } from "@/lib/utils";

/**
 * The three answers, always within a thumb's reach (§6.5).
 *
 * Sticky at the bottom, `min-h-14`, every button at least 44 px and clear of
 * the home indicator (`env(safe-area-inset-bottom)`): this is the control the
 * whole page exists for, and on a phone held in one hand next to a bike it has
 * to be where the thumb already is.
 *
 * "Passer" is absent — not disabled — on a question the guide's author marked
 * unskippable, with the reason said out loud next to it. A disabled button that
 * never explains itself is a worse answer than no button.
 *
 * The keyboard shortcuts (1 / 2 / 3) are the wizard's, not this component's:
 * they have to be ignored while the visitor is typing a note, and only the
 * wizard knows that.
 */
export interface VerdictBarProps {
  /** The question being answered — shown above the buttons on a wide screen. */
  prompt: string;
  current: CheckupAnswer | undefined;
  skippable: boolean;
  onAnswer: (result: "ok" | "ko") => void;
  onSkip: () => void;
  className?: string;
}

export function VerdictBar({
  prompt,
  current,
  skippable,
  onAnswer,
  onSkip,
  className,
}: VerdictBarProps): React.JSX.Element {
  const t = useTranslations("checkup");

  return (
    <div
      data-testid="verdict-bar"
      data-verdict={current ?? "none"}
      className={cn(
        "sticky bottom-0 z-10 -mx-4 mt-6 min-h-14 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <p className="mb-2 text-sm text-ink">{prompt}</p>
      {/* A GRID, not a wrapping flex row: the three columns are a fraction of
          the bar and do not depend on how long "ça ne marche pas" is in this
          locale. A `flex-1` row resolves its widths from content, animates them
          through shadcn's `transition-all`, and leaves a tap landing on the
          neighbouring button for as long as that lasts.
          The column count does not depend on the QUESTION either: "ça marche"
          and "ça ne marche pas" sit in the same two cells whether or not this
          step can be skipped, so a thumb aiming at one of them between two
          questions never finds the other there. `transition-none` closes the
          same hole one layer down — a width that is still animating is a width
          a tap can miss. */}
      <div
        role="group"
        aria-label={t("verdict.legend")}
        className="grid grid-cols-2 items-center gap-2 sm:grid-cols-3"
      >
        <Button
          type="button"
          onClick={() => onAnswer("ok")}
          aria-pressed={current === "ok"}
          data-testid="verdict-ok"
          className={cn(
            "tap-target w-full min-w-0 bg-success px-2 text-white transition-none hover:bg-success/90",
            current === "ok" && "ring-2 ring-ring ring-offset-2",
          )}
        >
          {t("verdict.ok")}
        </Button>
        <Button
          type="button"
          onClick={() => onAnswer("ko")}
          aria-pressed={current === "ko"}
          data-testid="verdict-ko"
          className={cn(
            "tap-target w-full min-w-0 bg-danger px-2 text-white transition-none hover:bg-danger/90",
            current === "ko" && "ring-2 ring-ring ring-offset-2",
          )}
        >
          {t("verdict.ko")}
        </Button>
        {skippable ? (
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            aria-pressed={current === "skipped"}
            data-testid="verdict-skip"
            className={cn(
              "tap-target col-span-2 w-full min-w-0 px-2 transition-none sm:col-span-1",
              current === "skipped" && "ring-2 ring-ring ring-offset-2",
            )}
          >
            {t("verdict.skip")}
          </Button>
        ) : null}
      </div>
      {skippable ? null : (
        <p className="mt-2 text-sm text-ink-muted" data-testid="verdict-required">
          {t("verdict.required")}
        </p>
      )}
      <p className="sr-only">{t("verdict.shortcuts")}</p>
    </div>
  );
}
