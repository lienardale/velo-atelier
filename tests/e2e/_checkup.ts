/**
 * What the checkup specs read out of the browser.
 *
 * The wizard's whole contract with storage is two keys, so the tests read them
 * directly rather than inferring state from pixels: `va:checkup:<ref>` is what
 * survives a reload, and `va:buildlist:<ref>` is what the list page (W3-T2)
 * picks up. Asserting the stored shape is also what proves the plan was
 * recomputed rather than trusted — a key that is not in today's plan never
 * reaches it.
 */
import type { Page } from "@playwright/test";

import type { BuildListItem, CheckupState } from "../../lib/checkup/types";
import { buildListKey, checkupKey, type GuestBikeRef } from "../../lib/bike/storage-keys";

/** The stored checkup of a guest bike, as JSON. */
export async function storedCheckup(
  page: Page,
  ref: GuestBikeRef = "demo",
): Promise<{
  answers: Record<string, string>;
  symptoms: Record<string, string[]>;
  notes: Record<string, string>;
  toolsMissing: string[];
  completedAt?: string;
  scope: CheckupState["scope"];
} | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), checkupKey(ref));
  return raw === null ? null : JSON.parse(raw);
}

/** The derived to-fix list of a guest bike. */
export async function storedBuildList(
  page: Page,
  ref: GuestBikeRef = "demo",
): Promise<{ items: BuildListItem[] } | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), buildListKey(ref));
  return raw === null ? null : JSON.parse(raw);
}

/** The verdict stored for one step, or `undefined`. */
export async function verdictFor(
  page: Page,
  stepKey: string,
  ref: GuestBikeRef = "demo",
): Promise<string | undefined> {
  const stored = await storedCheckup(page, ref);
  // eslint-disable-next-line security/detect-object-injection -- a step key the spec spells out
  return stored?.answers[stepKey];
}

/** The symptoms ticked on one step. */
export async function symptomsFor(
  page: Page,
  stepKey: string,
  ref: GuestBikeRef = "demo",
): Promise<string[] | undefined> {
  const stored = await storedCheckup(page, ref);
  // eslint-disable-next-line security/detect-object-injection -- a step key the spec spells out
  return stored?.symptoms[stepKey];
}

/** The note written on one step. */
export async function noteFor(
  page: Page,
  stepKey: string,
  ref: GuestBikeRef = "demo",
): Promise<string | undefined> {
  const stored = await storedCheckup(page, ref);
  // eslint-disable-next-line security/detect-object-injection -- a step key the spec spells out
  return stored?.notes[stepKey];
}
