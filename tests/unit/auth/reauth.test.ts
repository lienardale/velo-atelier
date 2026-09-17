import { describe, expect, it } from "vitest";

import { hasFreshGoogleAuth, REAUTH_WINDOW_MS } from "@/lib/auth/reauth";

const NOW = 1_780_000_000_000;

describe("hasFreshGoogleAuth", () => {
  it("accepts a Google sign-in inside the window, edges included", () => {
    expect(hasFreshGoogleAuth({ authProvider: "google", authAt: NOW }, NOW)).toBe(true);
    expect(
      hasFreshGoogleAuth({ authProvider: "google", authAt: NOW - REAUTH_WINDOW_MS }, NOW),
    ).toBe(true);
  });

  it("refuses a Google sign-in older than the window", () => {
    expect(
      hasFreshGoogleAuth({ authProvider: "google", authAt: NOW - REAUTH_WINDOW_MS - 1 }, NOW),
    ).toBe(false);
  });

  it("refuses any other provider, a missing stamp, and a stamp from the future", () => {
    expect(hasFreshGoogleAuth({ authProvider: "credentials", authAt: NOW }, NOW)).toBe(false);
    expect(hasFreshGoogleAuth({ authProvider: "google" }, NOW)).toBe(false);
    expect(hasFreshGoogleAuth({}, NOW)).toBe(false);
    expect(hasFreshGoogleAuth({ authProvider: "google", authAt: NOW + 60_000 }, NOW)).toBe(false);
  });
});
