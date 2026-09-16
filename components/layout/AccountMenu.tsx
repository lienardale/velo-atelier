"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogIn, UserRound } from "lucide-react";
import { getSession, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useTranslations } from "next-intl";
import { usePathname as useRawPathname } from "next/navigation";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { Link, usePathname } from "@/lib/i18n/navigation";

/**
 * The header's account control (§6.5).
 *
 * Signed in: "Mes vélos" plus a menu button (Compte / Déconnexion).
 * Anonymous: a "Connexion" link carrying the current page as `?callbackUrl=`.
 *
 * ## Why a client island
 *
 * `SiteHeader` is a server component that reads **no request API**, which is what
 * keeps `/`, `/guides/[slug]` and `/velo/demo` statically rendered (§6.8 AC2).
 * Calling `auth()` in it would opt every one of those pages out of static
 * rendering. So the session is fetched in the browser through `useSession()`
 * (`SessionProvider` lives in `app/[locale]/layout.tsx`), and until it arrives
 * the menu renders its anonymous state — the same HTML the server produced, so
 * hydration matches.
 *
 * ## Why the session is re-read on every navigation
 *
 * `SessionProvider` fetches `/api/auth/session` **once, when it mounts**, and
 * then only on a storage/broadcast event, a tab focus or a poll. Signing in is
 * a server action that redirects with the client router, so the provider never
 * unmounts and never re-fetches: the visitor landed on `/fr/mes-velos` signed
 * in while the header still offered "Connexion", until a full page reload.
 * (`useSession().update()` is no help — it is a POST that re-runs the `jwt`
 * callback with `trigger: 'update'`, and it returns early when the client has
 * no session yet, which is exactly this case.)
 *
 * So a route change re-reads the session with `getSession()`, which is the same
 * cheap GET the provider makes. `broadcast: false` keeps it to ONE request: the
 * default would also wake the provider through its BroadcastChannel and fetch a
 * second time. The provider's value is still what the first paint uses, so the
 * initial page costs exactly one fetch, as before.
 *
 * ## Why the raw pathname
 *
 * `callbackUrl` must be the URL the browser is actually on — `/en/bike/demo`,
 * not the internal `/velo/[id]` template — so this is the one place that reads
 * `usePathname()` from `next/navigation` instead of `@/lib/i18n/navigation`.
 * next-intl's version is still used for the `<Link>`s, so the localized paths
 * stay in `routing.pathnames`.
 *
 * ## Why not a library dropdown
 *
 * The menu is a `<button aria-expanded aria-controls>` and a `<ul role="menu">`
 * closed by Escape, by a click outside, and by any navigation. That is the whole
 * WAI-ARIA menu-button pattern, in forty lines, with no dependency on
 * `components/ui/**` — which W1-T5 generates in parallel with this task.
 */
export function AccountMenu(): React.JSX.Element {
  const t = useTranslations("auth.menu");
  const { data: providerSession, status: providerStatus } = useSession();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const internalPathname = usePathname();
  const rawPathname = useRawPathname();

  // `undefined` = "the provider's answer is still the freshest one we have".
  const [refreshed, setRefreshed] = useState<Session | null | undefined>(undefined);
  const navigated = useRef(false);

  useEffect(() => {
    // The first render is the provider's own fetch; only later routes need one.
    if (!navigated.current) {
      navigated.current = true;
      return;
    }
    let alive = true;
    void getSession({ broadcast: false }).then((next) => {
      if (alive) setRefreshed(next);
    });
    return () => {
      alive = false;
    };
  }, [rawPathname]);

  const session = refreshed === undefined ? providerSession : refreshed;
  const status =
    refreshed === undefined ? providerStatus : refreshed ? "authenticated" : "unauthenticated";

  // Any navigation closes the menu — the panel must not survive the page it
  // belongs to. Adjusted during render (React's documented "derive state from
  // props" pattern) rather than in an effect, which would cost an extra render
  // pass on every route change.
  const [lastPathname, setLastPathname] = useState(internalPathname);
  if (lastPathname !== internalPathname) {
    setLastPathname(internalPathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (status !== "authenticated" || !session?.user) {
    const callbackUrl = rawPathname && rawPathname.startsWith("/") ? rawPathname : undefined;
    return (
      <Link
        href={callbackUrl ? { pathname: "/connexion", query: { callbackUrl } } : "/connexion"}
        data-testid="account-sign-in"
        className="tap-target rounded-md text-sm font-medium text-ink-muted hover:bg-paper-2 hover:text-ink sm:px-3"
      >
        {/* Below sm the header has no room for the label (320 px, §6.5): icon only,
            the text stays for screen readers. */}
        <LogIn aria-hidden="true" className="size-5 sm:hidden" />
        <span className="sr-only sm:not-sr-only">{t("signIn")}</span>
      </Link>
    );
  }

  const label = session.user.name ?? session.user.email ?? "";

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      <Link
        href="/mes-velos"
        data-testid="account-my-bikes"
        className="tap-target hidden rounded-md px-3 text-sm font-medium text-ink-muted hover:bg-paper-2 hover:text-ink sm:inline-flex"
      >
        {t("myBikes")}
      </Link>

      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("open")}
        data-testid="account-menu-button"
        onClick={() => setOpen((shown) => !shown)}
        className="tap-target rounded-md text-sm font-medium text-ink hover:bg-paper-2 sm:px-2"
      >
        <UserRound aria-hidden="true" className="size-5 sm:hidden" />
        <span aria-hidden="true" className="hidden max-w-24 truncate sm:inline">
          {label}
        </span>
      </button>

      <ul
        id={menuId}
        role="menu"
        aria-label={t("label")}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-rule bg-paper p-1 shadow-lg"
      >
        <li role="none" className="px-3 py-2 text-xs text-ink-muted">
          {t("signedInAs", { name: label })}
        </li>
        <li role="none" className="sm:hidden">
          <Link
            href="/mes-velos"
            role="menuitem"
            className="tap-target w-full justify-start rounded-md px-3 text-sm font-medium text-ink hover:bg-paper-2"
          >
            {t("myBikes")}
          </Link>
        </li>
        <li role="none">
          <Link
            href="/compte"
            role="menuitem"
            data-testid="account-link"
            className="tap-target w-full justify-start rounded-md px-3 text-sm font-medium text-ink hover:bg-paper-2"
          >
            {t("account")}
          </Link>
        </li>
        <li role="none">
          <SignOutButton />
        </li>
      </ul>
    </div>
  );
}
