import { act, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { LOCAL_BIKE_STORAGE_KEY, MyBikeLink } from "./MyBikeLink";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("MyBikeLink", () => {
  it("uses the storage key of the guest-bike contract (§1.2)", () => {
    expect(LOCAL_BIKE_STORAGE_KEY).toBe("va:bike:local");
  });

  it("points at the demo bike when no guest bike is stored", async () => {
    await renderWithIntl(<MyBikeLink className="nav">Mon vélo</MyBikeLink>);
    const link = screen.getByRole("link", { name: "Mon vélo" });
    expect(link).toHaveAttribute("href", "/velo/demo");
    expect(link).toHaveClass("nav");
  });

  it("server-renders the demo link even when a guest bike is stored (hydration-safe)", () => {
    window.localStorage.setItem(LOCAL_BIKE_STORAGE_KEY, "{}");
    const html = renderToString(<MyBikeLink>Mon vélo</MyBikeLink>);
    expect(html).toContain('href="/velo/demo"');
    expect(html).not.toContain("/velo/local");
  });

  it("points at the guest bike when one is stored", async () => {
    window.localStorage.setItem(LOCAL_BIKE_STORAGE_KEY, "{}");
    await renderWithIntl(<MyBikeLink>Mon vélo</MyBikeLink>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/velo/local");
  });

  it("follows a bike saved or removed in another tab", async () => {
    await renderWithIntl(<MyBikeLink>Mon vélo</MyBikeLink>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/velo/demo");

    act(() => {
      window.localStorage.setItem(LOCAL_BIKE_STORAGE_KEY, "{}");
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_BIKE_STORAGE_KEY }));
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/velo/local");

    act(() => {
      window.localStorage.removeItem(LOCAL_BIKE_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_BIKE_STORAGE_KEY }));
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/velo/demo");
  });

  it("falls back to the demo bike when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await renderWithIntl(<MyBikeLink>Mon vélo</MyBikeLink>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/velo/demo");
  });
});
