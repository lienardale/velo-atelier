/**
 * `/import`, the half that runs in the browser: what the page DOES with the
 * server's answer.
 *
 * `settleGuestImport` decides which keys may be forgotten and
 * `lib/guest/schema.test.ts` holds it; this file holds the WIRING — that the
 * page really collects from `localStorage`, sends what it collected, clears
 * the keys the settlement names and no other, and tells the visitor, in their
 * language, when their checkup was not imported. Until 2026-10-07 the page
 * called a `clearGuestState()` that removed all three keys after any
 * successful import, including the checkup the importer had skipped
 * (`.debug/017` §5.6); nothing below a browser test could see that.
 *
 * The storage is filled by `tests/_helpers/guest-work.ts`, i.e. by the wizard's
 * own writers, and copied into jsdom's `localStorage`. Only the server action
 * is a stand-in: each case is one answer the server can give.
 */
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/actions/result";
import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import type { GuestCheckupImport, GuestImportSummary, GuestState } from "@/lib/guest/schema";
import type { Locale } from "@/lib/i18n/routing";
import { routerSpies } from "@/tests/_fakes/session";
import { guestRun, guestWork, partsScope } from "@/tests/_helpers/guest-work";
import { messagesFor, renderWithIntl } from "@/tests/_helpers/intl";

const importAction = vi.fn<(input: unknown) => Promise<ActionResult<GuestImportSummary>>>();

// The real module is a `"use server"` file: evaluated in jsdom it would pull in
// `server-only`, Prisma and the compiled corpus.
vi.mock("@/app/[locale]/(protected)/import/actions", () => ({
  importGuestStateAction: (input: unknown) => importAction(input),
}));

const toast =
  vi.fn<(title: string, options?: { description?: string; duration?: number }) => void>();
vi.mock("sonner", () => ({
  toast: (title: string, options?: { description?: string; duration?: number }) =>
    toast(title, options),
}));

const { GuestImport } = await import("@/app/[locale]/(protected)/import/GuestImport");

const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const BIKE_ROW = "00000000-0000-4000-8000-0000000000b1";
const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";

const KEYS = [LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")] as const;

/** A guest bike, a finished checkup and its list — as the wizard leaves them. */
const WORK = guestWork({
  answers: BIKE_PRESETS["gravel-1x11"],
  checkup: (build) =>
    guestRun({
      id: CHECKUP_ID,
      build,
      scope: partsScope("chain", "cassette"),
      verdicts: { [CHAIN]: { ko: ["chain-elongation"] }, [CASSETTE]: "ok" },
      startedAt: "2026-09-14T08:00:00.000Z",
      completedAt: "2026-09-14T08:20:00.000Z",
    }),
});
const [BIKE_RAW, CHECKUP_RAW, LIST_RAW] = KEYS.map((key) => WORK.storage.getItem(key) as string);

/** What this browser holds under the three guest keys, in `KEYS` order. */
const stored = () => KEYS.map((key) => window.localStorage.getItem(key));

/** The server's answer for this browser's bike. */
function answer(
  checkups: GuestCheckupImport[],
  skipped?: "already-imported",
): ActionResult<GuestImportSummary> {
  return {
    ok: true,
    data: {
      bikeId: BIKE_ROW,
      bikes: [
        { localId: WORK.bike.id, bikeId: BIKE_ROW, ...(skipped ? { skipped } : {}), checkups },
      ],
      imported: skipped ? 0 : 1,
      skipped: skipped ? 1 : 0,
    },
  };
}

interface ImportMessages {
  done: string;
  alreadyDone: string;
  failedHelp: string;
  checkupKept: Record<
    "unreadable" | "nothingKept" | "bikeAlreadyImported" | "otherBike" | "unconfirmed",
    string
  >;
}

async function importMessages(locale: Locale): Promise<ImportMessages> {
  const messages = await messagesFor(locale);
  return (messages.account as { import: ImportMessages }).import;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(LOCAL_BIKE_KEY, BIKE_RAW);
  window.localStorage.setItem(checkupKey("local"), CHECKUP_RAW);
  window.localStorage.setItem(buildListKey("local"), LIST_RAW);
});

describe.each(["fr", "en"] as const)("the import page (%s)", (locale) => {
  it("sends what the wizard stored, and forgets all three keys once the checkup is in the account", async () => {
    importAction.mockResolvedValue(answer([{ guestKey: CHECKUP_ID, status: "imported" }]));
    const t = await importMessages(locale);
    await renderWithIntl(<GuestImport />, { locale });

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    // The payload is the collector's: the bike, and its checkup as ANSWERS.
    const sent = importAction.mock.calls[0][0] as GuestState;
    expect(sent.bikes).toHaveLength(1);
    expect(sent.bikes[0].localId).toBe(WORK.bike.id);
    expect(sent.bikes[0].checkups).toEqual([
      expect.objectContaining({
        guestKey: CHECKUP_ID,
        answers: { [CHAIN]: "ko", [CASSETTE]: "ok" },
      }),
    ]);
    expect(sent.bikes[0].lists).toHaveLength(1);

    expect(stored()).toEqual([null, null, null]);
    // Nothing to add: the checkup WAS imported.
    expect(toast).toHaveBeenCalledWith(t.done, undefined);
    expect(routerSpies.replace).toHaveBeenCalledWith({
      pathname: "/velo/[id]",
      params: { id: BIKE_ROW },
    });
  });

  it("forgets all three keys when the account already held the bike AND the checkup", async () => {
    importAction.mockResolvedValue(
      answer([{ guestKey: CHECKUP_ID, status: "already-imported" }], "already-imported"),
    );
    const t = await importMessages(locale);
    await renderWithIntl(<GuestImport />, { locale });

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(stored()).toEqual([null, null, null]);
    expect(toast).toHaveBeenCalledWith(t.alreadyDone, undefined);
  });

  it.each([
    ["nothing-kept", "nothingKept", undefined],
    ["bike-already-imported", "bikeAlreadyImported", "already-imported"],
    // A NEW bike, imported — without a checkup the account holds under another.
    ["other-bike", "otherBike", undefined],
  ] as const)(
    "KEEPS the checkup the server skipped (%s), and says so",
    async (reason, messageKey, skipped) => {
      importAction.mockResolvedValue(
        answer([{ guestKey: CHECKUP_ID, status: "skipped", reason }], skipped),
      );
      const t = await importMessages(locale);
      await renderWithIntl(<GuestImport />, { locale });

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
      // The bike and the list are the account's now; the checkup is still here,
      // byte for byte.
      expect(stored()).toEqual([null, CHECKUP_RAW, null]);
      const [title, options] = toast.mock.calls[0];
      expect(title).toBe(skipped ? t.alreadyDone : t.done);
      // eslint-disable-next-line security/detect-object-injection -- one of the literal keys of the rows above
      expect(options?.description).toBe(t.checkupKept[messageKey]);
      // A sentence of its own: no reason borrows another's wording.
      expect(
        Object.values(t.checkupKept).filter((sentence) => sentence === options?.description),
      ).toHaveLength(1);
      // Long enough to be read: sonner's default is four seconds.
      expect(options?.duration).toBeGreaterThanOrEqual(10_000);
      expect(routerSpies.replace).toHaveBeenCalledWith({
        pathname: "/velo/[id]",
        params: { id: BIKE_ROW },
      });
    },
  );

  it("KEEPS a checkup it could not read, sends none, and says so", async () => {
    const corrupted = CHECKUP_RAW.slice(0, Math.floor(CHECKUP_RAW.length / 2));
    window.localStorage.setItem(checkupKey("local"), corrupted);
    // The server saw a bike with no checkup, and reports none.
    importAction.mockResolvedValue(answer([]));
    const t = await importMessages(locale);
    await renderWithIntl(<GuestImport />, { locale });

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect((importAction.mock.calls[0][0] as GuestState).bikes[0].checkups).toEqual([]);
    expect(stored()).toEqual([null, corrupted, null]);
    expect(toast).toHaveBeenCalledWith(
      t.done,
      expect.objectContaining({ description: t.checkupKept.unreadable }),
    );
  });

  it("KEEPS a checkup the answer does not name, and says so", async () => {
    // A checkup was sent; nothing in the answer says what became of it.
    importAction.mockResolvedValue(answer([]));
    const t = await importMessages(locale);
    await renderWithIntl(<GuestImport />, { locale });

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(stored()).toEqual([null, CHECKUP_RAW, null]);
    expect(toast).toHaveBeenCalledWith(
      t.done,
      expect.objectContaining({ description: t.checkupKept.unconfirmed }),
    );
  });

  it("says nothing about a checkup when there was none to import", async () => {
    window.localStorage.removeItem(checkupKey("local"));
    importAction.mockResolvedValue(answer([]));
    const t = await importMessages(locale);
    await renderWithIntl(<GuestImport />, { locale });

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(stored()).toEqual([null, null, null]);
    expect(toast).toHaveBeenCalledWith(t.done, undefined);
  });

  it.each(["VALIDATION", "RATE_LIMITED", "TOO_MANY"] as const)(
    "keeps EVERY key when the import is refused (%s)",
    async (code) => {
      importAction.mockResolvedValue({ ok: false, code });
      const t = await importMessages(locale);
      await renderWithIntl(<GuestImport />, { locale });

      // The refusal is shown, with a way to try again…
      expect(await screen.findByTestId("guest-import-error")).toBeVisible();
      expect(screen.getByTestId("guest-import-status")).toHaveTextContent(t.failedHelp);
      expect(screen.getByTestId("guest-import-retry")).toBeVisible();
      // …and nothing this browser holds was touched.
      expect(stored()).toEqual([BIKE_RAW, CHECKUP_RAW, LIST_RAW]);
      expect(toast).not.toHaveBeenCalled();
      expect(routerSpies.replace).not.toHaveBeenCalled();
    },
  );

  it("sends a browser with no guest bike to the garage, and asks the server nothing", async () => {
    window.localStorage.clear();
    // A checkup alone is not something to import: there is no bike to hang it on.
    window.localStorage.setItem(checkupKey("local"), CHECKUP_RAW);
    await renderWithIntl(<GuestImport />, { locale });

    await waitFor(() =>
      expect(routerSpies.replace).toHaveBeenCalledWith({ pathname: "/mes-velos" }),
    );
    expect(importAction).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(checkupKey("local"))).toBe(CHECKUP_RAW);
  });
});
