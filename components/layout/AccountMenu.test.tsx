/**
 * The header's account control (§4.3, §6.5).
 *
 * Why this component exists at all is the thing being protected here:
 * `SiteHeader` is a server component that reads **no request API**, which is
 * what keeps `/`, `/guides/[slug]` and `/velo/demo` statically rendered
 * (§6.8 AC2). The session therefore arrives in the browser, and that has three
 * consequences this file pins:
 *
 * 1. while `status` is `"loading"` the menu must render its **anonymous** state
 *    — the same markup the server produced, so hydration matches;
 * 2. the `callbackUrl` on the sign-in link must be the URL the browser is on
 *    (`/en/bike/demo`), not the internal `/velo/[id]` template;
 * 3. the menu is the WAI-ARIA menu-button pattern by hand — `aria-expanded`,
 *    `aria-controls`, Escape closes and returns focus — with no dependency on
 *    `components/ui/**`.
 *
 * `next-auth/react` is stubbed rather than wrapped in a real `SessionProvider`:
 * a real one fetches `/api/auth/session`, and msw is configured with
 * `onUnhandledRequest: 'error'`.
 */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

interface FakeSessionState {
  data: { user: { id: string; email: string; name: string | null; locale: "fr" | "en" } } | null;
  status: "authenticated" | "unauthenticated" | "loading";
}

const sessionState: FakeSessionState = { data: null, status: "unauthenticated" };

const getSessionMock = vi.fn(async (params?: { broadcast?: boolean }) => {
  void params; // recorded by the spy; the assertion is on the argument, not the answer
  return sessionState.data;
});

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
  getSession: (params?: { broadcast?: boolean }) => getSessionMock(params),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// The sign-out button posts to a server action; in jsdom the module would be
// really evaluated and pull in `server-only` and `@/auth`. See SignUpForm.test.tsx.
vi.mock("@/app/[locale]/(auth)/connexion/actions", () => ({
  loginAction: vi.fn(),
  googleSignInAction: vi.fn(),
  signOutAction: vi.fn(async () => ({ ok: true, data: true })),
}));

// The shared `@/lib/i18n/navigation` fake (tests/setup.ts) renders a `<Link>`'s
// pathname only and drops its `query` — harmless everywhere else, but the
// `callbackUrl` IS the thing under test here. This override adds the query and
// changes nothing else.
vi.mock("@/lib/i18n/navigation", async () => {
  const { createElement } = await import("react");
  const fakes = await import("@/tests/_fakes/session");
  const base = fakes.i18nNavigationModule(createElement as never);
  return {
    ...base,
    Link: ({
      href,
      locale,
      children,
      ...rest
    }: {
      href: string | { pathname: string; params?: Record<string, string>; query?: unknown };
      locale?: string;
      children?: React.ReactNode;
      [prop: string]: unknown;
    }) => {
      const path = fakes.i18nTarget(href, locale);
      const query =
        typeof href === "object" && href.query
          ? `?${new URLSearchParams(href.query as Record<string, string>).toString()}`
          : "";
      return createElement("a", { ...rest, href: `${path}${query}` }, children);
    },
  };
});

const { AccountMenu } = await import("./AccountMenu");

function signIn(name: string | null = "Camille"): void {
  sessionState.data = {
    user: { id: "00000000-0000-4000-8000-000000000101", email: "demo@velo-atelier.test", name },
  } as FakeSessionState["data"];
  sessionState.status = "authenticated";
}

function signOut(status: "unauthenticated" | "loading" = "unauthenticated"): void {
  sessionState.data = null;
  sessionState.status = status;
}

describe("AccountMenu", () => {
  beforeEach(() => {
    signOut();
    setNavigationState({ pathname: "/fr" });
    getSessionMock.mockClear();
  });

  describe("anonymous", () => {
    it("offers a sign-in link carrying the current page as callbackUrl", async () => {
      setNavigationState({ pathname: "/en/bike/demo" });
      await renderWithIntl(<AccountMenu />);

      const link = screen.getByTestId("account-sign-in");
      expect(link).toHaveTextContent("Connexion");
      // The *browser's* path, not the internal `/velo/[id]` template.
      expect(link).toHaveAttribute("href", "/connexion?callbackUrl=%2Fen%2Fbike%2Fdemo");
    });

    it("renders the anonymous state while the session is still loading", async () => {
      signOut("loading");
      await renderWithIntl(<AccountMenu />);

      expect(screen.getByTestId("account-sign-in")).toBeInTheDocument();
      expect(screen.queryByTestId("account-menu-button")).toBeNull();
    });

    it("meets the 44 px tap target", async () => {
      await renderWithIntl(<AccountMenu />);

      expect(screen.getByTestId("account-sign-in")).toHaveClass("tap-target");
    });

    it("speaks English on the English pages", async () => {
      await renderWithIntl(<AccountMenu />, { locale: "en" });

      expect(screen.getByTestId("account-sign-in")).toHaveTextContent("Sign in");
    });
  });

  describe("signed in", () => {
    beforeEach(() => {
      signIn();
    });

    it("shows Mes vélos and a closed menu button labelled with the account name", async () => {
      await renderWithIntl(<AccountMenu />);

      expect(screen.getByTestId("account-my-bikes")).toHaveAttribute("href", "/mes-velos");

      const button = screen.getByTestId("account-menu-button");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).toHaveAttribute("aria-haspopup", "menu");
      expect(button).toHaveAccessibleName("Ouvrir le menu du compte");
      expect(button).toHaveTextContent("Camille");
    });

    it("falls back to the e-mail address when the account has no name", async () => {
      signIn(null);
      await renderWithIntl(<AccountMenu />);

      expect(screen.getByTestId("account-menu-button")).toHaveTextContent("demo@velo-atelier.test");
    });

    it("opens the menu and exposes Compte and Déconnexion", async () => {
      const { user } = await renderWithIntl(<AccountMenu />);

      await user.click(screen.getByTestId("account-menu-button"));

      const button = screen.getByTestId("account-menu-button");
      expect(button).toHaveAttribute("aria-expanded", "true");

      const menu = screen.getByRole("menu", { name: "Mon compte" });
      expect(button.getAttribute("aria-controls")).toBe(menu.id);
      expect(within(menu).getByTestId("account-link")).toHaveAttribute("href", "/compte");
      expect(within(menu).getByTestId("sign-out")).toHaveTextContent("Se déconnecter");
      expect(within(menu).getByText("Connecté en tant que Camille")).toBeInTheDocument();
    });

    it("closes on Escape and returns focus to the button", async () => {
      const { user } = await renderWithIntl(<AccountMenu />);
      const button = screen.getByTestId("account-menu-button");

      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");

      await user.keyboard("{Escape}");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).toHaveFocus();
    });

    it("closes when a click lands outside it", async () => {
      const { user } = await renderWithIntl(
        <div>
          <AccountMenu />
          <button type="button">elsewhere</button>
        </div>,
      );

      await user.click(screen.getByTestId("account-menu-button"));
      await user.click(screen.getByRole("button", { name: "elsewhere" }));

      expect(screen.getByTestId("account-menu-button")).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps the menu hidden from the accessibility tree while closed", async () => {
      await renderWithIntl(<AccountMenu />);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("translates the whole menu", async () => {
      const { user } = await renderWithIntl(<AccountMenu />, { locale: "en" });

      await user.click(screen.getByTestId("account-menu-button"));
      const menu = screen.getByRole("menu", { name: "My account" });
      expect(within(menu).getByTestId("account-link")).toHaveTextContent("Account");
      expect(within(menu).getByTestId("sign-out")).toHaveTextContent("Sign out");
    });
  });
});

/**
 * The bug this pins: `SessionProvider` fetches the session once, when it
 * mounts, and signing in is a server action that redirects with the **client**
 * router — so the provider never unmounts, never re-fetches, and the header
 * kept offering "Connexion" to a visitor who had just signed in, until a full
 * page reload (`tests/e2e/auth-login.spec.ts` is where it surfaced).
 *
 * The menu therefore re-reads the session itself on every route change, and
 * `broadcast: false` is load-bearing: the default would also wake the provider
 * through its BroadcastChannel and fetch the same thing twice.
 */
describe("staying in step with the session", () => {
  beforeEach(() => {
    signOut();
    setNavigationState({ pathname: "/fr/connexion" });
    getSessionMock.mockClear();
  });

  it("does not fetch again on the page it was mounted on", async () => {
    await renderWithIntl(<AccountMenu />);

    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("re-reads the session after a client-side navigation, with one request", async () => {
    const { rerender } = await renderWithIntl(<AccountMenu />);
    expect(screen.getByTestId("account-sign-in")).toBeInTheDocument();

    // The sign-in action redirected: same provider, new URL, new session.
    signIn();
    setNavigationState({ pathname: "/fr/mes-velos" });
    rerender(<AccountMenu />);

    expect(await screen.findByTestId("account-menu-button")).toBeInTheDocument();
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock).toHaveBeenCalledWith({ broadcast: false });
  });

  it("drops back to the anonymous state when the session has gone", async () => {
    signIn();
    const { rerender } = await renderWithIntl(<AccountMenu />);
    expect(screen.getByTestId("account-menu-button")).toBeInTheDocument();

    // Signing out redirects to the home page of the current locale, while the
    // provider still holds its stale, signed-in answer.
    sessionState.data = null;
    setNavigationState({ pathname: "/fr" });
    rerender(<AccountMenu />);

    expect(await screen.findByTestId("account-sign-in")).toBeInTheDocument();
  });
});
