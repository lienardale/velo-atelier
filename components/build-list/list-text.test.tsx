/**
 * `useListText()` — how a build-list line renders the message KEYS it carries
 * (§5.4 reasons `guides.reasons.<reasonKey>`, compatibility issues
 * `rules.<group>.{message,fix}`) now that `/velo/[id]/liste` ships only the
 * namespaces it declares (`lib/i18n/client-namespaces.ts`, `.debug/008`).
 *
 * The provider below holds ONLY `guides` and `rules`, the two namespaces the
 * hook claims — which is the point: with a root translator any namespace would
 * have done, and the route had to ship all sixteen.
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/lib/i18n/request";
import type { Locale } from "@/lib/i18n/routing";

import { useListText } from "./list-text";

type Section = Record<string, unknown>;

/** Every key a line can carry, read from the catalogue itself so a new reason or rule is covered. */
function keysOf(all: Record<string, unknown>): string[] {
  const reasons = Object.keys((all.guides as Section).reasons as Section).map(
    (reason) => `guides.reasons.${reason}`,
  );
  const rules = Object.entries(all.rules as Section).flatMap(([group, texts]) =>
    Object.keys(texts as Section).map((leaf) => `rules.${group}.${leaf}`),
  );
  return [...reasons, ...rules];
}

function lookup(all: Record<string, unknown>, key: string): unknown {
  const [namespace, first, second] = key.split(".") as [string, string, string];
  return ((all[namespace] as Section)[first] as Section)[second];
}

function Probe({ keys }: { keys: readonly string[] }): React.JSX.Element {
  const text = useListText();
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

async function renderScoped(locale: Locale, keys?: readonly string[]) {
  const all = await loadMessages(locale);
  const onError = vi.fn();
  const shown = keys ?? keysOf(all);
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Europe/Paris"
      messages={Object.fromEntries(["guides", "rules"].map((ns) => [ns, all[ns]]))}
      onError={onError}
    >
      <Probe keys={shown} />
    </NextIntlClientProvider>,
  );
  return { all, onError, shown };
}

describe("useListText", () => {
  for (const locale of ["fr", "en"] as const) {
    it(`renders every reason and every rule message from guides + rules alone (${locale})`, async () => {
      const { all, onError, shown } = await renderScoped(locale);
      expect(shown.length).toBeGreaterThan(60);
      for (const key of shown) {
        const expected = lookup(all, key);
        expect(typeof expected, `${key} has no ${locale} message`).toBe("string");
        expect(screen.getByTestId(key).textContent).toBe(expected);
      }
      expect(onError).not.toHaveBeenCalled();
    });
  }

  it("reports a key from a namespace it was not given, instead of resolving it elsewhere", async () => {
    const { onError } = await renderScoped("fr", ["shop.list.title"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![0])).toMatch(/MISSING_MESSAGE/);
    // next-intl's own fallback for a missing key: the first translator's
    // namespace (`guides`) with the key handed over unchanged.
    expect(screen.getByTestId("shop.list.title").textContent).toBe("guides.shop.list.title");
  });
});
