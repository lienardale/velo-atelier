/**
 * `usePartsText()` — the part panel's attribute labels (§6.4) come from keys
 * the catalogue carries (`parts.attr.<key>.label`, `lib/domain/data/parts`),
 * and the `/velo` routes now ship `parts` without the rest of the catalogue
 * (`lib/i18n/client-namespaces.ts`, `.debug/008`).
 *
 * The provider holds ONLY `parts`: every label of every part resolves inside
 * it, in both locales, with no message reported missing.
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { PARTS } from "@/lib/domain/data/parts";
import { loadMessages } from "@/lib/i18n/request";

import { usePartsText } from "./parts-text";

const LABEL_KEYS = [
  ...new Set(PARTS.flatMap((part) => part.attributes.map((attribute) => attribute.labelKey))),
];

function Probe({ keys }: { keys: readonly string[] }): React.JSX.Element {
  const text = usePartsText();
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

describe("usePartsText", () => {
  it("has attribute labels to resolve (the catalogue is not empty)", () => {
    expect(LABEL_KEYS.length).toBeGreaterThan(10);
    for (const key of LABEL_KEYS) expect(key).toMatch(/^parts\.attr\.[a-z0-9-]+\.label$/);
  });

  for (const locale of ["fr", "en"] as const) {
    it(`resolves every attribute label from the parts namespace alone (${locale})`, async () => {
      const all = await loadMessages(locale);
      const attr = (all.parts as { attr: Record<string, { label: string }> }).attr;
      const onError = vi.fn();
      render(
        <NextIntlClientProvider
          locale={locale}
          timeZone="Europe/Paris"
          messages={Object.fromEntries([["parts", all.parts]])}
          onError={onError}
        >
          <Probe keys={LABEL_KEYS} />
        </NextIntlClientProvider>,
      );
      for (const key of LABEL_KEYS) {
        const attributeKey = key.slice("parts.attr.".length, -".label".length);
        expect(screen.getByTestId(key).textContent).toBe(attr[attributeKey]!.label);
      }
      expect(onError).not.toHaveBeenCalled();
    });
  }
});
