/**
 * A checkup run resumed by a page planned for another scope — client, server
 * and database in one process (`.debug/017` §5.10).
 *
 * What the verification of 2026-10-08 measured on `9ae46bf`, written again for
 * this tree: a saved bike's PARTIAL row reads as a scope naming no part; the
 * wizard resumed an unfinished run with that stored scope and posted it on the
 * next save; both actions re-planned from it, planned no question, and
 * `writeItems` deleted every row of the run (`notIn: []`, which Prisma compiles
 * to `1=1`) — while the chip said "Sauvegardé". And a FULL run opened under
 * `?parts=` was trimmed to that plan in the browser, and the server deleted
 * the rest. Each case below is one of those sequences, through:
 *
 *   - the real page function (`app/[locale]/velo/[id]/controle/page.tsx`), for
 *     the address bar as the wizard left it — what a reload renders;
 *   - the real `Wizard`, rendered in jsdom and driven by clicks;
 *   - the real `saveCheckupAction` and `finishCheckupAction`, SPIED, not
 *     replaced: each call is recorded and goes on to PostgreSQL;
 *   - the `_test` database, which every assertion reads.
 *
 * A save is flushed by `pagehide` — what a browser fires on a reload, and what
 * the wizard listens to — rather than by waiting out the 2 s debounce. A
 * "reload" is: `pagehide`, the flushed save answered, unmount, the page run
 * again for `window.location`, mount again.
 *
 * NOT real: HTTP and the flight serialisation (the props and the payloads are
 * plain JSON, and go through the real zod schemas); Next's router (the
 * wizard's one full navigation, `replaceDocument`, is recorded and the test
 * then opens the address it was handed); the guide bodies (`guideNodes: {}` — the corpus is the frontmatter
 * on disk, as in `tests/integration/checkups.test.ts`); the resume banner's
 * link, read in `components/bike/ResumeBanner.tsx` (no `?parts=` for a saved
 * bike), not rendered. A real browser is `tests/e2e/checkup-resume.spec.ts`.
 *
 * jsdom is installed by hand on the node environment, as in
 * `tests/integration/part-form.test.ts`: a per-file environment docblock would
 * switch Vite to its client transform, where `import "server-only"` does not
 * resolve.
 */
/* eslint-disable security/detect-object-injection -- step keys this file spells out */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  routerSpies,
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const leave = vi.hoisted(() => ({ replaceDocument: vi.fn<(url: string) => void>() }));
vi.mock("@/components/checkup/replace-document", () => leave);

interface Posted {
  action: "save" | "finish";
  scope: unknown;
  answers: string[];
  /** `ok`, or `refused:<code>` — absent while the action has not answered. */
  result?: string;
}
const { posted } = vi.hoisted(() => ({ posted: [] as Posted[] }));

// Spied, NOT replaced.
vi.mock("@/app/[locale]/velo/[id]/controle/actions", async (original) => {
  const real = await original<typeof import("@/app/[locale]/velo/[id]/controle/actions")>();
  const spy =
    (action: Posted["action"], call: (input: unknown) => Promise<{ ok: boolean; code?: string }>) =>
    async (input: unknown) => {
      const copy = structuredClone(input) as { checkup: { scope: unknown; answers: object } };
      const entry: Posted = {
        action,
        scope: copy.checkup.scope,
        answers: Object.keys(copy.checkup.answers).sort(),
      };
      posted.push(entry);
      const result = await call(copy);
      entry.result = result.ok ? "ok" : `refused:${result.code}`;
      return result;
    };
  return {
    ...real,
    saveCheckupAction: spy("save", real.saveCheckupAction),
    finishCheckupAction: spy("finish", real.finishCheckupAction),
  };
});

const dom = await builtinEnvironments.jsdom.setup(globalThis, {
  jsdom: { url: "http://localhost:3100/" },
});
afterAll(async () => {
  await dom.teardown(globalThis);
});

await import("@/tests/setup.dom");
const { act, cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithIntl } = await import("@/tests/_helpers/intl");
const { createElement } = await import("react");

const { default: CheckupPage } = await import("@/app/[locale]/velo/[id]/controle/page");
const { Wizard } = await import("@/components/checkup/Wizard");
const { resetStoredCheckupCache } = await import("@/components/checkup/use-stored-checkup");
const actions = await import("@/app/[locale]/velo/[id]/controle/actions");
const { importGuestState } = await import("@/lib/guest/import");
const { planForBuild } = await import("@/lib/content/checkup-plan");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { checkupKey } = await import("@/lib/bike/storage-keys");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");
const { guestRun, guestWork, partsScope } = await import("@/tests/_helpers/guest-work");

type WizardProps = import("@/components/checkup/Wizard").WizardProps;
type GuestState = import("@/lib/guest/schema").GuestState;

const PAD_WEAR = "check-brakes-disc#pad-wear";
const ALIGNMENT = "check-brakes-disc#caliper-alignment";
const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";

/** The parts the verification's runs picked: the chain and the front caliper. */
const PICKED = "chain,brake-caliper-front";
const PICKED_SCOPE = { kind: "parts", partIds: ["chain", "brake-caliper-front"] };

// ── the bike and the user ────────────────────────────────────────────────────

async function signedInUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: "Camille", locale: "fr" } });
  setSession(sessionFor({ id: user.id, email: user.email, name: user.name, locale: "fr" }));
  return user;
}

async function gravelBike(userId: string): Promise<string> {
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  const bike = await prisma.bike.create({
    data: {
      userId,
      name: "Gravel",
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts as unknown as Prisma.InputJsonValue,
      partStates: { create: derived.parts.map((part) => ({ partId: part.partId })) },
    },
    select: { id: true },
  });
  return bike.id;
}

/** What PostgreSQL holds for the bike's checkups, lines and statuses. */
async function rowsOf(bikeId: string) {
  const checkups = await prisma.checkup.findMany({
    where: { bikeId },
    orderBy: { startedAt: "asc" },
    include: { items: { orderBy: { stepKey: "asc" } } },
  });
  const lines = await prisma.buildListItem.findMany({
    where: { buildList: { bikeId } },
    orderBy: [{ partId: "asc" }, { action: "asc" }],
  });
  const states = await prisma.bikePartState.findMany({
    where: { bikeId, status: { not: "UNKNOWN" } },
    orderBy: { partId: "asc" },
  });
  return {
    checkups: checkups.map((row) => ({
      id: row.id,
      scope: row.scope,
      status: row.status,
      items: row.items.map((item) => `${item.stepKey}=${item.result}@${item.partId}`),
    })),
    lines: lines.map((row) => `${row.action} ${row.partId}${row.done ? ` ${row.doneReason}` : ""}`),
    states: Object.fromEntries(states.map((row) => [row.partId, row.status])),
  };
}

// ── the page, the wizard, a reload ───────────────────────────────────────────

/** The real page, for `bikeParam` and the address bar's query; the Wizard's props out of it. */
async function wizardProps(bikeParam: string): Promise<WizardProps> {
  const query = Object.fromEntries(new URLSearchParams(window.location.search));
  const element = (await CheckupPage({
    params: Promise.resolve({ locale: "fr", id: bikeParam }),
    searchParams: Promise.resolve(query),
  })) as React.ReactElement<{ children?: React.ReactElement<WizardProps> }>;
  // `<ClientMessages><Wizard /></ClientMessages>`: the provider is an async
  // server component, and `renderWithIntl` provides the same messages.
  const child = element.props.children;
  if (child === undefined || child.type !== Wizard) {
    throw new Error("the checkup page did not render the wizard (an empty plan?)");
  }
  return { ...child.props, guideNodes: {} };
}

/** Open the checkup page at `search`, as a browser loads it. */
async function open(bikeParam: string, search = "") {
  window.history.replaceState(
    null,
    "",
    `/fr/velo/${bikeParam}/controle${search === "" ? "" : `?${search}`}`,
  );
  const props = await wizardProps(bikeParam);
  const view = await renderWithIntl(createElement(Wizard, props));
  await settle();
  return { ...view, props };
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Every post so far answered by the real action. */
async function answered(): Promise<void> {
  await waitFor(() => expect(posted.every((entry) => entry.result !== undefined)).toBe(true), {
    timeout: 8000,
    interval: 20,
  });
  await settle();
}

/** `pagehide`: the wizard flushes its pending save — what a reload does first. */
async function pagehide(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
  });
  await answered();
}

/** A reload: `pagehide`, then the page again for the address bar as the wizard left it. */
async function reload(bikeParam: string) {
  await pagehide();
  cleanup();
  resetStoredCheckupCache();
  const search = window.location.search.replace(/^\?/, "");
  return open(bikeParam, search);
}

const phase = (): string | null => screen.getByTestId("checkup-wizard").getAttribute("data-phase");
const onScreen = (): string | null =>
  phase() === "step" ? screen.getByTestId("step-card").getAttribute("data-step-key") : phase();

type Clicker = Awaited<ReturnType<typeof open>>["user"];

/** Past the tool list, if the wizard shows it. */
async function start(user: Clicker): Promise<void> {
  if (phase() === "tools") await user.click(screen.getByTestId("checkup-start"));
}

/** Answer the question on screen: OK, or KO with a symptom. */
async function verdict(user: Clicker, key: string, given: "ok" | { ko: string }): Promise<void> {
  expect(onScreen()).toBe(key);
  if (given === "ok") {
    await user.click(screen.getByTestId("verdict-ok"));
  } else {
    await user.click(screen.getByTestId("verdict-ko"));
    await user.click(screen.getByTestId(`symptom-${given.ko}`));
  }
}

beforeEach(() => {
  posted.length = 0;
  routerSpies.push.mockClear();
  leave.replaceDocument.mockClear();
  window.localStorage.clear();
  resetStoredCheckupCache();
  setRequestHeaders(sameOriginHeaders());
});

afterEach(() => {
  cleanup();
});

// ── a saved bike ─────────────────────────────────────────────────────────────

describe("a saved bike's partial checkup, through the real page, wizard and actions, on PostgreSQL", () => {
  it("(d) the control: answered and finished in one go", async () => {
    const user = await signedInUser("resume-d@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const page = await open(bikeId, `parts=${PICKED}`);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await verdict(page.user, ALIGNMENT, "ok");
    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();

    expect(posted.map((entry) => [entry.action, entry.scope, entry.result])).toEqual([
      ["finish", PICKED_SCOPE, "ok"],
    ]);
    expect(await rowsOf(bikeId)).toEqual({
      checkups: [
        {
          id: expect.any(String),
          scope: "PARTIAL",
          status: "COMPLETED",
          items: [
            `${ALIGNMENT}=OK@brake-caliper-front`,
            `${PAD_WEAR}=KO@brake-caliper-front`,
            `${CHAIN}=KO@chain`,
          ],
        },
      ],
      lines: ["REPLACE brake-pads-front", "REPLACE chain"],
      states: { "brake-caliper-front": "ATTENTION", chain: "ATTENTION" },
    });
  }, 60_000);

  it("(a) one answer, a reload on the same `?parts=`, one more answer, then finished: nothing lost", async () => {
    const user = await signedInUser("resume-a@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, `parts=${PICKED}`);
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });

    page = await reload(bikeId);
    // The address the wizard left: the parts, and the question on screen.
    expect(window.location.search).toContain(`parts=${encodeURIComponent(PICKED)}`);
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([
      `${PAD_WEAR}=KO@brake-caliper-front`,
    ]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    await verdict(page.user, ALIGNMENT, "ok");
    await pagehide();
    // Until 2026-10-22: this save posted `{ kind: "parts", partIds: [] }`,
    // answered ok, and the run's rows went from 1 to 0.
    expect(posted.at(-1)).toMatchObject({ action: "save", scope: PICKED_SCOPE, result: "ok" });
    expect((await rowsOf(bikeId)).checkups[0]).toMatchObject({
      scope: "PARTIAL",
      status: "IN_PROGRESS",
      items: [`${ALIGNMENT}=OK@brake-caliper-front`, `${PAD_WEAR}=KO@brake-caliper-front`],
    });

    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect(posted.at(-1)).toMatchObject({ action: "finish", scope: PICKED_SCOPE, result: "ok" });
    expect(await rowsOf(bikeId)).toEqual({
      checkups: [
        {
          id: expect.any(String),
          scope: "PARTIAL",
          status: "COMPLETED",
          items: [
            `${ALIGNMENT}=OK@brake-caliper-front`,
            `${PAD_WEAR}=KO@brake-caliper-front`,
            `${CHAIN}=KO@chain`,
          ],
        },
      ],
      lines: ["REPLACE brake-pads-front", "REPLACE chain"],
      states: { "brake-caliper-front": "ATTENTION", chain: "ATTENTION" },
    });
    expect(routerSpies.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/velo/[id]/liste" }),
    );
  }, 60_000);

  it("(a2) a reload, then 'Question précédente' only: the stored answer stays", async () => {
    const user = await signedInUser("resume-a2@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, `parts=${PICKED}`);
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });

    page = await reload(bikeId);
    expect(onScreen()).toBe(ALIGNMENT);
    await page.user.click(screen.getByTestId("checkup-back"));
    expect(onScreen()).toBe(PAD_WEAR);
    await pagehide();
    expect(posted.at(-1)).toMatchObject({ action: "save", scope: PICKED_SCOPE, result: "ok" });
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([
      `${PAD_WEAR}=KO@brake-caliper-front`,
    ]);
  }, 60_000);

  it("(b) back through the resume banner: carried on as a full checkup, every answer kept, the visitor told", async () => {
    const user = await signedInUser("resume-b@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, `parts=${PICKED}`);
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();

    // A saved bike's banner links to `/controle` with no query (read in
    // `ResumeBanner`): its row does not say which parts.
    page = await open(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    expect(phase()).toBe("step");
    expect(page.props.steps.length).toBeGreaterThan(20);
    const next = onScreen();
    expect(next).not.toBe(PAD_WEAR);
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();

    expect(posted.at(-1)).toMatchObject({ action: "save", scope: { kind: "full" }, result: "ok" });
    const [run] = (await rowsOf(bikeId)).checkups;
    // The SAME run, both answers in it, and the row says what it now is.
    expect((await rowsOf(bikeId)).checkups).toHaveLength(1);
    expect(run.status).toBe("IN_PROGRESS");
    expect(run.scope).toBe("FULL");
    expect(run.items).toHaveLength(2);
    expect(run.items).toContain(`${PAD_WEAR}=KO@brake-caliper-front`);
  }, 60_000);

  it("(c) an unfinished FULL run opened under `?parts=`: resumed whole, nothing deleted", async () => {
    const user = await signedInUser("resume-c@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId);
    await start(page.user);
    const given: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      given.push(onScreen() ?? "");
      await page.user.click(screen.getByTestId("verdict-ok"));
    }
    await pagehide();
    cleanup();
    expect((await rowsOf(bikeId)).checkups[0].items).toHaveLength(4);

    page = await open(bikeId, "parts=chain");
    // Not "Contrôle partiel" over one question: the run in progress is a full one.
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "fullInProgress");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    expect(posted.at(-1)).toMatchObject({ action: "save", scope: { kind: "full" }, result: "ok" });
    const [run] = (await rowsOf(bikeId)).checkups;
    expect(run).toMatchObject({ scope: "FULL", status: "IN_PROGRESS" });
    expect(run.items).toHaveLength(5);
    for (const key of given)
      expect(run.items.some((item) => item.startsWith(`${key}=OK`))).toBe(true);
  }, 60_000);

  it("(c2) a partial run on the chain, opened on the front caliper: carried on as a full checkup, the chain's answer kept", async () => {
    const user = await signedInUser("resume-c2@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=chain");
    await start(page.user);
    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    // On its summary, unfinished: "Créer ma liste" is not pressed.
    expect(phase()).toBe("summary");
    await pagehide();
    cleanup();

    page = await open(bikeId, "parts=brake-caliper-front");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    const [run] = (await rowsOf(bikeId)).checkups;
    expect(run.scope).toBe("FULL");
    expect(run.items).toContain(`${CHAIN}=KO@chain`);
    expect(run.items).toHaveLength(2);
  }, 60_000);

  it("(c2) a partial run opened on parts that DO ask every question it answered: resumed on those parts", async () => {
    const user = await signedInUser("resume-c2-holds@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=chain,cassette");
    await start(page.user);
    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    await pagehide();
    cleanup();

    page = await open(bikeId, "parts=chain");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.queryByTestId("checkup-resumed")).not.toBeInTheDocument();
    expect(phase()).toBe("summary");
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect(posted.at(-1)).toMatchObject({
      action: "finish",
      scope: { kind: "parts", partIds: ["chain"] },
      result: "ok",
    });
    expect((await rowsOf(bikeId)).checkups[0]).toMatchObject({
      scope: "PARTIAL",
      status: "COMPLETED",
      items: [`${CHAIN}=KO@chain`],
    });
  }, 60_000);

  it("a partial run on the rear caliper, reopened on the FRONT one: resumed there — the pads' answer then counts for the front (pinned as a decision, docs/backlog.md)", async () => {
    // The row does not remember its parts, so nothing tells "the rear caliper"
    // from "the front one" once both ask the pads' question. Resumed on the
    // page's scope, as ruled; the price is in the backlog. Pinned so that a
    // change to it is a decision too.
    const user = await signedInUser("resume-other-side@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([`${PAD_WEAR}=OK@brake-caliper-rear`]);

    page = await open(bikeId, "parts=brake-caliper-front");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.queryByTestId("checkup-resumed")).not.toBeInTheDocument();
    await verdict(page.user, ALIGNMENT, "ok");
    await pagehide();
    expect((await rowsOf(bikeId)).checkups[0]).toMatchObject({
      scope: "PARTIAL",
      items: [`${ALIGNMENT}=OK@brake-caliper-front`, `${PAD_WEAR}=OK@brake-caliper-front`],
    });
  }, 60_000);

  it("an imported unfinished partial checkup is resumed and finished on the account as the SAME row, its answers in it", async () => {
    const user = await signedInUser("resume-import@velo-atelier.test");
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: "11111111-2222-4333-8444-555555555555",
      checkup: (build) =>
        guestRun({
          id: "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90",
          build,
          scope: partsScope("chain", "cassette"),
          verdicts: { [CHAIN]: { ko: ["chain-elongation"], notes: "élongation 0,8 %" } },
          startedAt: "2026-09-14T08:00:00.123Z",
        }),
    });
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const imported = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    expect(imported.ok).toBe(true);
    if (!imported.ok || imported.data.bikeId === null) return;
    const bikeId = imported.data.bikeId;
    const [before] = (await rowsOf(bikeId)).checkups;
    expect(before).toMatchObject({
      scope: "PARTIAL",
      status: "IN_PROGRESS",
      items: [`${CHAIN}=KO@chain`],
    });

    // The account's banner: no `?parts=`. The rest of the questions, OK.
    const page = await open(bikeId);
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    for (let guard = 0; guard < 80 && phase() === "step"; guard += 1) {
      // The chain's question comes round with the guest's KO on it: given
      // again, as a visitor moving on past it would.
      if (screen.getByTestId("verdict-bar").getAttribute("data-verdict") === "ko") {
        await verdict(page.user, CHAIN, { ko: "chain-elongation" });
      } else {
        await page.user.click(screen.getByTestId("verdict-ok"));
      }
    }
    expect(phase()).toBe("summary");
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();

    const after = await rowsOf(bikeId);
    expect(after.checkups).toHaveLength(1);
    expect(after.checkups[0].id).toBe(before.id);
    expect(after.checkups[0]).toMatchObject({ scope: "FULL", status: "COMPLETED" });
    expect(after.checkups[0].items).toContain(`${CHAIN}=KO@chain`);
    expect(after.checkups[0].items).toHaveLength(page.props.steps.length);
    const chain = await prisma.checkupItem.findFirstOrThrow({
      where: { checkupId: before.id, stepKey: CHAIN },
    });
    expect(chain).toMatchObject({ notes: "élongation 0,8 %", reasonKeys: ["chain-elongation"] });
    expect(after.lines).toEqual(["REPLACE chain"]);
  }, 60_000);

  it("a run this bug emptied (PARTIAL, IN_PROGRESS, no item) saves and finishes like any other", async () => {
    // What production may hold: the run a destructive save left behind. It is
    // the bike's run in progress, so every later `/controle` resumes it.
    const user = await signedInUser("resume-emptied@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const emptied = await prisma.checkup.create({
      data: { bikeId, scope: "PARTIAL", startedAt: new Date("2026-10-20T08:00:00.000Z") },
    });

    const page = await open(bikeId, "parts=chain");
    await start(page.user);
    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect(posted.map((entry) => [entry.action, entry.scope, entry.result])).toEqual([
      ["finish", { kind: "parts", partIds: ["chain"] }, "ok"],
    ]);
    expect(await rowsOf(bikeId)).toEqual({
      checkups: [
        { id: emptied.id, scope: "PARTIAL", status: "COMPLETED", items: [`${CHAIN}=KO@chain`] },
      ],
      lines: ["REPLACE chain"],
      states: { chain: "ATTENTION" },
    });
  }, 60_000);
});

describe("what an old tab still posts (§5.10, S2/S4)", () => {
  /** The payload production's bundle posts for a resumed partial run. */
  function oldTabPayload(answers: Record<string, string>, startedAt: string) {
    return {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "demo" },
      scope: { kind: "parts", partIds: [] },
      locale: "fr",
      answers,
      symptoms: {},
      notes: {},
      toolsMissing: [],
      startedAt,
      contentVersion: CONTENT_VERSION,
    };
  }

  it("a parts scope naming no part is refused on save and on finish, and nothing is deleted or written", async () => {
    const user = await signedInUser("old-tab@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const startedAt = "2026-10-20T08:00:00.000Z";
    expect(
      await actions.saveCheckupAction({
        bikeId,
        checkup: {
          ...oldTabPayload({ [CHAIN]: "ko" }, startedAt),
          scope: { kind: "parts", partIds: ["chain"] },
        },
      }),
    ).toEqual({ ok: true, data: null });
    const before = await rowsOf(bikeId);
    expect(before.checkups[0].items).toEqual([`${CHAIN}=KO@chain`]);

    const old = oldTabPayload({ [CHAIN]: "ko", [CASSETTE]: "ok" }, startedAt);
    expect(await actions.saveCheckupAction({ bikeId, checkup: old })).toEqual({
      ok: false,
      code: "VALIDATION",
    });
    expect(
      await actions.finishCheckupAction({
        bikeId,
        checkup: { ...old, completedAt: "2026-10-20T08:10:00.000Z" },
      }),
    ).toEqual({ ok: false, code: "VALIDATION" });
    expect(await rowsOf(bikeId)).toEqual(before);
  });

  it("an old tab's FULL run trimmed to a partial page keeps, on the server, the answers it no longer sends", async () => {
    // Variant (c) in a bundle of before the fix: the browser trimmed the run to
    // the partial page's plan and posts `scope: full` with what is left.
    const user = await signedInUser("old-tab-c@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const startedAt = "2026-10-20T08:00:00.000Z";
    const whole = {
      ...oldTabPayload({ [CHAIN]: "ok", [CASSETTE]: "ok", [PAD_WEAR]: "ok" }, startedAt),
      scope: { kind: "full" },
    };
    expect((await actions.saveCheckupAction({ bikeId, checkup: whole })).ok).toBe(true);

    const trimmed = {
      ...whole,
      answers: { [CHAIN]: "ko" },
      symptoms: { [CHAIN]: ["chain-elongation"] },
    };
    expect(
      (
        await actions.finishCheckupAction({
          bikeId,
          checkup: { ...trimmed, completedAt: "2026-10-20T08:10:00.000Z" },
        })
      ).ok,
    ).toBe(true);
    const after = await rowsOf(bikeId);
    const [run] = after.checkups;
    expect(run).toMatchObject({ scope: "FULL", status: "COMPLETED" });
    expect(run.items).toEqual([
      `${PAD_WEAR}=OK@brake-caliper-front`,
      `${CASSETTE}=OK@cassette`,
      `${CHAIN}=KO@chain`,
    ]);
    // And the finish is the RUN's, not the trimmed payload's: the stored OKs
    // write their statuses beside the chain's KO.
    expect(after.states).toEqual({
      "brake-caliper-front": "OK",
      "brake-caliper-rear": "OK",
      cassette: "OK",
      chain: "ATTENTION",
    });
    expect(after.lines).toEqual(["REPLACE chain"]);
  });
});

// ── a guest bike ─────────────────────────────────────────────────────────────

describe("a guest's run, in localStorage, through the real page and wizard", () => {
  const stored = () =>
    JSON.parse(window.localStorage.getItem(checkupKey("demo")) ?? "null") as {
      id: string;
      scope: unknown;
      answers: Record<string, string>;
    } | null;

  it("(a) a reload on the same `?parts=`: both answers kept, the scope the page's", async () => {
    let page = await open("demo", `parts=${PICKED}`);
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    page = await reload("demo");
    await verdict(page.user, ALIGNMENT, "ok");
    await pagehide();
    expect(stored()).toMatchObject({
      scope: PICKED_SCOPE,
      answers: { [PAD_WEAR]: "ko", [ALIGNMENT]: "ok" },
    });
  }, 60_000);

  it("(c) a FULL run opened under `?parts=`: the wizard goes to the full checkup and trims nothing", async () => {
    let page = await open("demo");
    await start(page.user);
    for (let index = 0; index < 3; index += 1)
      await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    const before = window.localStorage.getItem(checkupKey("demo"));
    expect(Object.keys(stored()?.answers ?? {})).toHaveLength(3);
    cleanup();
    resetStoredCheckupCache();

    page = await open("demo", "parts=chain");
    expect(phase()).toBe("resuming");
    expect(leave.replaceDocument).toHaveBeenCalledWith("/fr/velo/demo/controle?resume=full");
    await pagehide();
    // Until 2026-10-22 the run was reconciled to the chain's one question and
    // its three answers written back without the other two.
    expect(window.localStorage.getItem(checkupKey("demo"))).toBe(before);
    cleanup();
    resetStoredCheckupCache();

    // Where the router was sent.
    page = await open("demo", "resume=full");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "fullInProgress");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    expect(Object.keys(stored()?.answers ?? {})).toHaveLength(4);
    expect(stored()?.scope).toEqual({ kind: "full" });
  }, 60_000);

  it("(c2) a run on the chain, opened on the front caliper: the full checkup, the chain's answer kept", async () => {
    let page = await open("demo", "parts=chain");
    await start(page.user);
    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    await pagehide();
    cleanup();
    resetStoredCheckupCache();

    page = await open("demo", "parts=brake-caliper-front");
    expect(leave.replaceDocument).toHaveBeenCalledWith("/fr/velo/demo/controle?resume=full");
    cleanup();
    resetStoredCheckupCache();
    page = await open("demo", "resume=full");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    expect(stored()?.answers[CHAIN]).toBe("ko");
    expect(stored()?.scope).toEqual({ kind: "full" });
  }, 60_000);

  it("an old guest state with a stale scope (R1) is read safely: the full checkup, every answer kept", async () => {
    // What the wizard of before 2026-10-22 left: a run opened on the chain,
    // carried on through "Contrôle complet", stored under its first scope.
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const full = planForBuild({ spec: derived.spec, parts: derived.parts }, { kind: "full" });
    const brakes = full
      .filter((step) => step.guideSlug === "check-brakes-disc")
      .map((step) => step.key);
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify({
        version: 1,
        id: "44444444-4444-4444-8444-444444444444",
        bikeRef: { kind: "demo" },
        scope: { kind: "parts", partIds: ["chain"] },
        locale: "fr",
        answers: Object.fromEntries([CHAIN, ...brakes].map((key) => [key, "ok"])),
        symptoms: {},
        notes: {},
        toolsMissing: [],
        startedAt: "2026-10-01T08:00:00.000Z",
        contentVersion: CONTENT_VERSION,
      }),
    );
    const raw = window.localStorage.getItem(checkupKey("demo"));

    await open("demo", "parts=chain");
    expect(phase()).toBe("resuming");
    expect(leave.replaceDocument).toHaveBeenCalledWith("/fr/velo/demo/controle?resume=full");
    expect(window.localStorage.getItem(checkupKey("demo"))).toBe(raw);
    cleanup();
    resetStoredCheckupCache();
    const page = await open("demo", "resume=full");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    expect(Object.keys(stored()?.answers ?? {})).toHaveLength(brakes.length + 2);
  }, 60_000);
});
