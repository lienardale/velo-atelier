import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import enTree from "@/messages/en/decision-tree.json";
import frTree from "@/messages/fr/decision-tree.json";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import { routerSpies } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { Summary, type LoadLocalBike } from "./Summary";

const ANSWERS = { ...answerWithDefaults({ drive: "electric", discipline: "mtb" }) };

function loader(existing: boolean, written: unknown = {}) {
  const writeLocalBike = vi.fn(() => written);
  const hasLocalBike = vi.fn(() => existing);
  return {
    load: vi.fn(async () => ({ writeLocalBike, hasLocalBike })) as unknown as LoadLocalBike,
    writeLocalBike,
  };
}

async function renderSummary(options: { locale?: "fr" | "en"; load?: LoadLocalBike } = {}) {
  const onEdit = vi.fn();
  const result = await renderWithIntl(
    <Summary
      answers={ANSWERS}
      guessed={["e-motor"]}
      onEdit={onEdit}
      headingId="summary-title"
      headingRef={() => {}}
      loadLocalBike={options.load}
    />,
    { locale: options.locale },
  );
  return { ...result, onEdit };
}

describe("Summary", () => {
  it("lists every question asked of this bike, electric ones included", async () => {
    await renderSummary();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.dataset.question)).toEqual(Object.keys(ANSWERS));
    expect(rows.find((row) => row.dataset.question === "e-battery")).toHaveTextContent(
      frTree.questions["e-battery"],
    );
    expect(screen.getAllByTestId("default-badge")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "summary-title");
  });

  it("each row has a named 44 px edit button", async () => {
    const { user, onEdit } = await renderSummary({ locale: "en" });
    const edit = screen.getByRole("button", { name: "Change: Motor" });
    expect(edit).toHaveClass("tap-target");
    await user.click(edit);
    expect(onEdit).toHaveBeenCalledWith("e-motor");
    expect(screen.getByRole("button", { name: enTree.summary.generate })).toBeVisible();
  });

  it("writes the bike with exactly the answers and navigates to the local bike", async () => {
    const fake = loader(false);
    const { user } = await renderSummary({ load: fake.load });
    await user.click(screen.getByRole("button", { name: frTree.summary.generate }));
    await waitFor(() => expect(routerSpies.push).toHaveBeenCalled());
    expect(fake.writeLocalBike).toHaveBeenCalledWith({ answers: ANSWERS });
  });

  it("closes the replace dialog with Escape without writing", async () => {
    const fake = loader(true);
    const { user } = await renderSummary({ load: fake.load });
    await user.click(screen.getByRole("button", { name: frTree.summary.generate }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleDescription(frTree.summary.replace.description);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fake.writeLocalBike).not.toHaveBeenCalled();
  });
});
