import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { checkupKey } from "@/lib/bike/storage-keys";
import { toStored, type StoredCheckup } from "@/lib/checkup/storage";
import { makeState, threeStepPlan } from "@/tests/_helpers/checkup";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { GuestResumeBanner } from "./GuestResumeBanner";
import { resetStoredCheckupCache } from "./use-stored-checkup";

const PLAN = threeStepPlan();
const [PADS] = PLAN;

function put(stored: StoredCheckup): void {
  window.localStorage.setItem(checkupKey("demo"), JSON.stringify(stored));
}

const IN_PROGRESS = toStored(makeState(PLAN, { answers: { [PADS.key]: "ko" } }));

beforeEach(() => {
  window.localStorage.clear();
  resetStoredCheckupCache();
});

describe("GuestResumeBanner", () => {
  it("offers to resume an unfinished checkup", async () => {
    put({ ...IN_PROGRESS, scope: { kind: "parts", partIds: ["chain"] } });
    await renderWithIntl(<GuestResumeBanner refKind="demo" bikeParam="demo" />);

    await waitFor(() => expect(screen.getByTestId("resume-banner")).toBeInTheDocument());
    expect(screen.getByTestId("resume-cta")).toHaveAttribute("href", "/velo/demo/controle");
    // That the SCOPE travels in the query — so "reprendre" comes back to the
    // question that was asked rather than to a freshly planned full checkup —
    // is asserted by `tests/e2e/checkup-partial.spec.ts`: the `Link` fake in
    // this tier renders the pathname and drops the query.
  });

  it("says nothing when there is no checkup, none started, or one already finished", async () => {
    const { rerender } = await renderWithIntl(
      <GuestResumeBanner refKind="demo" bikeParam="demo" />,
    );
    expect(screen.queryByTestId("resume-banner")).not.toBeInTheDocument();

    put(toStored(makeState(PLAN)));
    resetStoredCheckupCache();
    rerender(<GuestResumeBanner refKind="demo" bikeParam="demo" />);
    expect(screen.queryByTestId("resume-banner")).not.toBeInTheDocument();

    put({ ...IN_PROGRESS, completedAt: "2026-09-19T09:00:00.000Z" });
    resetStoredCheckupCache();
    rerender(<GuestResumeBanner refKind="demo" bikeParam="demo" />);
    expect(screen.queryByTestId("resume-banner")).not.toBeInTheDocument();
  });

  it("is not for a saved bike — that one has a row, and the page reads it", async () => {
    put(IN_PROGRESS);
    await renderWithIntl(<GuestResumeBanner refKind="db" bikeParam="3f2504e0" />);
    expect(screen.queryByTestId("resume-banner")).not.toBeInTheDocument();
  });

  it("reads the LOCAL bike's own key, not the demo one", async () => {
    put({ ...IN_PROGRESS, completedAt: "2026-09-19T09:00:00.000Z" });
    window.localStorage.setItem(
      checkupKey("local"),
      JSON.stringify({ ...IN_PROGRESS, bikeRef: { kind: "local" } }),
    );
    await renderWithIntl(<GuestResumeBanner refKind="local" bikeParam="local" specCode="abc123" />);

    // The demo bike's checkup is finished; the local one is not.
    await waitFor(() => expect(screen.getByTestId("resume-banner")).toBeInTheDocument());
    expect(screen.getByTestId("resume-cta")).toHaveAttribute("href", "/velo/local/controle");
  });
});
