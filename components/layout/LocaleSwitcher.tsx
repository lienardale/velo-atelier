"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";

type Query = Record<string, string | string[]>;

/**
 * The current query string as a next-intl `query` object — every key kept, in
 * order, repeated keys as arrays (`?parts=a&parts=b` → `{ parts: ['a','b'] }`).
 * Read from `window.location` at click time rather than `useSearchParams()`,
 * which would opt every static page that renders the header out of static
 * rendering (a `useSearchParams` consumer needs a `<Suspense>` boundary).
 */
export function queryFromSearch(search: string): Query {
  const query = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = query.get(key);
    query.set(
      key,
      existing === undefined
        ? value
        : Array.isArray(existing)
          ? [...existing, value]
          : [existing, value],
    );
  }
  return Object.fromEntries(query);
}

/**
 * FR / EN toggle, present on every route (header and footer).
 *
 * Switching keeps the visitor on the same page: the internal pathname
 * (`usePathname()` → `/velo/[id]/controle`), the route params (`useParams()`,
 * minus `locale`) and the whole query go to `router.replace(…, { locale })`,
 * which resolves the other locale's localized path (`/en/bike/demo/checkup`)
 * and syncs the `NEXT_LOCALE` cookie.
 */
export function LocaleSwitcher({ className = "" }: { className?: string }): React.JSX.Element {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    const routeParams = Object.fromEntries(
      Object.entries(params ?? {}).filter(([key]) => key !== "locale"),
    );
    const query = queryFromSearch(window.location.search);
    startTransition(() => {
      router.replace(
        // `pathname` and `params` both describe the current route, so they always
        // match; next-intl cannot prove that statically for a dynamic pair.
        { pathname, params: routeParams, query } as Parameters<typeof router.replace>[0],
        { locale: next, scroll: false },
      );
    });
  }

  return (
    <div
      role="group"
      aria-label={t("localeSwitcher.label")}
      aria-busy={isPending || undefined}
      className={`inline-flex items-center rounded-md border border-rule p-0.5 ${className}`}
    >
      {routing.locales.map((option) => {
        const current = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-current={current ? "true" : undefined}
            onClick={() => switchTo(option)}
            className={`tap-target rounded-[calc(var(--radius-md)-2px)] px-2 text-sm font-semibold tracking-wide transition-colors ${
              current
                ? "bg-accent text-accent-fg"
                : "text-ink-muted hover:bg-paper-2 hover:text-ink"
            }`}
          >
            <span aria-hidden="true">{option.toUpperCase()}</span>
            <span className="sr-only">{t(`localeNames.${option}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
