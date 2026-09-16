import { cn } from "@/lib/utils";

export interface StepperProps extends Omit<React.ComponentProps<"div">, "children" | "title"> {
  /** 1-based position of the current step. Clamped into `[0, total]`. */
  current: number;
  /** How many steps there are in total. The decision tree's total is dynamic. */
  total: number;
  /**
   * The progress bar's accessible name AND its `aria-valuetext`, already
   * translated — e.g. "Étape 4 sur 12" / "Step 4 of 12". Screen readers
   * announce this instead of the bare "4" a raw value would give.
   */
  label: string;
  /** Optional visible step title, e.g. "Frein avant". Truncated on one line. */
  title?: React.ReactNode;
  /**
   * The visible counter. Defaults to `4/12`, which needs no translation; pass
   * a string when a locale wants something else.
   */
  countLabel?: string;
}

/**
 * "4/12 — Frein avant" plus a progress bar: the position indicator of the
 * decision tree (§6.3) and of the checkup wizard (§6.5).
 *
 * The bar carries the semantics — one `role="progressbar"`, named by `label` —
 * so the counter and the title beside it stay decorative and a screen reader
 * hears one thing, not three.
 *
 * The bar is written out here rather than composed from the generated
 * `components/ui/progress.tsx`: that primitive destructures `value` and uses it
 * only for the indicator's transform, never forwarding it to the Radix root, so
 * it renders `data-state="indeterminate"` with no `aria-valuenow` at all. A
 * step counter that announces nothing is worse than no step counter.
 *
 * Presentational: every string arrives as a prop, so it owns no message
 * namespace.
 */
export function Stepper({
  current,
  total,
  label,
  title,
  countLabel,
  className,
  ...props
}: StepperProps): React.JSX.Element {
  const steps = Math.max(0, Math.trunc(total));
  const step = Math.min(Math.max(0, Math.trunc(current)), steps);
  // A tree with no questions left is "done", not "0 %" — and it never divides by zero.
  const percent = steps === 0 ? 100 : Math.round((step / steps) * 100);

  return (
    <div
      data-slot="stepper"
      data-step={step}
      data-total={steps}
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-display font-semibold text-ink tabular-nums">
          {countLabel ?? `${step}/${steps}`}
        </span>
        {title === undefined ? null : (
          <span className="min-w-0 truncate text-ink-muted">{title}</span>
        )}
      </div>
      <div
        role="progressbar"
        data-slot="stepper-bar"
        aria-label={label}
        aria-valuetext={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(steps, 1)}
        aria-valuenow={step}
        className="h-1.5 w-full overflow-hidden rounded-full bg-rule"
      >
        <div
          aria-hidden="true"
          data-slot="stepper-bar-fill"
          className="h-full rounded-full bg-accent transition-[width] duration-(--motion-base) ease-(--ease-standard)"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
