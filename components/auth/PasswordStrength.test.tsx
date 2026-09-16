/**
 * The live password meter (§4.3, §6.5).
 *
 * Two things are being pinned here, and neither of them is "zxcvbn works":
 *
 * 1. **The checklist is synchronous and always present.** It comes from
 *    `lib/auth/password-strength.ts`, which has no dependencies, so it renders
 *    on the first keystroke whatever happens to the dynamic import. A meter
 *    that shows nothing until a 400 kB chunk arrives is a meter nobody reads.
 * 2. **The score is advisory and arrives late.** Until zxcvbn resolves,
 *    `aria-valuenow` is 0 and there is no `aria-valuetext` — the component must
 *    not claim a verdict it has not computed.
 *
 * The real `@zxcvbn-ts/*` packages are used (they are already installed and the
 * check is synchronous once loaded); only the debounce is driven by fake timers,
 * so the test does not spend 180 ms per assertion.
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { PasswordStrength } from "./PasswordStrength";

const meter = () => screen.getByRole("progressbar", { name: "Robustesse du mot de passe" });

function ruleState(id: "length" | "classes" | "whitespace" | "email"): string | null {
  const item = document.querySelector(`[data-rule="${id}"]`);
  return item?.getAttribute("data-satisfied") ?? null;
}

describe("PasswordStrength", () => {
  it("renders the four rules, all unsatisfied, for an empty password", async () => {
    await renderWithIntl(<PasswordStrength password="" />);

    expect(screen.getByTestId("password-strength")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-rule]")).toHaveLength(4);
    expect(ruleState("length")).toBe("false");
    expect(ruleState("classes")).toBe("false");
    expect(ruleState("whitespace")).toBe("false");
    // Nothing to contain the address yet, so rule 4 starts satisfied.
    expect(ruleState("email")).toBe("true");
  });

  it("shows no score until zxcvbn has answered", async () => {
    await renderWithIntl(<PasswordStrength password="Guidon-Tandem-47" />);

    // Synchronously after render the dynamic import has not resolved.
    expect(meter()).toHaveAttribute("aria-valuenow", "0");
    expect(meter()).not.toHaveAttribute("aria-valuetext");
    expect(meter()).toHaveAttribute("data-score", "");
  });

  it("scores a strong passphrase and announces the verdict in French", async () => {
    await renderWithIntl(<PasswordStrength password="Guidon-Tandem-47!" />);

    await waitFor(
      () => {
        expect(meter()).toHaveAttribute("data-score", "4");
      },
      { timeout: 5000 },
    );
    expect(meter()).toHaveAttribute("aria-valuenow", "4");
    expect(meter()).toHaveAttribute("aria-valuetext", "Excellent");
    expect(meter()).toHaveAttribute("aria-valuemax", "4");
  });

  it("satisfies every syntactic rule for that same passphrase", async () => {
    await renderWithIntl(<PasswordStrength password="Guidon-Tandem-47!" />);

    expect(ruleState("length")).toBe("true");
    expect(ruleState("classes")).toBe("true");
    expect(ruleState("whitespace")).toBe("true");
    expect(ruleState("email")).toBe("true");
  });

  it("fails the length and class rules for a short, one-class password", async () => {
    await renderWithIntl(<PasswordStrength password="velo" />);

    expect(ruleState("length")).toBe("false");
    expect(ruleState("classes")).toBe("false");
  });

  it("fails the whitespace rule for a padded password", async () => {
    await renderWithIntl(<PasswordStrength password=" Guidon-Tandem-47! " />);

    expect(ruleState("whitespace")).toBe("false");
  });

  it("fails the e-mail rule when the password contains the local part", async () => {
    await renderWithIntl(
      <PasswordStrength password="Camille.Demo-2026!" email="camille.demo@velo-atelier.test" />,
    );

    expect(ruleState("email")).toBe("false");
  });

  it("uses the id the password input points at, so aria-describedby resolves", async () => {
    await renderWithIntl(<PasswordStrength password="" describedById="pw-meter" />);

    expect(screen.getByTestId("password-strength")).toHaveAttribute("id", "pw-meter");
  });

  it("labels the rules in English too", async () => {
    await renderWithIntl(<PasswordStrength password="velo" />, { locale: "en" });

    expect(screen.getByText("At least 12 characters")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Password strength" })).toBeInTheDocument();
  });
});
