import { useTranslations } from "next-intl";

/** The `id` of the page's `<main>` — the skip link's target (app/[locale]/layout.tsx). */
export const MAIN_CONTENT_ID = "main-content";

/**
 * "Skip to main content" — the first focusable element of every page (WCAG
 * 2.4.1). Invisible until focused, then pinned top-left above the sticky
 * header. The target `<main>` carries `tabIndex={-1}` so the jump moves focus,
 * not just the scroll position.
 *
 * A shared (non-async) component: rendered on the server from the locale
 * layout, and testable under `NextIntlClientProvider`.
 */
export function SkipLink({ targetId = MAIN_CONTENT_ID }: { targetId?: string }): React.JSX.Element {
  const t = useTranslations("common");
  return (
    <a
      href={`#${targetId}`}
      className="skip-link sr-only rounded-md bg-accent px-4 py-2 font-medium text-accent-fg shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:tap-target"
    >
      {t("skipLink")}
    </a>
  );
}
