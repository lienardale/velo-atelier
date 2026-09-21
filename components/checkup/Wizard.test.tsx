/**
 * The wizard, end to end in a DOM (§6.5).
 *
 * The e2e suite drives the real page; this drives the component with a plan of
 * three hand-shaped questions, which is what makes the awkward paths cheap to
 * assert: a KO that stays put until a symptom is chosen, a "2" typed into a
 * note, a checkup restored from `localStorage`, a save that fails.
 *
 * The server actions are mocked away: this tier has no database, and the ones
 * that matter (`finishCheckupAction` and friends) have their own security and
 * integration tests.
 */
import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkupKey, buildListKey } from "@/lib/bike/storage-keys";
import { toStored } from "@/lib/checkup/storage";
import type { StoredCheckup } from "@/lib/checkup/storage";
import { makeState, threeStepPlan } from "@/tests/_helpers/checkup";
import { renderWithIntl } from "@/tests/_helpers/intl";
import { routerSpies } from "@/tests/_fakes/session";

vi.mock("@/app/[locale]/velo/[id]/controle/actions", () => ({
  loadCheckupAction: vi.fn(async () => ({ ok: true, data: null })),
  saveCheckupAction: vi.fn(async () => ({ ok: true, data: null })),
  listCheckupsAction: vi.fn(async () => ({ ok: true, data: [] })),
  finishCheckupAction: vi.fn(async () => ({ ok: true, data: { buildListId: "list" } })),
}));

const { Wizard } = await import("./Wizard");
const { resetStoredCheckupCache } = await import("./use-stored-checkup");

const PLAN = threeStepPlan();
const [PADS, CALIPER, CHAIN] = PLAN;

const GUIDE_NODES: Record<string, React.ReactNode> = {
  "check-brakes-disc": <p data-testid="guide-brakes">Le corps du guide freins</p>,
  "check-drivetrain": <p data-testid="guide-drivetrain">Le corps du guide transmission</p>,
};

const GUIDE_REFS = {
  "check-brakes-disc": { title: "Contrôler des freins à disque", stub: false },
  "replace-chain": { title: "Changer une chaîne", stub: false },
  "clean-chain": { title: "Nettoyer une chaîne", stub: true },
  "replace-brake-pads-disc": { title: "Changer des plaquettes", stub: false },
  "adjust-disc-caliper-alignment": { title: "Aligner un étrier", stub: false },
};

function wizard(overrides: Partial<React.ComponentProps<typeof Wizard>> = {}) {
  return (
    <Wizard
      locale="fr"
      bikeRef={{ kind: "demo" }}
      bikeParam="demo"
      scope={{ kind: "full" }}
      steps={PLAN}
      guideNodes={GUIDE_NODES}
      guideRefs={GUIDE_REFS}
      tools={[{ toolId: "chain-checker", alternatives: ["steel-ruler"] }]}
      contentVersion="content-v1"
      newCheckupId="11111111-1111-4111-8111-111111111111"
      initialStored={null}
      initialStepKey={null}
      specCode={null}
      {...overrides}
    />
  );
}

function stored(): StoredCheckup | null {
  const raw = window.localStorage.getItem(checkupKey("demo"));
  return raw === null ? null : (JSON.parse(raw) as StoredCheckup);
}

beforeEach(() => {
  window.localStorage.clear();
  resetStoredCheckupCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the tool list comes first", () => {
  it("shows the plan's tools, and only starts when the visitor says so", async () => {
    const { user } = await renderWithIntl(wizard());

    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "tools");
    expect(screen.getByTestId("tool-checklist")).toBeInTheDocument();
    expect(screen.queryByTestId("step-card")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("checkup-start"));
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", PADS.key);
  });

  it("remembers a tool the visitor does not have, and the step offers the stand-in", async () => {
    const { user } = await renderWithIntl(
      wizard({
        steps: [{ ...PADS, tools: [{ toolId: "chain-checker", alternatives: ["steel-ruler"] }] }],
      }),
    );

    await user.click(screen.getByTestId("tool-missing-chain-checker"));
    await waitFor(() => expect(stored()?.toolsMissing).toEqual(["chain-checker"]));

    await user.click(screen.getByTestId("checkup-start"));
    expect(screen.getByTestId("tool-substitution")).toHaveTextContent("Réglet métallique");
  });

  it("goes straight to the question a `?step=` link names", async () => {
    await renderWithIntl(wizard({ initialStepKey: CHAIN.key }));
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "step");
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN.key);
  });
});

describe("answering", () => {
  it("shows one step of the right guide, and moves on when it is fine", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));

    expect(screen.getByTestId("guide-brakes")).toBeInTheDocument();
    expect(screen.queryByTestId("guide-drivetrain")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("verdict-ok"));
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CALIPER.key);
    await waitFor(() => expect(stored()?.answers[PADS.key]).toBe("ok"));
  });

  it("stays on a KO until a symptom is chosen, and then moves on", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: CHAIN.key }));

    await user.click(screen.getByTestId("verdict-ko"));
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN.key);
    expect(screen.getByTestId("symptom-picker")).toBeInTheDocument();

    await user.click(screen.getByTestId("symptom-chain-elongation"));
    await waitFor(() => expect(stored()?.symptoms[CHAIN.key]).toEqual(["chain-elongation"]));
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "summary");
  });

  it("keeps a note without touching the verdict", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: CHAIN.key }));

    await user.click(screen.getByTestId("verdict-ko"));
    await user.type(screen.getByTestId("symptom-note"), "2");

    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN.key);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
    await waitFor(() => expect(stored()?.notes[CHAIN.key]).toBe("2"));
  });

  it("skips a question the author allowed, and refuses one they did not", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));

    await user.click(screen.getByTestId("verdict-skip"));
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CALIPER.key);

    await user.click(screen.getByTestId("verdict-ok"));
    // The chain question is not skippable: it says so instead of showing a
    // button that does nothing.
    expect(screen.queryByTestId("verdict-skip")).not.toBeInTheDocument();
    expect(screen.getByTestId("verdict-required")).toBeInTheDocument();
  });

  it("goes back to the previous question", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));

    expect(screen.getByTestId("checkup-back")).toBeDisabled();
    await user.click(screen.getByTestId("verdict-ok"));
    await user.click(screen.getByTestId("checkup-back"));
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", PADS.key);
  });
});

describe("the keyboard", () => {
  it("answers with 1, 2 and 3", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));

    await user.keyboard("1");
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CALIPER.key);

    await user.keyboard("2");
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");

    // "3" skips, which is a verdict like any other: it is recorded and the
    // wizard moves on, so the bar now shows the NEXT question's (none).
    await user.keyboard("3");
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CHAIN.key);
    await waitFor(() => expect(stored()?.answers[CALIPER.key]).toBe("skipped"));
  });

  it("does nothing while the visitor is typing, or with a modifier held", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: CHAIN.key }));

    await user.click(screen.getByTestId("verdict-ko"));
    const note = screen.getByTestId("symptom-note");
    await user.click(note);
    await user.keyboard("1");

    expect(note).toHaveValue("1");
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");

    await user.click(document.body);
    await user.keyboard("{Meta>}1{/Meta}");
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
  });
});

describe("the summary", () => {
  const finished = toStored(
    makeState(PLAN, {
      answers: { [PADS.key]: "ko", [CALIPER.key]: "ok", [CHAIN.key]: "skipped" },
      symptoms: { [PADS.key]: ["pad-worn"] },
    }),
  );

  it("restores a checkup from storage and lands on the summary", async () => {
    window.localStorage.setItem(checkupKey("demo"), JSON.stringify(finished));
    await renderWithIntl(wizard());

    await waitFor(() =>
      expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "summary"),
    );
    expect(screen.getByTestId("summary-counts")).toHaveTextContent("1 ok");
  });

  it("writes the derived list and goes to it", async () => {
    window.localStorage.setItem(checkupKey("demo"), JSON.stringify(finished));
    const { user } = await renderWithIntl(wizard());

    await waitFor(() => expect(screen.getByTestId("summary-create")).toBeEnabled());
    await user.click(screen.getByTestId("summary-create"));

    await waitFor(() => {
      const raw = window.localStorage.getItem(buildListKey("demo"));
      expect(raw).not.toBeNull();
      const list = JSON.parse(raw ?? "{}") as { items: { partId: string; action: string }[] };
      expect(list.items).toEqual([
        expect.objectContaining({ partId: "brake-pads-front", action: "replace" }),
      ]);
    });
    expect(routerSpies.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/velo/[id]/liste", params: { id: "demo" } }),
    );
  });

  it("jumps back to a question from the summary", async () => {
    window.localStorage.setItem(checkupKey("demo"), JSON.stringify(finished));
    const { user } = await renderWithIntl(wizard());

    await waitFor(() => expect(screen.getByTestId("checkup-summary")).toBeInTheDocument());
    await user.click(screen.getByTestId(`summary-edit-${CALIPER.key}`));
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CALIPER.key);
  });
});

describe("saving", () => {
  it("says so once the answer is written", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));

    await user.click(screen.getByTestId("verdict-ok"));
    await waitFor(() =>
      expect(screen.getByTestId("checkup-save-state")).toHaveAttribute("data-state", "saved"),
    );
    expect(screen.getByTestId("checkup-save-state")).toHaveTextContent("Sauvegardé");
  });

  it("admits it when the browser refuses to store anything", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));

    await user.click(screen.getByTestId("verdict-ok"));
    await waitFor(() =>
      expect(screen.getByTestId("checkup-save-state")).toHaveAttribute("data-state", "error"),
    );
    setItem.mockRestore();
  });
});

describe("a saved bike", () => {
  it("renders the row the server read, without waiting for storage", async () => {
    const fromServer: StoredCheckup = {
      ...toStored(
        makeState(PLAN, {
          bikeRef: { kind: "db", id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
          answers: { [PADS.key]: "ok" },
        }),
      ),
    };

    await renderWithIntl(
      wizard({
        bikeRef: { kind: "db", id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
        bikeParam: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        initialStored: fromServer,
      }),
    );

    // Already past the tool list, on the first question still open.
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "step");
    expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", CALIPER.key);
    // And nothing was written to the guest key.
    expect(window.localStorage.getItem(checkupKey("demo"))).toBeNull();
  });
});

describe("the checkup after a finished one (§4.2 c, §5.4)", () => {
  // The server knows a run by its `startedAt` (`existingCheckup`,
  // `controle/actions.ts`). A new checkup that inherited the finished one's was
  // written INTO it: its verdicts overwritten by the first autosave, the lines
  // of its list deleted instead of closed `recheck-ok` (§5.4), and never a
  // second row for the §4.2 (c) quotas to count.
  const BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const NOW = "2026-10-01T09:00:00.000Z";
  const finished: StoredCheckup = toStored(
    makeState(PLAN, {
      id: "22222222-2222-4222-8222-222222222222",
      bikeRef: { kind: "db", id: BIKE },
      answers: { [PADS.key]: "ko", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
      symptoms: { [PADS.key]: ["pad-worn"] },
      completedAt: "2026-09-19T08:30:00.000Z",
    }),
  );

  /** What "Créer ma liste" sent, once every question of the run on screen is OK. */
  async function finishEverythingOk(user: UserEvent): Promise<StoredCheckup> {
    const { finishCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
    for (const step of PLAN) {
      expect(screen.getByTestId("step-card")).toHaveAttribute("data-step-key", step.key);
      // Nothing is answered in THIS run: not the finished run's verdict.
      expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "none");
      await user.click(screen.getByTestId("verdict-ok"));
    }
    await user.click(screen.getByTestId("summary-create"));
    await waitFor(() => expect(finishCheckupAction).toHaveBeenCalledTimes(1));
    const [{ checkup }] = vi.mocked(finishCheckupAction).mock.calls[0] as [
      { checkup: StoredCheckup },
    ];
    return checkup;
  }

  it("starts a NEW run: its own id and its own startedAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
    const { user } = await renderWithIntl(
      wizard({ bikeRef: { kind: "db", id: BIKE }, bikeParam: BIKE, initialStored: finished }),
    );

    // History, not something to resume: a new checkup, from its tool list.
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "tools");
    await user.click(screen.getByTestId("checkup-start"));

    expect(await finishEverythingOk(user)).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: NOW,
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
    });
  });

  it("opens the NEW run on the question `?step=` names, never the finished one", async () => {
    // After a finished checkup the only URL that carries `?step=` is the new
    // run's own — the wizard writes it for the question on screen — so a reload
    // before the new run's first save lands here.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
    const { user } = await renderWithIntl(
      wizard({
        bikeRef: { kind: "db", id: BIKE },
        bikeParam: BIKE,
        initialStored: finished,
        initialStepKey: PADS.key,
      }),
    );

    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "step");
    expect(await finishEverythingOk(user)).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: NOW,
    });
  });
});

describe("a refused finish (§4.2 c)", () => {
  const BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const answered: StoredCheckup = toStored(
    makeState(PLAN, {
      bikeRef: { kind: "db", id: BIKE },
      answers: { [PADS.key]: "ko", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
      symptoms: { [PADS.key]: ["pad-worn"] },
    }),
  );

  async function pressCreate() {
    const view = await renderWithIntl(
      wizard({ bikeRef: { kind: "db", id: BIKE }, bikeParam: BIKE, initialStored: answered }),
    );
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "summary");
    await view.user.click(screen.getByTestId("summary-create"));
    return view;
  }

  it("says which limit refused it, stays on the summary and goes nowhere", async () => {
    const { finishCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
    vi.mocked(finishCheckupAction).mockResolvedValueOnce({
      ok: false,
      code: "TOO_MANY",
      fieldErrors: { form: "checkup.finish.tooManyLists" },
    });

    await pressCreate();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "checkup-finish-error");
    expect(alert).toHaveTextContent("Ce vélo a déjà 10 listes");
    expect(routerSpies.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "summary");
    // The visitor can try again (after deleting a list, or by redoing it by part).
    expect(screen.getByTestId("summary-create")).toBeEnabled();
  });

  it("still says so when the refusal names no limit it knows", async () => {
    const { finishCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
    vi.mocked(finishCheckupAction).mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });

    await pressCreate();

    expect(await screen.findByRole("alert")).toHaveTextContent("La liste n'a pas pu être créée");
    expect(routerSpies.push).not.toHaveBeenCalled();
  });

  it("goes to the list, with no alert, when the server accepts", async () => {
    await pressCreate();

    await waitFor(() =>
      expect(routerSpies.push).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/velo/[id]/liste", params: { id: BIKE } }),
      ),
    );
    expect(screen.queryByTestId("checkup-finish-error")).not.toBeInTheDocument();
  });
});
