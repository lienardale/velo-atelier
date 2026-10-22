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
import { scopeFacts } from "@/lib/checkup/scope";
import { toStored } from "@/lib/checkup/storage";
import type { StoredCheckup } from "@/lib/checkup/storage";
import type { CheckupScope } from "@/lib/checkup/types";
import { makeState, threeStepPlan } from "@/tests/_helpers/checkup";
import { renderWithIntl } from "@/tests/_helpers/intl";
import { routerSpies } from "@/tests/_fakes/session";

const leave = vi.hoisted(() => ({ replaceDocument: vi.fn<(url: string) => void>() }));
vi.mock("./replace-document", () => leave);

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

describe("a question a partial checkup asks for some of the parts it names (§5.11)", () => {
  const REAR_PADS = {
    ...PADS,
    partIds: ["brake-caliper-rear"],
    coveredParts: ["brake-pads-rear"],
  } as typeof PADS;

  it("says, under the question and on the summary, which parts its verdict counts for", async () => {
    const { user } = await renderWithIntl(
      wizard({ scope: { kind: "parts", partIds: ["brake-caliper-rear"] }, steps: [REAR_PADS] }),
    );
    await user.click(screen.getByTestId("checkup-start"));
    expect(screen.getByTestId("verdict-covered")).toHaveTextContent(
      "Contrôle partiel — votre réponse ne comptera que pour : Plaquettes ou patins arrière.",
    );
    await user.click(screen.getByTestId("verdict-ok"));
    expect(screen.getByTestId("summary-covered")).toHaveTextContent(
      "Ne compte que pour : Plaquettes ou patins arrière",
    );
  });

  it("says it in English too", async () => {
    const { user } = await renderWithIntl(
      wizard({
        locale: "en",
        scope: { kind: "parts", partIds: ["brake-caliper-rear"] },
        steps: [REAR_PADS],
      }),
      { locale: "en" },
    );
    await user.click(screen.getByTestId("checkup-start"));
    expect(screen.getByTestId("verdict-covered")).toHaveTextContent(
      "Partial checkup — your answer will count only for: Rear pads.",
    );
  });

  it("says nothing for a question recorded whole", async () => {
    const { user } = await renderWithIntl(wizard({ initialStepKey: PADS.key }));
    expect(screen.queryByTestId("verdict-covered")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("verdict-ok"));
    await user.click(screen.getByTestId("verdict-ok"));
    await user.click(screen.getByTestId("verdict-ok"));
    expect(screen.getByTestId("checkup-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("summary-covered")).not.toBeInTheDocument();
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

/**
 * An unfinished run, resumed by a page planned for another scope (`.debug/017`
 * §5.10, §5.12). The page's scope wins when it holds the run — asks every
 * answer about what it was given for; when it does not, a guest's run goes
 * back to its own parts, or on to the full checkup when that asks every answer
 * about what it was given for, and is never trimmed. Hand-shaped plans: the
 * real page, actions and database are `tests/integration/checkup-resume.test.ts`.
 */
describe("an unfinished run, resumed (§5.10, §5.12)", () => {
  const BIKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const CHAIN_ONLY = { kind: "parts" as const, partIds: ["chain" as const] };
  const FRONT_CALIPER = { kind: "parts" as const, partIds: ["brake-caliper-front" as const] };
  /** What the page hands down with the chain alone: the full plan's keys, and nothing withheld. */
  const CHAIN_FACTS = scopeFacts(CHAIN_ONLY, PLAN, [CHAIN]);
  /** The front pads' question, asked for some of the parts it names. */
  const NARROWED_PADS = { ...PADS, coveredParts: ["brake-pads-front"] } as typeof PADS;

  const partialRun = (
    answers: Record<string, "ok" | "ko">,
    scope: CheckupScope = CHAIN_ONLY,
  ): StoredCheckup => toStored(makeState(PLAN, { scope, answers }));

  it("resumes a partial run on the page's scope, and saves THAT scope — never the one it was stored with", async () => {
    // A saved bike's PARTIAL row reads as a scope naming no part: the payload
    // a resumed run posted with it until 2026-10-22 planned no question, and
    // the server deleted every stored answer.
    const { saveCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
    vi.mocked(saveCheckupAction).mockClear();
    const fromServer: StoredCheckup = {
      ...partialRun({ [CHAIN.key]: "ko" }, { kind: "parts", partIds: [] } as never),
      bikeRef: { kind: "db", id: BIKE },
    };
    const { user } = await renderWithIntl(
      wizard({
        bikeRef: { kind: "db", id: BIKE },
        bikeParam: BIKE,
        scope: CHAIN_ONLY,
        steps: [CHAIN],
        scopeFacts: CHAIN_FACTS,
        initialStored: fromServer,
      }),
    );
    expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "summary");
    expect(screen.queryByTestId("checkup-resumed")).not.toBeInTheDocument();
    await user.click(screen.getByTestId(`summary-edit-${CHAIN.key}`));
    await user.click(screen.getByTestId("verdict-ok"));
    await waitFor(() => expect(saveCheckupAction).toHaveBeenCalled(), { timeout: 4000 });
    const [{ checkup }] = vi.mocked(saveCheckupAction).mock.calls.at(-1) as [
      { checkup: StoredCheckup },
    ];
    expect(checkup.scope).toEqual(CHAIN_ONLY);
    expect(checkup.answers).toEqual({ [CHAIN.key]: "ok" });
  });

  it("does not restore a guest's partial run opened on other parts: it goes back to its own parts, and writes nothing", async () => {
    // Opened on the brakes, answered there; then "check this part" on the chain.
    const stored = partialRun({ [PADS.key]: "ko" }, FRONT_CALIPER);
    const raw = JSON.stringify(stored);
    window.localStorage.setItem(checkupKey("demo"), raw);
    leave.replaceDocument.mockClear();
    await renderWithIntl(wizard({ scope: CHAIN_ONLY, steps: [CHAIN], scopeFacts: CHAIN_FACTS }));

    await waitFor(() =>
      expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "resuming"),
    );
    expect(screen.getByTestId("checkup-resuming")).toHaveTextContent(
      "Reprise du contrôle en cours",
    );
    expect(screen.queryByTestId("verdict-bar")).not.toBeInTheDocument();
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=brake-caliper-front&resume=own",
    );
    // The pads' answer is still in storage, byte for byte.
    expect(window.localStorage.getItem(checkupKey("demo"))).toBe(raw);
  });

  it("takes a guest's partial run opened on the FULL page back to its own parts too — and keeps `?spec=`", async () => {
    // Until 2026-10-22's second fix it was carried on as a full checkup right
    // there, and an answer given for the front pads counted for both.
    window.localStorage.setItem(
      checkupKey("local"),
      JSON.stringify({
        ...partialRun({ [PADS.key]: "ok" }, FRONT_CALIPER),
        bikeRef: { kind: "local" },
      }),
    );
    leave.replaceDocument.mockClear();
    await renderWithIntl(
      wizard({ bikeRef: { kind: "local" }, bikeParam: "local", specCode: "abc" }),
    );
    await waitFor(() =>
      expect(leave.replaceDocument).toHaveBeenCalledWith(
        "/fr/velo/local/controle?spec=abc&parts=brake-caliper-front&resume=own",
      ),
    );
  });

  it("back on its own parts, stays there when an answer counts for some of its question's parts — and says so", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(partialRun({ [PADS.key]: "ko" }, FRONT_CALIPER)),
    );
    leave.replaceDocument.mockClear();
    await renderWithIntl(
      wizard({
        scope: FRONT_CALIPER,
        steps: [NARROWED_PADS],
        scopeFacts: scopeFacts(FRONT_CALIPER, PLAN, [NARROWED_PADS]),
        resumedOwn: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "ownParts"),
    );
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Un contrôle limité à : Étrier de frein avant est déjà en cours sur ce vélo. Il reprend ici, sur ces pièces, avec vos réponses, qui ne comptent que pour elles.",
    );
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(leave.replaceDocument).not.toHaveBeenCalled();
    expect(stored()?.answers).toEqual({ [PADS.key]: "ko" });
  });

  it("says it in English too", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(partialRun({ [PADS.key]: "ko" }, FRONT_CALIPER)),
    );
    await renderWithIntl(
      wizard({
        locale: "en",
        scope: FRONT_CALIPER,
        steps: [NARROWED_PADS],
        scopeFacts: scopeFacts(FRONT_CALIPER, PLAN, [NARROWED_PADS]),
        resumedOwn: true,
      }),
      { locale: "en" },
    );
    await waitFor(() =>
      expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
        "A checkup limited to: Front brake caliper is already under way on this bike.",
      ),
    );
  });

  it("back on its own parts, goes on to the full checkup when every answer was given whole", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(partialRun({ [CHAIN.key]: "ko" })),
    );
    leave.replaceDocument.mockClear();
    await renderWithIntl(
      wizard({ scope: CHAIN_ONLY, steps: [CHAIN], scopeFacts: CHAIN_FACTS, resumedOwn: true }),
    );
    await waitFor(() =>
      expect(leave.replaceDocument).toHaveBeenCalledWith("/fr/velo/demo/controle?resume=full"),
    );
  });

  it("goes to the full checkup from a page that withholds a symptom a KO was given with", async () => {
    // `scopeFacts` says the front caliper's pads question no longer offers the
    // KO's symptom: resumed there, the next save would drop it.
    const run = toStored(
      makeState(PLAN, {
        scope: FRONT_CALIPER,
        answers: { [PADS.key]: "ko" },
        symptoms: { [PADS.key]: ["pad-worn"] },
      }),
    );
    window.localStorage.setItem(checkupKey("demo"), JSON.stringify(run));
    leave.replaceDocument.mockClear();
    await renderWithIntl(
      wizard({
        scope: FRONT_CALIPER,
        steps: [NARROWED_PADS],
        scopeFacts: {
          asked: PLAN.map((step) => step.key),
          touched: [],
          withheld: { [PADS.key]: ["pad-worn"] },
        },
      }),
    );
    await waitFor(() =>
      expect(leave.replaceDocument).toHaveBeenCalledWith("/fr/velo/demo/controle?resume=full"),
    );
  });

  it("does not narrow a FULL run with answers into a partial page either, and keeps `?spec=`", async () => {
    window.localStorage.setItem(
      checkupKey("local"),
      JSON.stringify({
        ...toStored(makeState(PLAN, { answers: { [CHAIN.key]: "ok" } })),
        bikeRef: { kind: "local" },
      }),
    );
    leave.replaceDocument.mockClear();
    await renderWithIntl(
      wizard({
        bikeRef: { kind: "local" },
        bikeParam: "local",
        specCode: "abc",
        scope: CHAIN_ONLY,
        steps: [CHAIN],
        scopeFacts: CHAIN_FACTS,
      }),
    );
    await waitFor(() =>
      expect(leave.replaceDocument).toHaveBeenCalledWith(
        "/fr/velo/local/controle?spec=abc&resume=full",
      ),
    );
  });

  it("is not sent anywhere by an answer to a question the corpus dropped, nor by an OK to one its parts only touch", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(
        partialRun({ [CHAIN.key]: "ko", "check-retired#gone": "ok", [PADS.key]: "ok" } as never),
      ),
    );
    leave.replaceDocument.mockClear();
    await renderWithIntl(
      wizard({
        scope: CHAIN_ONLY,
        steps: [CHAIN],
        // The pads' question is one the planner of before 2026-10-22 asked here.
        scopeFacts: { ...CHAIN_FACTS, touched: [PADS.key] },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "summary"),
    );
    expect(leave.replaceDocument).not.toHaveBeenCalled();
  });

  it("carries a partial run on as a full checkup when the page came back with `?resume=full`, and says what that means", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(partialRun({ [CHAIN.key]: "ko" })),
    );
    const { user } = await renderWithIntl(wizard({ resumeWidened: true }));
    await waitFor(() =>
      expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull"),
    );
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Il reprend ici en contrôle complet, avec toutes vos réponses",
    );
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    // Every answer kept, and the run stored as what it now is.
    await user.click(screen.getByTestId("verdict-ok"));
    await waitFor(() => expect(stored()?.scope).toEqual({ kind: "full" }));
    expect(stored()?.answers).toMatchObject({ [CHAIN.key]: "ko", [PADS.key]: "ok" });
  });

  it("names the questions whose answers now count for every part they name — a saved bike's banner", async () => {
    const fromServer: StoredCheckup = {
      ...partialRun({ [PADS.key]: "ko", [CHAIN.key]: "ok" }, {
        kind: "parts",
        partIds: [],
      } as never),
      bikeRef: { kind: "db", id: BIKE },
    };
    await renderWithIntl(
      wizard({ bikeRef: { kind: "db", id: BIKE }, bikeParam: BIKE, initialStored: fromServer }),
    );
    // The pads' question names a caliper and its pads; the chain's names the chain alone.
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Celles déjà données à ces questions, qui nomment plusieurs pièces, comptent désormais pour chacune d'elles — vérifiez-les : « Mesurer l’usure des plaquettes ».",
    );
  });

  it("names them in English too", async () => {
    const fromServer: StoredCheckup = {
      ...partialRun({ [PADS.key]: "ko" }, { kind: "parts", partIds: [] } as never),
      bikeRef: { kind: "db", id: BIKE },
    };
    await renderWithIntl(
      wizard({
        locale: "en",
        bikeRef: { kind: "db", id: BIKE },
        bikeParam: BIKE,
        initialStored: fromServer,
      }),
      { locale: "en" },
    );
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Your answers to these questions, which name several parts, now count for each of them — check them: “Mesurer l’usure des plaquettes”.",
    );
  });

  it("says a full run carries on when the page came back with `?resume=full`", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(toStored(makeState(PLAN, { answers: { [CHAIN.key]: "ok" } }))),
    );
    await renderWithIntl(wizard({ resumeWidened: true }), { locale: "en" });
    await waitFor(() =>
      expect(screen.getByTestId("checkup-resumed")).toHaveAttribute(
        "data-notice",
        "fullInProgress",
      ),
    );
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "A full checkup is already under way on this bike",
    );
  });

  it("says nothing on a full page that resumes a full run of its own", async () => {
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify(toStored(makeState(PLAN, { answers: { [CHAIN.key]: "ok" } }))),
    );
    await renderWithIntl(wizard());
    await waitFor(() =>
      expect(screen.getByTestId("checkup-wizard")).toHaveAttribute("data-phase", "step"),
    );
    expect(screen.queryByTestId("checkup-resumed")).not.toBeInTheDocument();
  });
});
