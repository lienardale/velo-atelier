import { useTranslations } from "next-intl";

/**
 * Route-level loading UI for everything under `/[locale]`. Next wraps the page
 * in a `<Suspense>` whose fallback is this component, so it must render
 * synchronously — `useTranslations` (not `getTranslations`) for that reason,
 * exactly like `not-found.tsx`. The header and footer keep rendering around it.
 *
 * The skeleton blocks carry no text: the accessible name comes from the status
 * region, and `motion-safe:animate-pulse` means the pulse disappears under
 * `prefers-reduced-motion` (see the escape hatch in `styles/globals.css`).
 */
export default function LocaleLoading(): React.JSX.Element {
  const t = useTranslations("common");

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-24"
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden="true" className="flex flex-col gap-4 motion-safe:animate-pulse">
        <div className="h-9 w-2/3 rounded-md bg-paper-2" />
        <div className="h-4 w-full rounded bg-paper-2" />
        <div className="h-4 w-5/6 rounded bg-paper-2" />
        <div className="h-4 w-4/6 rounded bg-paper-2" />
      </div>
    </div>
  );
}
