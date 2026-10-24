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
const { buildListKey, checkupKey } = await import("@/lib/bike/storage-keys");
const { toStored } = await import("@/lib/checkup/storage");
const { encodeSpec } = await import("@/lib/bike/spec-codec");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");
const { guestRun, guestWork, partsScope, planBeforeTheScopeRule, planFromDisk } =
  await import("@/tests/_helpers/guest-work");
const { PARTS } = await import("@/lib/domain/data/parts");

type WizardProps = import("@/components/checkup/Wizard").WizardProps;
type GuestState = import("@/lib/guest/schema").GuestState;

const PAD_WEAR = "check-brakes-disc#pad-wear";
const ALIGNMENT = "check-brakes-disc#caliper-alignment";
const HOSE_LEAK = "check-brakes-disc#hose-leak";
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

  it("(b) back through the resume banner: carried on as a full checkup, every answer kept, the visitor told — and shown the answer that now counts for both sides first", async () => {
    const user = await signedInUser("resume-b@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, `parts=${PICKED}`);
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();

    // A saved bike's banner links to `/controle` with no query (read in
    // `ResumeBanner`), and the pads' row names the FRONT caliper — the front
    // pads', or both pads'? (`lib/checkup/scope.ts`, `recordedScope`).
    page = await open(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    expect(page.props.steps.length).toBeGreaterThan(20);
    // Until `.debug/017` §5.13 the wizard opened past it, on the first open
    // question: the pads' answer, now counted for both sides, never shown.
    expect(onScreen()).toBe(PAD_WEAR);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
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
    // The address says what is on screen: the full checkup.
    expect(new URLSearchParams(window.location.search).has("parts")).toBe(false);
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

  it("a partial run on the rear caliper, reopened on the FRONT one: resumed on the REAR caliper, which its row names — its answer stays the rear pads', and the front is never written", async () => {
    // Until §5.12 it was resumed on the front caliper, its pads' answer stored
    // against the FRONT caliper, with nothing on screen (pinned here then "as
    // a decision"). Until §5.13 it carried on as the full checkup: the first
    // save moved the row to the front caliper, and finishing listed the front
    // pads and marked the front caliper (`.debug/017` §5.13, B1). The row on
    // the rear caliper says whose pads they were: the rear caliper is the
    // last part the pads' question names.
    const user = await signedInUser("resume-other-side@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([`${PAD_WEAR}=OK@brake-caliper-rear`]);

    page = await open(bikeId, "parts=brake-caliper-front");
    expect(page.props.scope).toEqual({ kind: "parts", partIds: ["brake-caliper-rear"] });
    expect(page.props.resumedOwn).toBe(true);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Un contrôle limité à : Étrier de frein arrière est déjà en cours sur ce vélo.",
    );
    // The address says what is on screen.
    const query = new URLSearchParams(window.location.search);
    expect(query.get("parts")).toBe("brake-caliper-rear");
    expect(query.get("run")).toBe(String(Date.parse(page.props.initialStored?.startedAt ?? "")));
    await verdict(page.user, ALIGNMENT, "ok");
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect(posted.at(-1)).toMatchObject({
      action: "finish",
      scope: { kind: "parts", partIds: ["brake-caliper-rear"] },
      result: "ok",
    });
    const after = await rowsOf(bikeId);
    expect(after.checkups[0]).toMatchObject({
      scope: "PARTIAL",
      status: "COMPLETED",
      items: [`${ALIGNMENT}=OK@brake-caliper-rear`, `${PAD_WEAR}=OK@brake-caliper-rear`],
    });
    expect(after.states).toEqual({ "brake-caliper-rear": "OK" });
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

  it("(c2) a run on the chain, opened on the front caliper: back to the chain, then on to the full checkup — its one answer was given whole", async () => {
    let page = await open("demo", "parts=chain");
    await start(page.user);
    await verdict(page.user, CHAIN, { ko: "chain-elongation" });
    await pagehide();
    cleanup();
    resetStoredCheckupCache();

    page = await open("demo", "parts=brake-caliper-front");
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=chain&resume=own",
    );
    page = await follow("demo");
    // The chain's question is asked of the chain alone either way: the full
    // checkup asks it about what it was answered for. Sent there WITH the
    // chain, which the full page plans to check the run again (V1-2).
    expect(phase()).toBe("resuming");
    expect(leave.replaceDocument).toHaveBeenLastCalledWith(
      "/fr/velo/demo/controle?parts=chain&resume=full",
    );
    page = await follow("demo");
    expect(page.props.widenedFrom?.scope).toEqual({ kind: "parts", partIds: ["chain"] });
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
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=chain&resume=full",
    );
    expect(window.localStorage.getItem(checkupKey("demo"))).toBe(raw);
    const page = await follow("demo");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    // Its own parts — the chain — do not ask its brake answers: nothing in the
    // stored run says they were given whole, so the wizard opens on the first
    // answer the notice names (`outgrowsParts`, `.debug/017` §5.14, V3-2),
    // shown as given; the visitor goes on to the first open question.
    expect(onScreen()).toBe(PAD_WEAR);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ok");
    const unanswered = (): boolean => !Object.hasOwn(stored()?.answers ?? {}, onScreen() ?? "");
    for (let guard = 0; guard < 80 && !unanswered(); guard += 1) {
      await page.user.click(screen.getByTestId("verdict-ok"));
    }
    expect(Object.keys(stored()?.answers ?? {})).toHaveLength(brakes.length + 1);
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    expect(Object.keys(stored()?.answers ?? {})).toHaveLength(brakes.length + 2);
  }, 60_000);
});

// ── §5.12: a run resumed under parts that ask its questions about OTHER parts ─

/**
 * The review of 2026-10-22 (`.debug/017` §5.12): since the scope rule (§5.11)
 * one question key covers different parts under different scopes, so a page
 * that ASKS a run's questions may ask them about other parts than the ones
 * they were answered for — and the run, resumed there, moved its answers
 * there: the rear pads reported worn ended up as "replace the FRONT pads".
 */

/** Where the wizard sent the visitor: the address of its last `replaceDocument`. */
async function follow(bikeParam: string) {
  const target = leave.replaceDocument.mock.calls.at(-1)?.[0];
  if (target === undefined) throw new Error("the wizard did not leave");
  cleanup();
  resetStoredCheckupCache();
  return open(bikeParam, new URL(target, "http://localhost").search.replace(/^\?/, ""));
}

/** Every question on screen answered OK, but `keep`, which is moved past as it stands. */
async function answerTheRest(user: Clicker, keep: Record<string, "ok" | { ko: string }> = {}) {
  for (let guard = 0; guard < 80 && phase() === "step"; guard += 1) {
    const key = onScreen() ?? "";
    const given = Object.hasOwn(keep, key) ? keep[key] : "ok";
    await verdict(user, key, given);
  }
  expect(phase()).toBe("summary");
}

const PADS_TITLE = "« Mesurer l’usure des plaquettes »";

/**
 * What an earlier FULL checkup left: both sides' pads worn — two open lines
 * on the bike's one list — and both calipers `ATTENTION`.
 */
async function earlierFullBothPadsWorn(bikeId: string): Promise<void> {
  const earlier = await prisma.checkup.create({
    data: {
      bikeId,
      scope: "FULL",
      status: "COMPLETED",
      startedAt: new Date("2026-09-01T08:00:00.000Z"),
      completedAt: new Date("2026-09-01T08:30:00.000Z"),
    },
  });
  const list = await prisma.buildList.create({
    data: { bikeId, checkupId: earlier.id, name: "" },
  });
  await prisma.buildListItem.createMany({
    data: ["brake-pads-front", "brake-pads-rear"].map((partId, sortOrder) => ({
      buildListId: list.id,
      partId,
      action: "REPLACE" as const,
      reasonKey: "pad-worn",
      sortOrder,
    })),
  });
  await prisma.bikePartState.updateMany({
    where: { bikeId, partId: { in: ["brake-caliper-front", "brake-caliper-rear"] } },
    data: { status: "ATTENTION" },
  });
}

async function rimBike(userId: string): Promise<string> {
  const derived = deriveBike(BIKE_PRESETS["road-rim-2x11"]);
  const bike = await prisma.bike.create({
    data: {
      userId,
      name: "Route",
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts as unknown as Prisma.InputJsonValue,
      partStates: { create: derived.parts.map((part) => ({ partId: part.partId })) },
    },
    select: { id: true },
  });
  return bike.id;
}

describe("§5.12 a saved bike's partial run, reopened on parts that do not hold it", () => {
  it("R1: the rear pads reported WORN, then the FRONT caliper picked: resumed on the rear caliper, and the list says the REAR pads — the front's are never listed", async () => {
    const user = await signedInUser("resume-r1@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([`${PAD_WEAR}=KO@brake-caliper-rear`]);

    page = await open(bikeId, "parts=brake-caliper-front");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "ownParts");
    // The first save on this page: the row stays the rear caliper's. Until
    // §5.13 it moved to the front caliper (VS-R1).
    await verdict(page.user, ALIGNMENT, "ok");
    await pagehide();
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([
      `${ALIGNMENT}=OK@brake-caliper-rear`,
      `${PAD_WEAR}=KO@brake-caliper-rear`,
    ]);
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const after = await rowsOf(bikeId);
    // Until §5.12: ["REPLACE brake-pads-front"] — the rear finding gone. Until
    // §5.13: both pads, the front caliper ATTENTION — an answer about the rear
    // pads counted for the front ones (`.debug/017` §5.13, B1).
    expect(after.lines).toEqual(["REPLACE brake-pads-rear"]);
    expect(after.states).toEqual({ "brake-caliper-rear": "ATTENTION" });
    expect(after.checkups[0]).toMatchObject({ scope: "PARTIAL", status: "COMPLETED" });
  }, 60_000);

  it("R3: both calipers' pads reported worn, then the REAR caliper picked: both lines — the front pads' finding is not dropped", async () => {
    const user = await signedInUser("resume-r3@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-front,brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();

    page = await open(bikeId, "parts=brake-caliper-rear");
    // The row names the front caliper, which the rear one's scope does not hold.
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    await answerTheRest(page.user, { [PAD_WEAR]: { ko: "pad-worn" } });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    // Until this fix: ["REPLACE brake-pads-rear"], with no word.
    expect((await rowsOf(bikeId)).lines).toEqual([
      "REPLACE brake-pads-front",
      "REPLACE brake-pads-rear",
    ]);
  }, 60_000);

  it("R5: a rim track reported WORN for the front wheel, then the front caliper picked: the symptom stays, and the rim is on the list", async () => {
    const RIM_TRACK = "check-brakes-rim#rim-track";
    const user = await signedInUser("resume-r5@velo-atelier.test");
    const bikeId = await rimBike(user.id);
    let page = await open(bikeId, "parts=wheel-front");
    await start(page.user);
    await verdict(page.user, RIM_TRACK, { ko: "rim-brake-track-worn" });
    await pagehide();
    cleanup();

    page = await open(bikeId, "parts=brake-caliper-front");
    // The caliper's rim-track question offers only "contaminated": resumed
    // there, the next save dropped the worn track, and the list said "clean
    // the front pads" (until this fix).
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    const rim = await prisma.checkupItem.findFirstOrThrow({
      where: { checkup: { bikeId }, stepKey: RIM_TRACK },
    });
    expect(rim).toMatchObject({ result: "KO", reasonKeys: ["rim-brake-track-worn"] });

    await answerTheRest(page.user, { [RIM_TRACK]: { ko: "rim-brake-track-worn" } });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const { lines } = await rowsOf(bikeId);
    expect(lines).toContain("INSPECT_SHOP wheel-front");
    expect(lines).not.toContain("CLEAN brake-pads-front");
  }, 60_000);

  it("R6: the rear pads answered OK, back through the resume banner: resumed on the rear caliper — the front pads' open line stays open, the front caliper is not written (RA-3)", async () => {
    // Until §5.13 the banner carried the run on as the full checkup and
    // skipped the pads' question as answered: finishing closed BOTH pads'
    // lines `recheck-ok` and marked both calipers `OK` (`.debug/017` §5.13).
    const user = await signedInUser("resume-r6@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    await earlierFullBothPadsWorn(bikeId);
    let page = await open(bikeId, "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();

    page = await open(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Un contrôle limité à : Étrier de frein arrière",
    );
    expect(page.props.steps.map((step) => step.key)).toEqual([PAD_WEAR, ALIGNMENT]);
    await verdict(page.user, ALIGNMENT, "ok");
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect(posted.at(-1)).toMatchObject({
      action: "finish",
      scope: { kind: "parts", partIds: ["brake-caliper-rear"] },
    });
    const after = await rowsOf(bikeId);
    expect(after.lines).toEqual(["REPLACE brake-pads-front", "REPLACE brake-pads-rear recheck-ok"]);
    expect(after.states).toEqual({
      "brake-caliper-front": "ATTENTION",
      "brake-caliper-rear": "OK",
    });
    expect(after.checkups.at(-1)?.items).toEqual([
      `${ALIGNMENT}=OK@brake-caliper-rear`,
      `${PAD_WEAR}=OK@brake-caliper-rear`,
    ]);
  }, 60_000);

  it("B2: the rear pads reported WORN, back through the banner: what the banner page posts keeps the row the rear caliper's, and the list the rear pads", async () => {
    // The sequence [RB] replayed as a payload (`.debug/017` §5.12, §5.13):
    // the banner page used to post `scope: full` with the KO, which a full
    // checkup's finish counts for both sides. It now posts the rear caliper.
    const user = await signedInUser("resume-b2@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();

    page = await open(bikeId);
    await verdict(page.user, ALIGNMENT, "ok");
    await pagehide();
    expect(posted.at(-1)).toMatchObject({
      action: "save",
      scope: { kind: "parts", partIds: ["brake-caliper-rear"] },
      answers: [ALIGNMENT, PAD_WEAR],
      result: "ok",
    });
    expect((await rowsOf(bikeId)).checkups[0]).toMatchObject({
      scope: "PARTIAL",
      items: [`${ALIGNMENT}=OK@brake-caliper-rear`, `${PAD_WEAR}=KO@brake-caliper-rear`],
    });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const after = await rowsOf(bikeId);
    expect(after.lines).toEqual(["REPLACE brake-pads-rear"]);
    expect(after.states).toEqual({ "brake-caliper-rear": "ATTENTION" });
  }, 60_000);

  it("RA-1: both calipers' pads reported worn, then the FRONT caliper picked: not held there — the full checkup, the pads' answer shown first, both lines", async () => {
    // Until §5.13 it was held on the front caliper ("Contrôle partiel", no
    // notice) and finished as ["REPLACE brake-pads-front"]: the rear pads'
    // finding dropped (VS-BF). The pads' row names the front caliper, which a
    // front-caliper run and a both-calipers run both write.
    const user = await signedInUser("resume-bf@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-front,brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();

    page = await open(bikeId, "parts=brake-caliper-front");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(PADS_TITLE);
    expect(onScreen()).toBe(PAD_WEAR);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
    await answerTheRest(page.user, { [PAD_WEAR]: { ko: "pad-worn" } });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect((await rowsOf(bikeId)).lines).toEqual([
      "REPLACE brake-pads-front",
      "REPLACE brake-pads-rear",
    ]);
  }, 60_000);

  it("RA-1: the front pads answered OK, then BOTH calipers picked: not held there either — the full checkup, which shows the answer first and says it now counts for both", async () => {
    // Until §5.13: held on both calipers with no word, and finished as both
    // pads' lines closed `recheck-ok` and the REAR caliper `OK` — though only
    // the front had been looked at (VS-FB). Which of the two the run was, the
    // row cannot say: so it is said on screen, and put back in front.
    const user = await signedInUser("resume-fb@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    await earlierFullBothPadsWorn(bikeId);
    let page = await open(bikeId, "parts=brake-caliper-front");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();

    page = await open(bikeId, "parts=brake-caliper-front,brake-caliper-rear");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "comptent désormais pour chacune d'elles — vérifiez-les : « Mesurer l’usure des plaquettes ».",
    );
    expect(onScreen()).toBe(PAD_WEAR);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ok");
    // Confirmed there, and the rest answered: the full checkup's OK closes
    // both pads' lines — what the notice said it would count for.
    await answerTheRest(page.user);
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const after = await rowsOf(bikeId);
    expect(after.checkups.at(-1)).toMatchObject({ scope: "FULL", status: "COMPLETED" });
    expect(after.lines).toEqual([
      "REPLACE brake-pads-front recheck-ok",
      "REPLACE brake-pads-rear recheck-ok",
    ]);
  }, 60_000);

  it("RA-1: a rear-caliper run written before the deploy (its pads' row on the FRONT caliper), opened on the front caliper: the full checkup, never the front pads alone", async () => {
    // What `main` wrote for a rear-caliper run: the first part of the WHOLE
    // question. Until §5.13 the front caliper's page held it, and finished it
    // as the front pads' finding (VS-PRE).
    const user = await signedInUser("resume-pre@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const run = await prisma.checkup.create({
      data: {
        bikeId,
        scope: "PARTIAL",
        status: "IN_PROGRESS",
        startedAt: new Date("2026-10-15T08:00:00.000Z"),
      },
    });
    await prisma.checkupItem.create({
      data: {
        checkupId: run.id,
        stepKey: PAD_WEAR,
        partId: "brake-caliper-front",
        guideSlug: "check-brakes-disc",
        result: "KO",
        reasonKeys: ["pad-worn"],
      },
    });
    const page = await open(bikeId, "parts=brake-caliper-front");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(PADS_TITLE);
    await answerTheRest(page.user, { [PAD_WEAR]: { ko: "pad-worn" } });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    expect((await rowsOf(bikeId)).lines).toEqual([
      "REPLACE brake-pads-front",
      "REPLACE brake-pads-rear",
    ]);
  }, 60_000);

  it("?run=: a front-caliper run is kept on its own page by a reload, and by its own address only — not by the same parts picked again, nor by another run's address", async () => {
    // The pads' row names the front caliper, as a both-calipers run's would.
    // The address the wizard wrote beside its parts — the run's `startedAt` —
    // is what tells this page it is the run's own.
    const user = await signedInUser("resume-token@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-front");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    const token = new URLSearchParams(window.location.search).get("run");
    page = await reload(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.queryByTestId("checkup-resumed")).not.toBeInTheDocument();
    const [run] = (await rowsOf(bikeId)).checkups;
    const startedAt = (await prisma.checkup.findUniqueOrThrow({ where: { id: run.id } })).startedAt;
    expect(token).toBe(String(startedAt.getTime()));
    cleanup();

    await open(bikeId, "parts=brake-caliper-front");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    cleanup();
    await open(bikeId, `parts=brake-caliper-front&run=${startedAt.getTime() - 1}`);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
  }, 60_000);

  it("S-page: a row about a question the bike is no longer asked widens nothing — the page keeps the parts, and hands the wizard what they are", async () => {
    const user = await signedInUser("resume-stale-page@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    let page = await open(bikeId, "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();
    const run = await prisma.checkup.findFirstOrThrow({ where: { bikeId } });
    // A real question of the corpus that a disc-brake bike is never asked.
    await prisma.checkupItem.create({
      data: {
        checkupId: run.id,
        stepKey: "check-brakes-rim#pad-wear",
        partId: "brake-caliper-rear",
        guideSlug: "check-brakes-rim",
        result: "OK",
      },
    });

    page = await open(bikeId, "parts=brake-caliper-rear");
    expect(page.props.scope).toEqual({ kind: "parts", partIds: ["brake-caliper-rear"] });
    expect(page.props.resumeWidened).toBe(false);
    expect(page.props.steps.map((step) => step.key)).toEqual([PAD_WEAR, ALIGNMENT]);
    // What lets the wizard decide a guest's run by the same rule: the full
    // plan's keys, and what this scope touches without asking.
    const full = planForBuild(
      {
        spec: deriveBike(BIKE_PRESETS["gravel-1x11"]).spec,
        parts: deriveBike(BIKE_PRESETS["gravel-1x11"]).parts,
      },
      { kind: "full" },
    );
    expect(page.props.scopeFacts?.asked).toEqual(full.map((step) => step.key));
    expect(page.props.scopeFacts?.touched).toEqual(["check-brakes-disc#hose-leak"]);
  }, 60_000);

  it("S-actions: finished on the rear caliper with such a row in the run — PARTIAL, the rear only", async () => {
    const user = await signedInUser("resume-stale-actions@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const payload = (answers: Record<string, string>, extra: Record<string, unknown> = {}) => ({
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "demo" },
      scope: { kind: "parts", partIds: ["brake-caliper-rear"] },
      locale: "fr",
      answers,
      symptoms: {},
      notes: {},
      toolsMissing: [],
      startedAt: "2026-10-20T08:00:00.000Z",
      contentVersion: CONTENT_VERSION,
      ...extra,
    });
    expect(
      await actions.saveCheckupAction({ bikeId, checkup: payload({ [PAD_WEAR]: "ok" }) }),
    ).toEqual({ ok: true, data: null });
    const run = await prisma.checkup.findFirstOrThrow({ where: { bikeId } });
    await prisma.checkupItem.create({
      data: {
        checkupId: run.id,
        stepKey: "check-brakes-rim#pad-wear",
        partId: "brake-caliper-rear",
        guideSlug: "check-brakes-rim",
        result: "OK",
      },
    });
    const result = await actions.finishCheckupAction({
      bikeId,
      checkup: payload(
        { [PAD_WEAR]: "ok", [ALIGNMENT]: "ok" },
        { completedAt: "2026-10-20T08:10:00.000Z" },
      ),
    });
    expect(result.ok).toBe(true);
    const after = await rowsOf(bikeId);
    expect(after.checkups[0]).toMatchObject({ scope: "PARTIAL", status: "COMPLETED" });
    // The stale row is gone — the one deletion left: the bike is not asked
    // its question at all — and it widened nothing on its way out. Read as a
    // reason to widen, it made the run FULL and wrote the FRONT caliper.
    expect(after.checkups[0].items).toEqual([
      `${ALIGNMENT}=OK@brake-caliper-rear`,
      `${PAD_WEAR}=OK@brake-caliper-rear`,
    ]);
    expect(after.states).toEqual({ "brake-caliper-rear": "OK" });
  }, 60_000);

  it("B6: a rear-caliper run written before the deploy — every row on its question's first part — is carried on as the full checkup, its answers named and put back in front", async () => {
    // `hose-leak` was asked of a caliper until 2026-10-22, and every row then
    // named the first host of its WHOLE question: nothing in these rows says
    // the run was the rear caliper's (`.debug/017` §5.13).
    const user = await signedInUser("resume-b6@velo-atelier.test");
    const bikeId = await gravelBike(user.id);
    const run = await prisma.checkup.create({
      data: {
        bikeId,
        scope: "PARTIAL",
        status: "IN_PROGRESS",
        startedAt: new Date("2026-10-15T08:00:00.000Z"),
      },
    });
    await prisma.checkupItem.createMany({
      data: [
        {
          stepKey: PAD_WEAR,
          partId: "brake-caliper-front",
          result: "KO" as const,
          reasonKeys: ["pad-worn"],
        },
        { stepKey: ALIGNMENT, partId: "brake-caliper-front", result: "OK" as const },
        { stepKey: HOSE_LEAK, partId: "brake-lever-front", result: "OK" as const },
      ].map((row) => ({ ...row, checkupId: run.id, guideSlug: "check-brakes-disc" })),
    });

    const page = await open(bikeId, "parts=brake-caliper-rear");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(PADS_TITLE);
    expect(onScreen()).toBe(PAD_WEAR);
    expect(page.props.steps.length).toBeGreaterThan(20);
    // Nothing deleted, nothing moved by opening it.
    expect((await rowsOf(bikeId)).checkups[0].items).toHaveLength(3);
  }, 60_000);

  it("B6: the same run imported from a browser — its rows on the rear caliper, the touched one included — is resumed and finished on its rear caliper, the `hose-leak` OK kept and acted on nowhere", async () => {
    const user = await signedInUser("resume-b6-import@velo-atelier.test");
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: "21111111-2222-4333-8444-555555555555",
      checkup: (build) =>
        guestRun({
          id: "8f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a91",
          build,
          scope: partsScope("brake-caliper-rear"),
          verdicts: { [PAD_WEAR]: { ko: ["pad-worn"] }, [HOSE_LEAK]: "ok" },
          startedAt: "2026-10-14T08:00:00.123Z",
          planner: "before-2026-10-22",
        }),
      list: false,
    });
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const imported = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!imported.ok || imported.data.bikeId === null) throw new Error("not imported");
    const bikeId = imported.data.bikeId;
    expect((await rowsOf(bikeId)).checkups[0]).toMatchObject({
      scope: "PARTIAL",
      status: "IN_PROGRESS",
      items: [`${HOSE_LEAK}=OK@brake-caliper-rear`, `${PAD_WEAR}=KO@brake-caliper-rear`],
    });

    // The account's banner: no `?parts=`. The rows tell the rear caliper.
    const page = await open(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(page.props.steps.map((step) => step.key)).toEqual([PAD_WEAR, ALIGNMENT]);
    await verdict(page.user, ALIGNMENT, "ok");
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const after = await rowsOf(bikeId);
    expect(after.checkups[0]).toMatchObject({
      scope: "PARTIAL",
      status: "COMPLETED",
      items: [
        `${ALIGNMENT}=OK@brake-caliper-rear`,
        `${HOSE_LEAK}=OK@brake-caliper-rear`,
        `${PAD_WEAR}=KO@brake-caliper-rear`,
      ],
    });
    expect(after.lines).toEqual(["REPLACE brake-pads-rear"]);
    expect(after.states).toEqual({ "brake-caliper-rear": "ATTENTION" });
  }, 60_000);
});

describe("§5.12 a guest's partial run, reopened on parts that do not hold it", () => {
  const stored = () =>
    JSON.parse(window.localStorage.getItem(checkupKey("demo")) ?? "null") as {
      scope: unknown;
      answers: Record<string, string>;
    } | null;
  const guestLines = () =>
    (
      JSON.parse(window.localStorage.getItem(buildListKey("demo")) ?? "null") as {
        items: { action: string; partId: string }[];
      } | null
    )?.items.map((item) => `${item.action} ${item.partId}`) ?? [];

  it("R2: the rear pads reported WORN, then the FRONT caliper picked: back on the rear caliper, and the list says the REAR pads", async () => {
    let page = await open("demo", "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();
    resetStoredCheckupCache();
    const raw = window.localStorage.getItem(checkupKey("demo"));

    page = await open("demo", "parts=brake-caliper-front");
    expect(phase()).toBe("resuming");
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=brake-caliper-rear&resume=own",
    );
    // Nothing written from the front caliper's page.
    expect(window.localStorage.getItem(checkupKey("demo"))).toBe(raw);

    page = await follow("demo");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "ownParts");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Un contrôle limité à : Étrier de frein arrière est déjà en cours sur ce vélo.",
    );
    await verdict(page.user, ALIGNMENT, "ok");
    await page.user.click(screen.getByTestId("summary-create"));
    await settle(50);
    // Until this fix: ["replace brake-pads-front"], the stored scope rewritten
    // to the front caliper.
    expect(guestLines()).toEqual(["replace brake-pads-rear"]);
    expect(stored()?.scope).toEqual({ kind: "parts", partIds: ["brake-caliper-rear"] });
  }, 60_000);

  it("R4: the rear pads answered OK, then BOTH calipers picked: back on the rear caliper, where the OK counts for the rear pads", async () => {
    let page = await open("demo", "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();
    resetStoredCheckupCache();

    await open("demo", "parts=brake-caliper-front,brake-caliper-rear");
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=brake-caliper-rear&resume=own",
    );
    page = await follow("demo");
    await page.user.click(screen.getByTestId("checkup-back"));
    expect(onScreen()).toBe(PAD_WEAR);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ok");
    expect(screen.getByTestId("verdict-covered")).toHaveTextContent(
      "ne comptera que pour : Plaquettes ou patins arrière",
    );
  }, 60_000);

  it("RA-3, a guest's: the rear pads answered, then the FULL checkup opened: back on the rear caliper, never counted for the front", async () => {
    let page = await open("demo", "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();
    resetStoredCheckupCache();

    page = await open("demo");
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=brake-caliper-rear&resume=own",
    );
    page = await follow("demo");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(page.props.steps.map((step) => step.key)).toEqual([PAD_WEAR, ALIGNMENT]);
  }, 60_000);

  it("R5, a guest's: a front-caliper run of before the deploy, its rim track reported WORN, is not resumed where that symptom is no longer offered", async () => {
    // The planner of before 2026-10-22 asked the rim-track question whole on
    // the front caliper, with every symptom. Today's asks it there for the
    // front pads alone — "contaminated" only: resumed on the caliper, the next
    // write dropped the worn track from storage (until this fix).
    const RIM_TRACK = "check-brakes-rim#rim-track";
    const derived = deriveBike(BIKE_PRESETS["road-rim-2x11"]);
    const old = guestRun({
      id: "66666666-6666-4666-8666-666666666666",
      build: { spec: derived.spec, parts: derived.parts },
      scope: partsScope("brake-caliper-front"),
      verdicts: { [RIM_TRACK]: { ko: ["rim-brake-track-worn"] } },
      startedAt: "2026-10-14T08:00:00.000Z",
      planner: "before-2026-10-22",
    });
    // A guest bike of that kind (`local`): the page reads it from `?spec=`.
    const raw = JSON.stringify({ ...toStored(old), bikeRef: { kind: "local" } });
    window.localStorage.setItem(checkupKey("local"), raw);
    const spec = encodeSpec(BIKE_PRESETS["road-rim-2x11"]);

    await open("local", new URLSearchParams({ spec, parts: "brake-caliper-front" }).toString());
    expect(phase()).toBe("resuming");
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      `/fr/velo/local/controle?${new URLSearchParams({ spec, parts: "brake-caliper-front", resume: "full" }).toString()}`,
    );
    expect(window.localStorage.getItem(checkupKey("local"))).toBe(raw);

    // Where it is sent, the worn track is offered, and kept.
    const page = await follow("local");
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    await page.user.click(screen.getByTestId("verdict-ok"));
    await pagehide();
    const kept = JSON.parse(window.localStorage.getItem(checkupKey("local")) ?? "null") as {
      symptoms: Record<string, string[]>;
    };
    expect(kept.symptoms[RIM_TRACK]).toEqual(["rim-brake-track-worn"]);
  }, 60_000);

  it("B6, a guest's: a rear-caliper run of before the deploy, with `hose-leak` answered OK, is resumed on its rear caliper", async () => {
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const build = { spec: derived.spec, parts: derived.parts };
    const old = guestRun({
      id: "55555555-5555-4555-8555-555555555555",
      build,
      scope: partsScope("brake-caliper-rear"),
      verdicts: { [PAD_WEAR]: { ko: ["pad-worn"] }, "check-brakes-disc#hose-leak": "ok" },
      startedAt: "2026-10-14T08:00:00.000Z",
      planner: "before-2026-10-22",
    });
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify({ ...toStored(old), bikeRef: { kind: "demo" } }),
    );

    const page = await open("demo", "parts=brake-caliper-rear");
    // Until this fix: "Reprise…", then the full checkup, the pads counted for both.
    expect(leave.replaceDocument).not.toHaveBeenCalled();
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    await start(page.user);
    await verdict(page.user, ALIGNMENT, "ok");
    await pagehide();
    // The touched answer is kept in storage, acted on nowhere: until §5.13 the
    // first save on this page wrote the run back without it (V1-3).
    expect(stored()?.answers).toEqual({
      [PAD_WEAR]: "ko",
      [HOSE_LEAK]: "ok",
      [ALIGNMENT]: "ok",
    });
    await page.user.click(screen.getByTestId("summary-create"));
    await settle(50);
    expect(guestLines()).toEqual(["replace brake-pads-rear"]);
    expect(stored()?.answers[HOSE_LEAK]).toBe("ok");
  }, 60_000);

  it("V1-1: a FRONT-caliper run reached through `?parts=brake-caliper-rear&resume=own` — an address an earlier run left — goes back to the front caliper", async () => {
    let page = await open("demo", "parts=brake-caliper-front");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, { ko: "pad-worn" });
    await pagehide();
    cleanup();
    resetStoredCheckupCache();
    const raw = window.localStorage.getItem(checkupKey("demo"));

    // Until §5.13: held on the rear caliper under "Un contrôle limité à :
    // Étrier de frein arrière…", and finished as the REAR pads' line.
    page = await open("demo", "parts=brake-caliper-rear&resume=own");
    expect(phase()).toBe("resuming");
    expect(leave.replaceDocument).toHaveBeenCalledWith(
      "/fr/velo/demo/controle?parts=brake-caliper-front&resume=own",
    );
    expect(window.localStorage.getItem(checkupKey("demo"))).toBe(raw);
    page = await follow("demo");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      "Un contrôle limité à : Étrier de frein avant",
    );
    await answerTheRest(page.user);
    await page.user.click(screen.getByTestId("summary-create"));
    await settle(50);
    expect(guestLines()).toEqual(["replace brake-pads-front"]);
    expect(stored()?.scope).toEqual({ kind: "parts", partIds: ["brake-caliper-front"] });
  }, 60_000);

  it("V1-2: a REAR-caliper run with the pads OK reached through `?resume=full` — an address an earlier run left — goes back to the rear caliper, and the front pads' line stays open", async () => {
    // A first FULL checkup: both pads worn, both lines on the guest's list.
    let page = await open("demo");
    await start(page.user);
    await answerTheRest(page.user, { [PAD_WEAR]: { ko: "pad-worn" } });
    await page.user.click(screen.getByTestId("summary-create"));
    await settle(50);
    expect(guestLines()).toEqual(["replace brake-pads-front", "replace brake-pads-rear"]);
    cleanup();
    resetStoredCheckupCache();

    page = await open("demo", "parts=brake-caliper-rear");
    await start(page.user);
    await verdict(page.user, PAD_WEAR, "ok");
    await pagehide();
    cleanup();
    resetStoredCheckupCache();

    // Until §5.13: carried on as the full checkup, and finishing closed BOTH
    // pads' lines `recheck-ok`. Without the run's parts, and with them alike.
    for (const search of ["resume=full", "parts=brake-caliper-rear&resume=full"]) {
      leave.replaceDocument.mockClear();
      await open("demo", search);
      expect(phase()).toBe("resuming");
      expect(leave.replaceDocument).toHaveBeenCalledWith(
        "/fr/velo/demo/controle?parts=brake-caliper-rear&resume=own",
      );
      cleanup();
      resetStoredCheckupCache();
    }
    page = await open("demo", "parts=brake-caliper-rear&resume=own");
    expect(page.props.steps.map((step) => step.key)).toEqual([PAD_WEAR, ALIGNMENT]);
    await answerTheRest(page.user);
    await page.user.click(screen.getByTestId("summary-create"));
    await settle(50);
    const lines = (
      JSON.parse(window.localStorage.getItem(buildListKey("demo")) ?? "null") as {
        items: { action: string; partId: string; done: boolean }[];
      }
    ).items.map((item) => `${item.action} ${item.partId}${item.done ? " done" : ""}`);
    expect(lines).toEqual(["replace brake-pads-front", "replace brake-pads-rear done"]);
  }, 60_000);
});

describe("§5.13 a guest's checkup of before 2026-10-22, imported: a partial checkup stays about its parts", () => {
  /** A finished rear-caliper checkup, answered under the planner of then. */
  function oldRearCheckup(
    preset: "gravel-1x11" | "road-rim-2x11",
    verdicts: Record<string, "ok" | { ko: string[] }>,
    id: string,
  ) {
    return guestWork({
      answers: BIKE_PRESETS[preset],
      bikeId: `${id.slice(0, 8)}-2222-4333-8444-555555555555`,
      checkup: (build) => ({
        ...guestRun({
          id,
          build,
          scope: partsScope("brake-caliper-rear"),
          verdicts,
          startedAt: "2026-10-14T08:00:00.123Z",
          planner: "before-2026-10-22",
        }),
        completedAt: "2026-10-14T08:05:00.000Z",
      }),
    });
  }

  it("VI-B6KO: a leak reported in a rear-caliper checkup is a row on the rear caliper, and the FRONT caliper and lever are not written", async () => {
    const user = await prisma.user.create({
      data: { email: "import-b6ko@velo-atelier.test", name: "C", locale: "fr" },
    });
    const work = oldRearCheckup(
      "gravel-1x11",
      { [PAD_WEAR]: { ko: ["pad-worn"] }, [ALIGNMENT]: "ok", [HOSE_LEAK]: { ko: ["hose-leak"] } },
      "5f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a91",
    );
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const result = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!result.ok || result.data.bikeId === null) throw new Error("not imported");
    const after = await rowsOf(result.data.bikeId);
    // Until this fix: FULL, items on the FRONT caliper and lever, both BROKEN.
    expect(after.checkups).toEqual([
      expect.objectContaining({
        scope: "PARTIAL",
        status: "COMPLETED",
        items: [
          `${ALIGNMENT}=OK@brake-caliper-rear`,
          `${HOSE_LEAK}=KO@brake-caliper-rear`,
          `${PAD_WEAR}=KO@brake-caliper-rear`,
        ],
      }),
    ]);
    expect(after.states).toEqual({ "brake-caliper-rear": "BROKEN" });
  }, 60_000);

  it("VI-B6OK: an OK to `hose-leak` in it is imported too — a row, acted on nowhere — so the browser forgets nothing the account lacks", async () => {
    const user = await prisma.user.create({
      data: { email: "import-b6ok@velo-atelier.test", name: "C", locale: "fr" },
    });
    const runId = "6f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a91";
    const work = oldRearCheckup(
      "gravel-1x11",
      { [PAD_WEAR]: { ko: ["pad-worn"] }, [ALIGNMENT]: "ok", [HOSE_LEAK]: "ok" },
      runId,
    );
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const result = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!result.ok || result.data.bikeId === null) throw new Error("not imported");
    expect(result.data.bikes[0].checkups).toEqual([{ guestKey: runId, status: "imported" }]);
    const after = await rowsOf(result.data.bikeId);
    expect(after.checkups[0].items).toContain(`${HOSE_LEAK}=OK@brake-caliper-rear`);
    expect(after.states).toEqual({ "brake-caliper-rear": "BROKEN" });
  }, 60_000);

  it("VI-RIM-REAR: a worn rim reported in a rear-caliper checkup is a row with its symptom on the rear caliper — never the FRONT wheel `BROKEN`", async () => {
    const user = await prisma.user.create({
      data: { email: "import-rim-rear@velo-atelier.test", name: "C", locale: "fr" },
    });
    const RIM_TRACK = "check-brakes-rim#rim-track";
    const work = oldRearCheckup(
      "road-rim-2x11",
      { [RIM_TRACK]: { ko: ["rim-brake-track-worn"] } },
      "7f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a91",
    );
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const result = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!result.ok || result.data.bikeId === null) throw new Error("not imported");
    const after = await rowsOf(result.data.bikeId);
    expect(after.checkups).toEqual([
      expect.objectContaining({
        scope: "PARTIAL",
        items: [`${RIM_TRACK}=KO@brake-caliper-rear`],
      }),
    ]);
    const rim = await prisma.checkupItem.findFirstOrThrow({
      where: { checkup: { bikeId: result.data.bikeId }, stepKey: RIM_TRACK },
    });
    expect(rim.reasonKeys).toEqual(["rim-brake-track-worn"]);
    expect(after.states).toEqual({});
  }, 60_000);
});

// ── §5.14: no page sends a run round an empty page ───────────────────────────

const SHIFTING = "check-drivetrain#shifting-index";
const SHIFTING_TITLE = "« Essayer tous les rapports »";

/** What the page renders for an address: the wizard, or the empty page and its one link. */
type Rendered =
  { kind: "wizard"; props: WizardProps } | { kind: "empty"; cta: Record<string, string> };

/** The element of `node`'s tree whose `data-testid` is `id` — the page's output is not rendered. */
function byTestId(node: unknown, id: string): React.ReactElement<Record<string, unknown>> | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = byTestId(child, id);
      if (found !== null) return found;
    }
    return null;
  }
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (element.props?.["data-testid"] === id) return element;
  return byTestId(element.props?.children, id);
}

/** The real page for `bikeParam` at `search`, NOT rendered: the wizard's props, or the empty page's link. */
async function pageAt(bikeParam: string, search: string): Promise<Rendered> {
  window.history.replaceState(
    null,
    "",
    `/fr/velo/${bikeParam}/controle${search === "" ? "" : `?${search}`}`,
  );
  const element = (await CheckupPage({
    params: Promise.resolve({ locale: "fr", id: bikeParam }),
    searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))),
  })) as React.ReactElement<{ children?: React.ReactElement<WizardProps> }>;
  const child = element.props.children;
  if (child !== undefined && child.type === Wizard) {
    return { kind: "wizard", props: { ...child.props, guideNodes: {} } };
  }
  const cta = byTestId(element, "checkup-full-cta");
  if (cta === null)
    throw new Error(`the page at "${search}" is neither the wizard nor the empty page`);
  const href = cta.props.href as { pathname: string; query?: Record<string, string> };
  expect(href.pathname).toBe("/velo/[id]/controle");
  return { kind: "empty", cta: href.query ?? {} };
}

/**
 * Every page the visitor is taken through from `search`: the wizard's leaves
 * (`replaceDocument`) and the empty page's one link, followed until a wizard
 * stays. Fails on an address seen twice — the visitor going round — or after
 * `limit` pages.
 */
async function walk(
  bikeParam: string,
  search: string,
  limit = 5,
): Promise<{ trail: string[]; props: WizardProps }> {
  const trail: string[] = [];
  let at = search;
  for (let hop = 0; hop < limit; hop += 1) {
    if (trail.includes(at)) throw new Error(`round again: ${[...trail, at].join(" → ")}`);
    trail.push(at);
    cleanup();
    resetStoredCheckupCache();
    leave.replaceDocument.mockClear();
    const rendered = await pageAt(bikeParam, at);
    if (rendered.kind === "empty") {
      at = new URLSearchParams(rendered.cta).toString();
      continue;
    }
    await renderWithIntl(createElement(Wizard, rendered.props));
    await settle();
    const left = leave.replaceDocument.mock.calls.at(-1)?.[0];
    if (left === undefined) return { trail, props: rendered.props };
    at = new URL(left, "http://localhost").search.replace(/^\?/, "");
  }
  throw new Error(`no wizard after ${limit} pages: ${trail.join(" → ")}`);
}

/**
 * The run's answer to `key` is on screen, or will be before the visitor goes
 * past it: the wizard opens no later than the first answer the notice names
 * (`.debug/017` §5.13, RA-3) — earlier when a question before it is open.
 */
function notPast(steps: readonly { key: string }[], key: string): void {
  const at = steps.findIndex((step) => step.key === key);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(steps.findIndex((step) => step.key === onScreen())).toBeLessThanOrEqual(at);
}

type PresetId = keyof typeof BIKE_PRESETS;
const PRESET_IDS = Object.keys(BIKE_PRESETS) as PresetId[];
const buildOf = (preset: PresetId) => {
  const derived = deriveBike(BIKE_PRESETS[preset]);
  return { spec: derived.spec, parts: derived.parts };
};

/**
 * The stored scopes that ask nothing on a preset while a run on them can hold
 * an answer that preset is asked — computed in the case below, pinned here so
 * that a corpus change that empties the list fails it instead of making it
 * vacuous: the left shifter on the two 2x presets (a question until
 * 2026-10-22, none today), and on the 1x ones the front derailleur, the left
 * shifter and the two together (a 2x bike rebuilt as a 1x).
 */
const EMPTY_OWN_CASES = [
  "emtb-mid-1x12:front-derailleur",
  "emtb-mid-1x12:front-derailleur+shifter-left",
  "emtb-mid-1x12:shifter-left",
  "gravel-1x11:front-derailleur",
  "gravel-1x11:front-derailleur+shifter-left",
  "gravel-1x11:shifter-left",
  "mtb-full-dropper-1x12:front-derailleur",
  "mtb-full-dropper-1x12:front-derailleur+shifter-left",
  "mtb-full-dropper-1x12:shifter-left",
  "mtb-hardtail-1x12:front-derailleur",
  "mtb-hardtail-1x12:front-derailleur+shifter-left",
  "mtb-hardtail-1x12:shifter-left",
  "road-disc-2x12:shifter-left",
  "road-rim-2x11:shifter-left",
];

describe("§5.14 a guest's run whose own parts ask nothing on this bike (V2-1)", () => {
  const stored = (ref: "demo" | "local" = "local") =>
    JSON.parse(window.localStorage.getItem(checkupKey(ref)) ?? "null") as {
      scope: unknown;
      answers: Record<string, string>;
    } | null;

  it("VG-TRAP2: a front-derailleur run of a 2x guest bike, the bike rebuilt as a 1x — every checkup page ends on the full checkup, the answer kept, named and on screen", async () => {
    // Today's planner, on the 2x bike: the front derailleur asks the shifting
    // question, of itself alone. On the 1x bike it asks nothing.
    const run = guestRun({
      id: "99999999-9999-4999-8999-999999999999",
      build: buildOf("road-rim-2x11"),
      scope: partsScope("front-derailleur"),
      verdicts: { [SHIFTING]: "ok" },
      startedAt: "2026-10-23T08:00:00.000Z",
    });
    const raw = JSON.stringify({ ...toStored(run), bikeRef: { kind: "local" } });
    window.localStorage.setItem(checkupKey("local"), raw);
    const spec = encodeSpec(BIKE_PRESETS["gravel-1x11"]);
    const own = new URLSearchParams({ spec, parts: "front-derailleur", resume: "own" }).toString();

    // The full checkup, the chain, a caliper: each sends the run to its own parts.
    for (const search of [
      new URLSearchParams({ spec }).toString(),
      new URLSearchParams({ spec, parts: "chain" }).toString(),
      new URLSearchParams({ spec, parts: "brake-caliper-front" }).toString(),
    ]) {
      cleanup();
      resetStoredCheckupCache();
      leave.replaceDocument.mockClear();
      await open("local", search);
      expect(phase()).toBe("resuming");
      expect(leave.replaceDocument).toHaveBeenCalledWith(`/fr/velo/local/controle?${own}`);
    }
    // Which, asking nothing here, is the full checkup for the run — until
    // §5.14 the empty page, whose one link sent the run back to it.
    cleanup();
    resetStoredCheckupCache();
    leave.replaceDocument.mockClear();
    const page = await open("local", own);
    expect(page.props.scope).toEqual({ kind: "full" });
    expect(leave.replaceDocument).not.toHaveBeenCalled();
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveAttribute("data-notice", "partialAsFull");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      `comptent désormais pour chacune d'elles — vérifiez-les : ${SHIFTING_TITLE}.`,
    );
    // Given for the front derailleur, it now counts for the rear one and the
    // right shifter: named, and on screen before the visitor goes past it.
    notPast(page.props.steps, SHIFTING);
    expect(window.localStorage.getItem(checkupKey("local"))).toBe(raw);
    for (let guard = 0; guard < 80 && onScreen() !== SHIFTING; guard += 1) {
      await page.user.click(screen.getByTestId("verdict-ok"));
    }
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ok");
    await pagehide();
    // Answered on, the run is the full checkup's, the answer still there.
    expect(stored()?.scope).toEqual({ kind: "full" });
    expect(stored()?.answers[SHIFTING]).toBe("ok");
  }, 60_000);

  it("VG-TRAP: a left-shifter run of before 2026-10-22 — a question then, none today — ends on the full checkup from every page", async () => {
    const build = buildOf("road-rim-2x11");
    expect(planFromDisk(build, partsScope("shifter-left"))).toEqual([]);
    expect(planBeforeTheScopeRule(build, partsScope("shifter-left")).map((s) => s.key)).toEqual([
      SHIFTING,
    ]);
    const old = guestRun({
      id: "88888888-8888-4888-8888-888888888888",
      build,
      scope: partsScope("shifter-left"),
      verdicts: { [SHIFTING]: "ok" },
      startedAt: "2026-10-14T08:00:00.000Z",
      planner: "before-2026-10-22",
    });
    window.localStorage.setItem(
      checkupKey("local"),
      JSON.stringify({ ...toStored(old), bikeRef: { kind: "local" } }),
    );
    const spec = encodeSpec(BIKE_PRESETS["road-rim-2x11"]);
    const own = new URLSearchParams({ spec, parts: "shifter-left", resume: "own" }).toString();
    for (const search of [
      new URLSearchParams({ spec }).toString(),
      new URLSearchParams({ spec, parts: "chain" }).toString(),
      new URLSearchParams({ spec, parts: "brake-caliper-front" }).toString(),
    ]) {
      expect((await walk("local", search)).trail).toEqual([search, own]);
    }
    // The bike page's "Reprendre le contrôle" carries the run's own parts: the
    // empty page — true, no question applies to them — whose link is the full
    // checkup, which takes the run to the page that holds it.
    const banner = new URLSearchParams({ spec, parts: "shifter-left" }).toString();
    const { trail, props } = await walk("local", banner);
    expect(trail).toEqual([banner, `spec=${spec}`, own]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(SHIFTING_TITLE);
    notPast(props.steps, SHIFTING);
  }, 60_000);

  it("every stored scope that asks nothing on a preset, from every page, ends on a wizard that holds the run's answer — never round an empty page", async () => {
    // Every run that can hold an answer such a page cannot ask: on each preset,
    // every part (and the union of them) that asks nothing there, answered on
    // any preset by today's planner or by the one of before 2026-10-22 — and
    // two scopes the page cannot read at all.
    const full = new Map(PRESET_IDS.map((id) => [id, planFromDisk(buildOf(id), { kind: "full" })]));
    const cases: { on: PresetId; partIds: string[]; key: string }[] = [];
    for (const on of PRESET_IDS) {
      const asked = new Set(full.get(on)?.map((step) => step.key));
      const empty = PARTS.map((part) => part.id).filter(
        (partId) => planFromDisk(buildOf(on), partsScope(partId)).length === 0,
      );
      const answerable = (partIds: string[]): string | undefined =>
        PRESET_IDS.flatMap((from) => [
          ...planFromDisk(buildOf(from), partsScope(...partIds)),
          ...planBeforeTheScopeRule(buildOf(from), partsScope(...partIds)),
        ])
          .map((step) => step.key)
          .find((key) => asked.has(key));
      for (const partId of empty) {
        const key = answerable([partId]);
        if (key !== undefined) cases.push({ on, partIds: [partId], key });
      }
      const all = empty.filter((partId) => answerable([partId]) !== undefined);
      if (all.length > 1 && planFromDisk(buildOf(on), partsScope(...all)).length === 0) {
        cases.push({ on, partIds: all, key: answerable(all) as string });
      }
    }
    // The corpus as it stands: the shifting question, through the left
    // shifter on the two 2x presets, the front derailleur and the left
    // shifter on the four 1x ones (the city bike's hub gear is not asked it).
    expect(new Set(cases.map((entry) => entry.key))).toEqual(new Set([SHIFTING]));
    expect(cases.map((entry) => `${entry.on}:${entry.partIds.join("+")}`).sort()).toEqual(
      EMPTY_OWN_CASES,
    );

    for (const { on, partIds, key } of cases) {
      const run = {
        ...toStored(
          guestRun({
            id: "77777777-7777-4777-8777-777777777771",
            build: buildOf(on),
            scope: { kind: "full" },
            verdicts: { [key]: "ok" },
            startedAt: "2026-10-14T08:00:00.000Z",
          }),
        ),
        scope: partsScope(...partIds),
        bikeRef: { kind: "local" as const },
      };
      window.localStorage.setItem(checkupKey("local"), JSON.stringify(run));
      const spec = encodeSpec(BIKE_PRESETS[on]);
      const parts = partIds.join(",");
      const queries: Record<string, string>[] = [
        { spec },
        { spec, parts },
        { spec, parts: "chain" },
        { spec, parts, resume: "own" },
        { spec, parts, resume: "full" },
        { spec, resume: "full" },
      ];
      for (const query of queries) {
        const search = new URLSearchParams(query).toString();
        const { trail, props } = await walk("local", search);
        // The page that stays: the full checkup, the run's answer named and
        // not past, nothing written by the pages on the way.
        expect({
          on,
          parts,
          trail,
          scope: screen.getByTestId("checkup-scope").textContent,
        }).toEqual({ on, parts, trail, scope: "Contrôle complet" });
        expect(screen.getByTestId("checkup-resumed")).toHaveAttribute(
          "data-notice",
          "partialAsFull",
        );
        notPast(props.steps, key);
        expect(stored()?.answers).toEqual({ [key]: "ok" });
      }
    }

    // A scope the page cannot read — no part, or none the catalogue knows —
    // and an answer the corpus dropped: a wizard everywhere too.
    const spec = encodeSpec(BIKE_PRESETS["gravel-1x11"]);
    for (const [scope, answers] of [
      [{ kind: "parts", partIds: [] }, { [CHAIN]: "ok" }],
      [{ kind: "parts", partIds: ["not-a-part"] }, { [CHAIN]: "ok" }],
      [partsScope("shifter-left"), { "check-retired#gone": "ok" }],
    ] as const) {
      window.localStorage.setItem(
        checkupKey("local"),
        JSON.stringify({
          ...toStored(
            guestRun({
              id: "77777777-7777-4777-8777-777777777772",
              build: buildOf("gravel-1x11"),
              scope: { kind: "full" },
              verdicts: {},
              startedAt: "2026-10-14T08:00:00.000Z",
            }),
          ),
          scope,
          answers,
          bikeRef: { kind: "local" },
        }),
      );
      const queries: Record<string, string>[] = [
        { spec },
        { spec, parts: "chain" },
        { spec, parts: "shifter-left" },
        { spec, parts: "shifter-left", resume: "own" },
        { spec, resume: "full" },
      ];
      for (const query of queries) {
        await walk("local", new URLSearchParams(query).toString());
        expect(screen.getByTestId("checkup-wizard")).toBeInTheDocument();
      }
    }
  }, 240_000);
});

describe("§5.14 a saved bike's run whose parts ask nothing: every page ends on a wizard", () => {
  it("an imported left-shifter run of before 2026-10-22 — its one row on the left shifter — from the banner, its own parts and another part", async () => {
    const user = await signedInUser("resume-v21-import@velo-atelier.test");
    const work = guestWork({
      answers: BIKE_PRESETS["road-rim-2x11"],
      bikeId: "31111111-2222-4333-8444-555555555555",
      checkup: (build) =>
        guestRun({
          id: "8f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a93",
          build,
          scope: partsScope("shifter-left"),
          verdicts: { [SHIFTING]: "ok" },
          startedAt: "2026-10-14T08:00:00.123Z",
          planner: "before-2026-10-22",
        }),
      list: false,
    });
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const imported = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!imported.ok || imported.data.bikeId === null) throw new Error("not imported");
    const bikeId = imported.data.bikeId;
    expect((await rowsOf(bikeId)).checkups[0]).toMatchObject({
      scope: "PARTIAL",
      status: "IN_PROGRESS",
      items: [`${SHIFTING}=OK@shifter-left`],
    });

    // Its rows tell the left shifter, which asks nothing: the full checkup
    // takes the run over from every page (`savedResumeTarget` never sends a
    // run to parts that ask nothing — `own` needs an answer narrowed there).
    expect((await walk(bikeId, "")).trail).toEqual([""]);
    expect((await walk(bikeId, "parts=chain")).trail).toEqual(["parts=chain"]);
    // Its own parts: the empty page — no question applies to them — and its
    // link, the full checkup.
    const { trail, props } = await walk(bikeId, "parts=shifter-left");
    expect(trail).toEqual(["parts=shifter-left", ""]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(SHIFTING_TITLE);
    notPast(props.steps, SHIFTING);
    // Opening pages wrote nothing.
    expect((await rowsOf(bikeId)).checkups[0].items).toEqual([`${SHIFTING}=OK@shifter-left`]);
  }, 60_000);

  it("a front-derailleur run of a 2x bike, the bike then rebuilt as a 1x: the full checkup from every page", async () => {
    const user = await signedInUser("resume-v21-rebuilt@velo-atelier.test");
    const two = deriveBike(BIKE_PRESETS["road-rim-2x11"]);
    const bike = await prisma.bike.create({
      data: {
        userId: user.id,
        name: "Route",
        answers: two.answers,
        spec: two.spec,
        parts: two.parts as unknown as Prisma.InputJsonValue,
        partStates: { create: two.parts.map((part) => ({ partId: part.partId })) },
      },
      select: { id: true },
    });
    const page = await open(bike.id, "parts=front-derailleur");
    await start(page.user);
    await verdict(page.user, SHIFTING, "ok");
    await pagehide();
    cleanup();
    expect((await rowsOf(bike.id)).checkups[0].items).toEqual([`${SHIFTING}=OK@front-derailleur`]);
    // `updateBikeAction`'s write: the bike is a 1x now.
    const one = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    await prisma.bike.update({
      where: { id: bike.id },
      data: {
        answers: one.answers,
        spec: one.spec,
        parts: one.parts as unknown as Prisma.InputJsonValue,
      },
    });
    for (const search of ["", "parts=chain", "parts=front-derailleur", "parts=shifter-left"]) {
      const { trail, props } = await walk(bike.id, search);
      expect(trail).toEqual([search]);
      expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
      expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(SHIFTING_TITLE);
      notPast(props.steps, SHIFTING);
    }
    expect((await rowsOf(bike.id)).checkups[0].items).toEqual([`${SHIFTING}=OK@front-derailleur`]);
  }, 60_000);
});

describe("§5.14 an unfinished old partial checkup, imported with a touched KO (V2-3)", () => {
  it("VI-B6KO-UNFINISHED: imported PARTIAL on its rear caliper; the account's first page carries it on as the full checkup, says so and shows it first — as the guest's own browser does", async () => {
    const user = await signedInUser("resume-v23@velo-atelier.test");
    const verdicts = { [PAD_WEAR]: { ko: ["pad-worn"] }, [HOSE_LEAK]: { ko: ["hose-leak"] } };
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: "9f1d7a52-2222-4333-8444-555555555555",
      checkup: (build) =>
        guestRun({
          id: "9f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a92",
          build,
          scope: partsScope("brake-caliper-rear"),
          verdicts,
          startedAt: "2026-10-14T08:00:00.123Z",
          planner: "before-2026-10-22",
        }),
      list: false,
    });
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const imported = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!imported.ok || imported.data.bikeId === null) throw new Error("not imported");
    const bikeId = imported.data.bikeId;
    // The import acts on nothing: an unfinished checkup writes rows only.
    expect(await rowsOf(bikeId)).toMatchObject({
      checkups: [
        {
          scope: "PARTIAL",
          status: "IN_PROGRESS",
          items: [`${HOSE_LEAK}=KO@brake-caliper-rear`, `${PAD_WEAR}=KO@brake-caliper-rear`],
        },
      ],
      lines: [],
      states: {},
    });

    // The banner. The rows tell the rear caliper, but its page cannot hold a
    // KO to a question it only touches: the full checkup takes the run over.
    const page = await open(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      `vérifiez-les : ${PADS_TITLE} et « Chercher une fuite de liquide ».`,
    );
    expect(onScreen()).toBe(PAD_WEAR);
    await answerTheRest(page.user, {
      [PAD_WEAR]: { ko: "pad-worn" },
      [HOSE_LEAK]: { ko: "hose-leak" },
    });
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const after = await rowsOf(bikeId);
    expect(after.checkups).toHaveLength(1);
    expect(after.checkups[0]).toMatchObject({ scope: "FULL", status: "COMPLETED" });
    expect(after.checkups[0].items).toEqual(
      expect.arrayContaining([
        `${PAD_WEAR}=KO@brake-caliper-front`,
        `${HOSE_LEAK}=KO@brake-lever-front`,
      ]),
    );
    expect(after.lines).toEqual([
      "INSPECT_SHOP brake-line-front",
      "INSPECT_SHOP brake-line-rear",
      "REPLACE brake-pads-front",
      "REPLACE brake-pads-rear",
    ]);
    expect(after.states).toMatchObject({
      "brake-caliper-front": "ATTENTION",
      "brake-caliper-rear": "ATTENTION",
      "brake-lever-front": "ATTENTION",
      "brake-lever-rear": "ATTENTION",
    });

    // The same run in the guest's own browser: also the full checkup (S6).
    cleanup();
    resetStoredCheckupCache();
    leave.replaceDocument.mockClear();
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify({
        ...toStored(
          guestRun({
            id: "9f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a93",
            build: buildOf("gravel-1x11"),
            scope: partsScope("brake-caliper-rear"),
            verdicts,
            startedAt: "2026-10-14T08:00:00.123Z",
            planner: "before-2026-10-22",
          }),
        ),
        bikeRef: { kind: "demo" },
      }),
    );
    const { trail } = await walk("demo", "");
    expect(trail).toEqual([
      "",
      "parts=brake-caliper-rear&resume=own",
      "parts=brake-caliper-rear&resume=full",
    ]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
  }, 90_000);
});

describe("§5.14 the fourth verification (V3): own parts that no longer ask ONE of a run's answers; an imported run whose one answer is touched", () => {
  const stored = () =>
    JSON.parse(window.localStorage.getItem(checkupKey("local")) ?? "null") as {
      scope: unknown;
      answers: Record<string, string>;
    } | null;

  /** A guest's run on `partIds` of `from`, every question there answered OK — then the guest bike is `to`. */
  function rebuiltRun(from: PresetId, partIds: string[], id: string) {
    const plan = planFromDisk(buildOf(from), partsScope(...partIds));
    const run = guestRun({
      id,
      build: buildOf(from),
      scope: partsScope(...partIds),
      verdicts: Object.fromEntries(plan.map((step) => [step.key, "ok" as const])),
      startedAt: "2026-10-23T08:00:00.000Z",
    });
    const raw = JSON.stringify({ ...toStored(run), bikeRef: { kind: "local" } });
    window.localStorage.setItem(checkupKey("local"), raw);
    return { plan, raw };
  }

  it("V3-PARTLY-EMPTY: a 2x's front derailleur and chain, the guest bike then a 1x — its parts ask the chain and not the shifting question: the full checkup, that answer named and not past", async () => {
    const { plan, raw } = rebuiltRun(
      "road-rim-2x11",
      ["front-derailleur", "chain"],
      "c9999999-9999-4999-8999-999999999999",
    );
    // On the 2x the shifting question is asked of the front derailleur alone.
    expect(plan.map((step) => [step.key, step.partIds, step.coveredParts])).toEqual([
      [CHAIN, ["chain"], undefined],
      [SHIFTING, ["front-derailleur"], ["front-derailleur"]],
    ]);
    const one = buildOf("gravel-1x11");
    expect(planFromDisk(one, partsScope("front-derailleur", "chain")).map((s) => s.key)).toEqual([
      CHAIN,
    ]);
    const spec = encodeSpec(BIKE_PRESETS["gravel-1x11"]);
    const parts = "front-derailleur,chain";
    const { trail, props } = await walk("local", new URLSearchParams({ spec }).toString());
    expect(trail).toEqual([
      new URLSearchParams({ spec }).toString(),
      new URLSearchParams({ spec, parts, resume: "own" }).toString(),
      new URLSearchParams({ spec, parts, resume: "full" }).toString(),
    ]);
    expect(props.widenedFrom?.steps.map((step) => step.key)).toEqual([CHAIN]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      `comptent désormais pour chacune d'elles — vérifiez-les : ${SHIFTING_TITLE}.`,
    );
    // Given for the front derailleur, it now counts for the rear one and the
    // right shifter.
    expect(props.steps.find((step) => step.key === SHIFTING)?.partIds).toEqual([
      "rear-derailleur",
      "shifter-right",
    ]);
    notPast(props.steps, SHIFTING);
    expect(window.localStorage.getItem(checkupKey("local"))).toBe(raw);
  }, 60_000);

  it("…with the front caliper for the chain: its front-only pads' answer, now counting for both calipers, is where the wizard opens — as the account opens the same run", async () => {
    // The probe that found it (every preset pair, every one- and two-part
    // pick): `road-disc-2x12` then `gravel-1x11` is the corpus's shape where
    // the first named answer comes before the first open question.
    const { plan, raw } = rebuiltRun(
      "road-disc-2x12",
      ["front-derailleur", "brake-caliper-front"],
      "c9999999-9999-4999-8999-999999999998",
    );
    expect(plan.map((step) => [step.key, step.partIds])).toEqual([
      [PAD_WEAR, ["brake-caliper-front"]],
      [ALIGNMENT, ["brake-caliper-front"]],
      [SHIFTING, ["front-derailleur"]],
    ]);
    const spec = encodeSpec(BIKE_PRESETS["gravel-1x11"]);
    const parts = "front-derailleur,brake-caliper-front";
    const { trail, props } = await walk("local", new URLSearchParams({ spec }).toString());
    expect(trail.at(-1)).toBe(new URLSearchParams({ spec, parts, resume: "full" }).toString());
    expect(props.widenedFrom?.steps.map((step) => step.key)).toEqual([PAD_WEAR, ALIGNMENT]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
      `vérifiez-les : ${PADS_TITLE}, « Contrôler l’alignement des étriers » et ${SHIFTING_TITLE}.`,
    );
    expect(props.steps.find((step) => step.key === PAD_WEAR)?.partIds).toEqual([
      "brake-caliper-front",
      "brake-caliper-rear",
    ]);
    // The pads' answer, given for the front caliper and now counting for both,
    // is on screen: the first open question, the rotors', comes after it.
    expect(props.steps.findIndex((step) => !Object.hasOwn(stored()?.answers ?? {}, step.key))).toBe(
      1,
    );
    expect(onScreen()).toBe(PAD_WEAR);
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ok");
    expect(window.localStorage.getItem(checkupKey("local"))).toBe(raw);

    // A saved bike, the same run, the same rebuild: its rows cannot tell the
    // front derailleur on a 1x, and the full checkup opens on the same answer.
    cleanup();
    resetStoredCheckupCache();
    const user = await signedInUser("resume-v32-rebuilt@velo-atelier.test");
    const two = deriveBike(BIKE_PRESETS["road-disc-2x12"]);
    const bike = await prisma.bike.create({
      data: {
        userId: user.id,
        name: "Route",
        answers: two.answers,
        spec: two.spec,
        parts: two.parts as unknown as Prisma.InputJsonValue,
        partStates: { create: two.parts.map((part) => ({ partId: part.partId })) },
      },
      select: { id: true },
    });
    const page = await open(bike.id, `parts=${parts}`);
    await start(page.user);
    for (const key of [PAD_WEAR, ALIGNMENT, SHIFTING]) await verdict(page.user, key, "ok");
    await pagehide();
    cleanup();
    expect((await rowsOf(bike.id)).checkups[0].items).toEqual([
      `${ALIGNMENT}=OK@brake-caliper-front`,
      `${PAD_WEAR}=OK@brake-caliper-front`,
      `${SHIFTING}=OK@front-derailleur`,
    ]);
    const one = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    await prisma.bike.update({
      where: { id: bike.id },
      data: {
        answers: one.answers,
        spec: one.spec,
        parts: one.parts as unknown as Prisma.InputJsonValue,
      },
    });
    const account = await walk(bike.id, "");
    expect(account.trail).toEqual([""]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    expect(onScreen()).toBe(PAD_WEAR);
  }, 90_000);

  /** An old rear-caliper run of `gravel-1x11` whose one answer is the leak question's OK, imported unfinished. */
  async function importedTouchedOnly(email: string, prefix: string) {
    const user = await signedInUser(email);
    const work = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      bikeId: `${prefix}-2222-4333-8444-555555555555`,
      checkup: (build) =>
        guestRun({
          id: `${prefix}-9c1e-4f2b-8d7a-0b4f2c6e1a92`,
          build,
          scope: partsScope("brake-caliper-rear"),
          verdicts: { [HOSE_LEAK]: "ok" },
          startedAt: "2026-10-14T08:00:00.123Z",
          planner: "before-2026-10-22",
        }),
      list: false,
    });
    const payload = JSON.parse(JSON.stringify(work.collect().state)) as GuestState;
    const imported = await importGuestState(prisma, user.id, payload, { plan: planForBuild });
    if (!imported.ok || imported.data.bikeId === null) throw new Error("not imported");
    expect(imported.data.bikes[0].checkups).toEqual([
      { guestKey: `${prefix}-9c1e-4f2b-8d7a-0b4f2c6e1a92`, status: "imported" },
    ]);
    return imported.data.bikeId;
  }

  it("V3-TOUCHED-ONLY: imported PARTIAL on its rear caliper, whose page holds it — and every other page carries it on as the full checkup, no answer being narrowed there; as the guest's own browser does", async () => {
    const bikeId = await importedTouchedOnly("resume-v31@velo-atelier.test", "af1d7a52");
    const imported = await rowsOf(bikeId);
    expect(imported).toMatchObject({
      checkups: [
        { scope: "PARTIAL", status: "IN_PROGRESS", items: [`${HOSE_LEAK}=OK@brake-caliper-rear`] },
      ],
      lines: [],
      states: {},
    });
    // Its own page holds it: the leak question is only touched there.
    const own = await walk(bikeId, "parts=brake-caliper-rear");
    expect(own.trail).toEqual(["parts=brake-caliper-rear"]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle partiel");
    expect(screen.queryByTestId("checkup-resumed")).not.toBeInTheDocument();
    // The banner, another part: the full checkup takes it over, the answer named.
    for (const search of ["", "parts=chain"]) {
      const { trail } = await walk(bikeId, search);
      expect(trail).toEqual([search]);
      expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
      expect(screen.getByTestId("checkup-resumed")).toHaveTextContent(
        "vérifiez-les : « Chercher une fuite de liquide ».",
      );
    }
    // Opening pages wrote nothing.
    expect(await rowsOf(bikeId)).toEqual(imported);

    // The same run in the guest's own browser.
    cleanup();
    resetStoredCheckupCache();
    window.localStorage.setItem(
      checkupKey("demo"),
      JSON.stringify({
        ...toStored(
          guestRun({
            id: "af1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a93",
            build: buildOf("gravel-1x11"),
            scope: partsScope("brake-caliper-rear"),
            verdicts: { [HOSE_LEAK]: "ok" },
            startedAt: "2026-10-14T08:00:00.123Z",
            planner: "before-2026-10-22",
          }),
        ),
        bikeRef: { kind: "demo" },
      }),
    );
    const guest = await walk("demo", "");
    expect(guest.trail).toEqual([
      "",
      "parts=brake-caliper-rear&resume=own",
      "parts=brake-caliper-rear&resume=full",
    ]);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
  }, 90_000);

  it("V3-TOUCHED-ONLY-FINISH: finished from the banner, it is a full checkup — its leak answer closes both brake lines' open lines", async () => {
    const bikeId = await importedTouchedOnly("resume-v31-finish@velo-atelier.test", "bf1d7a52");
    const earlier = await prisma.checkup.create({
      data: {
        bikeId,
        scope: "FULL",
        status: "COMPLETED",
        startedAt: new Date("2026-09-01T08:00:00.000Z"),
        completedAt: new Date("2026-09-01T08:30:00.000Z"),
      },
    });
    const list = await prisma.buildList.create({
      data: { bikeId, checkupId: earlier.id, name: "" },
    });
    await prisma.buildListItem.createMany({
      data: ["brake-line-front", "brake-line-rear"].map((partId, sortOrder) => ({
        buildListId: list.id,
        partId,
        action: "INSPECT_SHOP" as const,
        reasonKey: "hose-leak",
        sortOrder,
      })),
    });
    const page = await open(bikeId);
    expect(screen.getByTestId("checkup-scope")).toHaveTextContent("Contrôle complet");
    await start(page.user);
    await answerTheRest(page.user);
    await page.user.click(screen.getByTestId("summary-create"));
    await answered();
    const after = await rowsOf(bikeId);
    expect(after.checkups[1]).toMatchObject({ scope: "FULL", status: "COMPLETED" });
    expect(after.checkups[1].items).toContain(`${HOSE_LEAK}=OK@brake-lever-front`);
    expect(after.lines).toEqual([
      "INSPECT_SHOP brake-line-front recheck-ok",
      "INSPECT_SHOP brake-line-rear recheck-ok",
    ]);
    expect(after.states).toMatchObject({
      "brake-caliper-front": "OK",
      "brake-caliper-rear": "OK",
      "brake-lever-front": "OK",
      "brake-lever-rear": "OK",
    });
  }, 90_000);
});
