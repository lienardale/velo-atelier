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
 * Names match /^[a-z0-9-]+$/ (they are file names and top-level message keys; no dots).
 *
 * W1 namespaces were registered up front (W1 integration, 2026-09-12) with empty
 * `{}` files, because tasks that run in parallel cannot each append to this one
 * array without racing. Each task fills only its own JSON files; the owner of
 * every namespace is Appendix A of the plan. `checkup`, `seo` and `shop` were
 * registered the same way before W3's four tasks branched (2026-09-19).
 */
import type account from "@/messages/fr/account.json";
import type bike from "@/messages/fr/bike.json";
import type bike3d from "@/messages/fr/bike3d.json";
import type checkup from "@/messages/fr/checkup.json";
import type auth from "@/messages/fr/auth.json";
import type common from "@/messages/fr/common.json";
import type decision from "@/messages/fr/decision.json";
import type decisionTree from "@/messages/fr/decision-tree.json";
import type errors from "@/messages/fr/errors.json";
import type guides from "@/messages/fr/guides.json";
import type illustrations from "@/messages/fr/illustrations.json";
import type parts from "@/messages/fr/parts.json";
import type rules from "@/messages/fr/rules.json";
import type seo from "@/messages/fr/seo.json";
import type shop from "@/messages/fr/shop.json";
import type tools from "@/messages/fr/tools.json";

export const NAMESPACES = [
  "account",
  "auth",
  "bike",
  "bike3d",
  "checkup",
  "common",
  "decision",
  "decision-tree",
  "errors",
  "guides",
  "illustrations",
  "parts",
  "rules",
  "seo",
  "shop",
  "tools",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/**
 * The shape of the merged catalogue, typed from the French files (French is the
 * source language; the parity test holds English to the same keys).
 * `global.d.ts` hands this to next-intl's `AppConfig.Messages`, so an unknown
 * key in `t()` fails `npm run typecheck`.
 */
export interface NamespaceMessages {
  account: typeof account;
  auth: typeof auth;
  bike: typeof bike;
  bike3d: typeof bike3d;
  checkup: typeof checkup;
  common: typeof common;
  decision: typeof decision;
  "decision-tree": typeof decisionTree;
  errors: typeof errors;
  guides: typeof guides;
  illustrations: typeof illustrations;
  parts: typeof parts;
  rules: typeof rules;
  seo: typeof seo;
  shop: typeof shop;
  tools: typeof tools;
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
