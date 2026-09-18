/**
 * Put a guest bike in the browser before the page loads — the e2e equivalent of
 * "the visitor already answered the decision tree".
 *
 * The payload is produced by `writeLocalBike` itself, against a throwaway
 * in-memory storage, so the fixture can never drift from what the app writes:
 * if the envelope gains a field, this gains it too, and if `parseLocalBike`
 * would reject what the tree produces, these tests fail rather than the users.
 *
 * `addInitScript` rather than `page.evaluate` after a `goto`: the workspace
 * reads storage on its first render, so a bike written afterwards would arrive
 * one redirect too late.
 */
import type { Page } from "@playwright/test";

import { writeLocalBike, type KeyValueStorage, type LocalBike } from "../../lib/bike/local-bike";
import { encodeSpec } from "../../lib/bike/spec-codec";
import { LOCAL_BIKE_KEY } from "../../lib/bike/storage-keys";
import type { Answers } from "../../lib/domain/schema/decision";

/** A `localStorage` stand-in for Node. */
function memoryStorage(): KeyValueStorage & { value: string | null } {
  const store = { value: null as string | null };
  return {
    get value() {
      return store.value;
    },
    getItem: () => store.value,
    setItem: (_key: string, value: string) => {
      store.value = value;
    },
    removeItem: () => {
      store.value = null;
    },
  };
}

export interface SeededLocalBike {
  bike: LocalBike;
  /** The JSON exactly as it sits under `va:bike:local`. */
  raw: string;
  /** `?spec=` for the server-planned routes of a guest bike (§5.4). */
  specCode: string;
}

/** Build the payload without touching a browser — useful for assertions. */
export function localBikePayload(
  answers: Answers,
  fit: Record<string, number> | null = null,
): SeededLocalBike {
  const storage = memoryStorage();
  const bike = writeLocalBike({ answers, fit }, { storage });
  if (bike === null || storage.value === null) throw new Error("writeLocalBike refused to write");
  return { bike, raw: storage.value, specCode: encodeSpec(bike.answers) };
}

/** Seed `va:bike:local` for every navigation this page makes from now on. */
export async function seedLocalBike(
  page: Page,
  answers: Answers,
  fit: Record<string, number> | null = null,
): Promise<SeededLocalBike> {
  const seeded = localBikePayload(answers, fit);
  // Runs before EVERY document load, so it must not overwrite what the page
  // itself has written since: a reload is exactly how these specs prove an edit
  // was persisted, and re-seeding on the way back in would erase the evidence.
  await page.addInitScript(
    ([key, raw]) => {
      try {
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, raw);
      } catch {
        // A browser with storage disabled has nothing to seed; the spec that
        // needs a bike will fail on its own assertion, with a better message.
      }
    },
    [LOCAL_BIKE_KEY, seeded.raw] as const,
  );
  return seeded;
}

/** Read `va:bike:local` back out of the browser. */
export async function readStoredLocalBike(page: Page): Promise<LocalBike | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), LOCAL_BIKE_KEY);
  return raw === null ? null : (JSON.parse(raw) as LocalBike);
}
