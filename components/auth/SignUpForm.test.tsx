/**
 * The sign-up form (§4.3, §6.2, §4.8 AC5).
 *
 * The server action is stubbed: in the browser `signUpAction` is a network
 * reference, and in jsdom the real module would be evaluated — dragging in
 * `server-only` (only Next's bundler resolves it) and `next-auth/lib/env.js`
 * (which imports `next/server`, a specifier Node cannot resolve because `next`
 * ships no `exports` map). What is under test here is the form, not the action;
 * the action has its own tests in `tests/security/` and `tests/integration/`.
 *
 * The assertions that matter are the mobile and accessibility contract (§4.3
 * "Mobile"), and the one rule the whole client/server split rests on: **the
 * submit button is never disabled on password strength.** The meter is
 * advisory; `lib/auth/password-policy.ts` decides. A disabled button would hide
 * the server's reason from exactly the people who need it.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

const signUpAction = vi.fn(async () => ({ ok: true as const, data: false }));

vi.mock("@/app/[locale]/(auth)/inscription/actions", () => ({ signUpAction }));

const { SignUpForm } = await import("./SignUpForm");

const emailInput = () => screen.getByLabelText("Adresse e-mail");
const passwordInput = () => screen.getByLabelText("Mot de passe");

describe("SignUpForm", () => {
  it("posts to the sign-up action with the locale as a hidden input", async () => {
    const { container } = await renderWithIntl(<SignUpForm locale="fr" />);

    const form = screen.getByTestId("sign-up-form");
    expect(form).toBeInTheDocument();
    expect(container.querySelector('input[name="locale"]')).toHaveValue("fr");
    // No callbackUrl was given, so no hidden input is rendered at all — an empty
    // one would be a redirect target the server then has to reject.
    expect(container.querySelector('input[name="callbackUrl"]')).toBeNull();
  });

  it("carries a callbackUrl through when the page was reached with one", async () => {
    const { container } = await renderWithIntl(
      <SignUpForm locale="fr" callbackUrl="/fr/mes-velos" />,
    );

    expect(container.querySelector('input[name="callbackUrl"]')).toHaveValue("/fr/mes-velos");
  });

  it("gives the e-mail field the mobile keyboard and autofill contract", async () => {
    await renderWithIntl(<SignUpForm locale="fr" />);

    const email = emailInput();
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("inputMode", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    // 16 px text, or iOS zooms the page on focus.
    expect(email).toHaveClass("text-base");
  });

  it("asks password managers for a NEW password, not the current one", async () => {
    await renderWithIntl(<SignUpForm locale="fr" />);

    expect(passwordInput()).toHaveAttribute("autocomplete", "new-password");
    expect(passwordInput()).toHaveAttribute("type", "password");
  });

  it("keeps submit enabled with an empty form — the server decides, not the meter", async () => {
    await renderWithIntl(<SignUpForm locale="fr" />);

    expect(screen.getByRole("button", { name: "Créer mon compte" })).toBeEnabled();
  });

  it("keeps submit enabled even while the meter is failing every rule", async () => {
    const { user } = await renderWithIntl(<SignUpForm locale="fr" />);

    await user.type(passwordInput(), "velo");

    expect(document.querySelector('[data-rule="length"]')).toHaveAttribute(
      "data-satisfied",
      "false",
    );
    expect(screen.getByRole("button", { name: "Créer mon compte" })).toBeEnabled();
  });

  it("shows the strength meter and points the password input at it", async () => {
    const { user } = await renderWithIntl(<SignUpForm locale="fr" />);

    const meter = screen.getByTestId("password-strength");
    const describedBy = passwordInput().getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toContain(meter.id);

    await user.type(passwordInput(), "Guidon-Tandem-47!");
    expect(document.querySelector('[data-rule="classes"]')).toHaveAttribute(
      "data-satisfied",
      "true",
    );
  });

  it("feeds the typed address to the meter, so the e-mail rule can fail", async () => {
    const { user } = await renderWithIntl(<SignUpForm locale="fr" />);

    await user.type(emailInput(), "camille.demo@velo-atelier.test");
    await user.type(passwordInput(), "Camille.Demo-2026!");

    expect(document.querySelector('[data-rule="email"]')).toHaveAttribute(
      "data-satisfied",
      "false",
    );
  });

  it("toggles password visibility without losing what was typed", async () => {
    const { user } = await renderWithIntl(<SignUpForm locale="fr" />);

    await user.type(passwordInput(), "Guidon-Tandem-47!");
    const toggle = screen.getByRole("button", { name: "Afficher le mot de passe" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(passwordInput()).toHaveAttribute("type", "text");
    expect(passwordInput()).toHaveValue("Guidon-Tandem-47!");
    expect(screen.getByRole("button", { name: "Masquer le mot de passe" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reserves a live region for the form-level error even when there is none", async () => {
    await renderWithIntl(<SignUpForm locale="fr" />);

    const alert = screen.getByTestId("form-error");
    expect(alert).toHaveAttribute("aria-live", "polite");
    expect(alert).toHaveClass("sr-only");
    expect(alert).toBeEmptyDOMElement();
  });

  it("renders in English with the English labels", async () => {
    await renderWithIntl(<SignUpForm locale="en" />, { locale: "en" });

    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create my account" })).toBeEnabled();
  });
});
