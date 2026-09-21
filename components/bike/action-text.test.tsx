/**
 * `useBikeActionText()` — how the bike workspace renders the message KEY a
 * write answers with (§1.2 `ActionResult`: `errors.<code>` headlines,
 * `bike.errors.<reason>` field messages) now that the `/velo` and garage routes
 * ship only the namespaces they declare (`lib/i18n/client-namespaces.ts`,
 * `.debug/008`).
 *
 * The provider below holds ONLY `bike` and `errors`, the two namespaces the
 * hook claims — which is the point: with a root translator any namespace would
 * have done, and the route had to ship all of them.
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { ACTION_ERROR_CODES } from "@/lib/actions/result";
import type { BuildChangeCode } from "@/lib/domain/engine/validate-build";
import { loadMessages } from "@/lib/i18n/request";
import type { Locale } from "@/lib/i18n/routing";

import { useBikeActionText } from "./action-text";

/**
 * Every refusal `setAttribute` / `addPart` / `removePart` can return — the
 * panel shows `bike.errors.<code>` for each (`lib/bike/repo.ts`,
 * `updateBikePartAction`). Typed exhaustively, so a new domain code fails the
 * build here until it is listed, and then fails the test until it has a message.
 */
const DOMAIN_REFUSALS = {
  "unknown-part": true,
  "part-not-fitted": true,
  "unknown-attribute": true,
  "not-editable": true,
  "invalid-value": true,
  "not-optional": true,
  "already-fitted": true,
} as const satisfies Record<BuildChangeCode, true>;

/** The field messages the repo and the actions write themselves. */
const WRITE_REFUSALS = ["storageFull", "fitRange", "nameRequired", "nameTooLong"] as const;

const KEYS = [
  ...ACTION_ERROR_CODES.map((code) => `errors.${code}`),
  ...Object.keys(DOMAIN_REFUSALS).map((code) => `bike.errors.${code}`),
  ...WRITE_REFUSALS.map((reason) => `bike.errors.${reason}`),
];

function Probe({ keys }: { keys: readonly string[] }): React.JSX.Element {
  const text = useBikeActionText();
  return (
    <ul>
      {keys.map((key) => (
        <li key={key} data-testid={key}>
          {text(key)}
        </li>
      ))}
    </ul>
  );
}

async function renderScoped(locale: Locale, keys: readonly string[]) {
  const all = await loadMessages(locale);
  const onError = vi.fn();
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Europe/Paris"
      messages={Object.fromEntries(["bike", "errors"].map((ns) => [ns, all[ns]]))}
      onError={onError}
    >
      <Probe keys={keys} />
    </NextIntlClientProvider>,
  );
  return { all, onError };
}

function lookup(messages: Record<string, unknown>, key: string): unknown {
  const [namespace, ...rest] = key.split(".");
  const section = messages[namespace!] as Record<string, unknown>;
  const path = rest.join(".");
  // `bike.errors.<reason>`: one level of nesting, and reasons can contain dashes.
  if (path.startsWith("errors.")) return (section.errors as Record<string, unknown>)[path.slice(7)];
  return section[path];
}

describe("useBikeActionText", () => {
  for (const locale of ["fr", "en"] as const) {
    it(`renders every key a bike write can answer with, from bike + errors alone (${locale})`, async () => {
      const { all, onError } = await renderScoped(locale, KEYS);
      for (const key of KEYS) {
        const expected = lookup(all, key);
        expect(typeof expected, `${key} has no ${locale} message`).toBe("string");
        expect(screen.getByTestId(key).textContent).toBe(expected);
      }
      expect(onError).not.toHaveBeenCalled();
    });
  }

  it("reports a key from a namespace it was not given, instead of resolving it elsewhere", async () => {
    const { onError } = await renderScoped("fr", ["rules.brakes.message"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![0])).toMatch(/MISSING_MESSAGE/);
    // next-intl's own fallback for a missing key: `<namespace>.<key>`, here the
    // first translator's (`errors`) with the key handed over unchanged.
    expect(screen.getByTestId("rules.brakes.message").textContent).toBe(
      "errors.rules.brakes.message",
    );
  });
});
