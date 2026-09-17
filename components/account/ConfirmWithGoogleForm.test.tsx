import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

vi.mock("@/app/[locale]/(protected)/compte/actions", () => ({
  reauthenticateWithGoogleAction: vi.fn(async () => ({ ok: true, data: true })),
}));

const { ConfirmWithGoogleForm } = await import("./ConfirmWithGoogleForm");

describe("ConfirmWithGoogleForm", () => {
  it("explains why and offers to confirm with Google (FR)", async () => {
    await renderWithIntl(<ConfirmWithGoogleForm />);
    expect(screen.getByText(/confirmez d’abord votre identité avec Google/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer avec Google" })).toBeInTheDocument();
  });

  it("reserves the error region for a failed Google round trip", async () => {
    await renderWithIntl(<ConfirmWithGoogleForm />);
    expect(screen.getByTestId("confirm-with-google-error")).toBeEmptyDOMElement();
  });
});
