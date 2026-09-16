import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, letting the last Tailwind utility of a conflicting group win.
 *
 * This is the `cn` every `components/ui/**` primitive imports (`components.json`
 * → `aliases.utils`). shadcn 4 now defaults its generated files to the npm
 * `cn` package; we keep the classic `clsx` + `tailwind-merge` implementation
 * because both are already pinned dependencies (§1.4) and a third
 * class-merging library would only duplicate them. `scripts/`-side code and
 * tests can import it too — it touches no browser or Node API.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
