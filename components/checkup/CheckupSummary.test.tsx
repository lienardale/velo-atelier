import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { summarySections } from "@/lib/checkup/selectors";
import { makeState, threeStepPlan } from "@/tests/_helpers/checkup";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { CheckupSummary } from "./CheckupSummary";

const PLAN = threeStepPlan();
const [PADS, CALIPER, CHAIN] = PLAN;

const ANSWERED = makeState(PLAN, {
  answers: { [PADS.key]: "ko", [CALIPER.key]: "ok", [CHAIN.key]: "skipped" },
});

function summary(overrides: Partial<React.ComponentProps<typeof CheckupSummary>> = {}) {
  return (
    <CheckupSummary
      sections={summarySections(ANSWERED)}
      counts={{ ok: 1, ko: 1, skipped: 1 }}
      open={[]}
      onEdit={vi.fn()}
      onCreate={vi.fn()}
      creating={false}
      {...overrides}
    />
  );
}

describe("CheckupSummary", () => {
  it("groups the questions by verdict and counts them", async () => {
    await renderWithIntl(summary());

    expect(within(screen.getByTestId("summary-group-ko")).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByTestId("summary-group-ok")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("summary-counts")).toHaveTextContent("1 ok · 1 à reprendre");
  });

  it("lets a verdict be changed", async () => {
    const onEdit = vi.fn();
    const { user } = await renderWithIntl(summary({ onEdit }));

    await user.click(screen.getByTestId(`summary-edit-${PADS.key}`));
    expect(onEdit).toHaveBeenCalledWith(PADS.key);
  });

  it("refuses to create a list while a question has no verdict", async () => {
    const onCreate = vi.fn();
    const { user } = await renderWithIntl(summary({ open: [CHAIN], onCreate }));

    expect(screen.getByTestId("summary-open")).toHaveTextContent(
      "Il reste 1 question sans réponse",
    );
    const button = screen.getByTestId("summary-create");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("creates the list once everything has a verdict", async () => {
    const onCreate = vi.fn();
    const { user } = await renderWithIntl(summary({ onCreate }));

    await user.click(screen.getByTestId("summary-create"));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("says the bike passed when nothing needs doing", async () => {
    const allFine = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
    });
    await renderWithIntl(
      summary({ sections: summarySections(allFine), counts: { ok: 3, ko: 0, skipped: 0 } }),
    );

    expect(screen.getByTestId("summary-nothing-to-do")).toBeInTheDocument();
  });

  it("says a group is empty rather than leaving a heading dangling", async () => {
    const onlyKo = makeState(PLAN, { answers: { [PADS.key]: "ko" } });
    await renderWithIntl(
      summary({
        sections: summarySections(onlyKo),
        counts: { ok: 0, ko: 1, skipped: 0 },
        open: [CALIPER, CHAIN],
      }),
    );

    expect(
      within(screen.getByTestId("summary-group-ok")).getByText(
        "Aucune question dans cette catégorie.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("summary-open")).toHaveTextContent("Il reste 2 questions");
  });
});
