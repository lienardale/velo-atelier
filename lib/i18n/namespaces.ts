/**
 * The message namespaces `lib/i18n/request.ts` merges, one file per namespace
 * under `messages/<locale>/<namespace>.json` (§1.2). Each file becomes a
 * top-level object keyed by its file name: `messages/fr/common.json` is
 * `t("common.…")` / `useTranslations("common")`.
 *
 * Appended by the orchestrator at wave integration (never by a task). Adding a
 * namespace is TWO lines in this file — the `import type` and the entries in
 * `NAMESPACES` and `NamespaceMessages` — and a JSON file per locale.
 * `tests/unit/i18n/messages-parity.test.ts` fails if the list, the type map and
 * the files on disk disagree; `tsc` fails if the list and the type map do.
 *
 * Names match /^[a-z-]+$/ (they are file names and top-level message keys).
 */
import type common from "@/messages/fr/common.json";

export const NAMESPACES = ["common"] as const;

export type Namespace = (typeof NAMESPACES)[number];

/**
 * The shape of the merged catalogue, typed from the French files (French is the
 * source language; the parity test holds English to the same keys).
 * `global.d.ts` hands this to next-intl's `AppConfig.Messages`, so an unknown
 * key in `t()` fails `npm run typecheck`.
 */
export interface NamespaceMessages {
  common: typeof common;
}

// Compile-time guard: every namespace in the list has a type, and vice versa.
type MissingType = Exclude<Namespace, keyof NamespaceMessages>;
type MissingEntry = Exclude<keyof NamespaceMessages, Namespace>;
export type NamespacesInSync = [MissingType, MissingEntry] extends [never, never]
  ? true
  : {
      error: "NAMESPACES and NamespaceMessages disagree";
      missingType: MissingType;
      missingEntry: MissingEntry;
    };
const namespacesInSync: NamespacesInSync = true;
void namespacesInSync;
