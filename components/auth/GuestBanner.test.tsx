import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { GuestBanner } from "./GuestBanner";

/**
 * The invitation that makes `/import` findable (§6.5).
 *
 * Two things are worth a test rather than a read-through: it renders NOTHING
 * when the browser holds no guest bike (it sits at the top of every visit to
 * `/mes-velos`), and it never parses what it finds — presence of the key is the
 * whole decision, because parsing means the part catalogue and `/mes-velos` has
 * a bundle budget.
 */

afterEach(() => {
  window.localStorage.clear();
});

describe("GuestBanner", () => {
  it("renders nothing when this browser has no guest bike", async () => {
    const { container } = await renderWithIntl(<GuestBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("invites the visitor to import, and links to /import", async () => {
    window.localStorage.setItem(LOCAL_BIKE_KEY, JSON.stringify({ version: 1 }));
    await renderWithIntl(<GuestBanner />);

    expect(screen.getByTestId("guest-banner")).toBeInTheDocument();
    expect(screen.getByText("Un vélo attend sur cet appareil")).toBeInTheDocument();
    expect(screen.getByTestId("guest-banner-cta")).toHaveAttribute("href", "/import");
  });

  it("shows up for an unreadable payload too — /import decides, not the banner", async () => {
    window.localStorage.setItem(LOCAL_BIKE_KEY, "{not json");
    await renderWithIntl(<GuestBanner />);
    expect(screen.getByTestId("guest-banner")).toBeInTheDocument();
  });

  /**
   * A bare `Event`, not a `StorageEvent` — for THIS component. `subscribe()`
   * here registers a listener that takes no argument and re-reads
   * `localStorage` itself, so the event's `key` and `newValue` are never looked
   * at: for `GuestBanner` the notification is the whole payload, and writing
   * the key into the event would assert something the component does not read.
   * It also keeps CodeQL honest: its bundled extern still models `StorageEvent`
   * as zero-arity (a 2011 draft), so the two real constructor arguments read as
   * superfluous (`js/superfluous-trailing-arguments`).
   *
   * Not a repository-wide rule: `components/shop/item-prefill.ts` filters on
   * `event.key`, so a test for that one needs a real `StorageEvent` and will
   * raise the same alert — dismiss it there rather than weakening the test.
   */
  it("follows another tab: importing there takes the banner away here", async () => {
    window.localStorage.setItem(LOCAL_BIKE_KEY, JSON.stringify({ version: 1 }));
    const { container } = await renderWithIntl(<GuestBanner />);
    expect(screen.getByTestId("guest-banner")).toBeInTheDocument();

    act(() => {
      window.localStorage.removeItem(LOCAL_BIKE_KEY);
      window.dispatchEvent(new Event("storage"));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("speaks English on the English garage", async () => {
    window.localStorage.setItem(LOCAL_BIKE_KEY, JSON.stringify({ version: 1 }));
    await renderWithIntl(<GuestBanner />, { locale: "en" });
    expect(screen.getByText("A bike is waiting on this device")).toBeInTheDocument();
  });
});
