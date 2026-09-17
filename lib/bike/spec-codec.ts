/**
 * Guest spec transport (§5.4): the answers of a `local` bike, packed into a
 * short URL-safe code, so a server-planned page (`/velo/local/controle`,
 * `/liste`, `/reglages`, `/piece/[partId]`) can know the bike without reading
 * `localStorage`.
 *
 * Format (version 1), before base64url:
 *
 *   byte 0         the format version (1)
 *   byte 1 + i     question `QUESTION_IDS[i]`: 0 = not answered,
 *                  n = the n-th option of that node (1-based)
 *
 * 17 bytes → 23 characters, far under the plan's 120. Answers — not the spec —
 * travel, because answers are the source of truth (§1.2) and the spec is
 * derived from them on the server exactly as it is on the client.
 *
 * The decoder is the parser for untrusted input: anything that is not exactly
 * what `encodeSpec` produces — wrong alphabet, length, version, an option index
 * out of range, or an answer the tree would prune (a hidden option, a question
 * that is not asked) — is `null`, and the page answers 404. The validation is
 * hand-written rather than zod: after the byte checks there is no structure
 * left to describe, and this module is imported by client components that
 * build links.
 *
 * Plain TS, zod-free, no React.
 */
import { DECISION_TREE, QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults, pruneAnswers } from "@/lib/domain/engine/decision";
import type { BikeSpec } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";

/** The format version this release writes and reads. */
export const SPEC_CODE_VERSION = 1;

/** Version byte + one byte per question. */
const CODE_BYTES = 1 + QUESTION_IDS.length;

/** base64url of {@link CODE_BYTES} bytes, unpadded. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): Uint8Array | null {
  const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Pack `answers` (pruned first, so the code is canonical: the same bike always
 * gives the same code, whatever stale keys the caller passed).
 */
export function encodeSpec(answers: Answers): string {
  const kept = pruneAnswers(answers);
  const bytes = new Uint8Array(CODE_BYTES);
  bytes[0] = SPEC_CODE_VERSION;
  DECISION_TREE.forEach((node, index) => {
    const answer = kept[node.id];
    if (answer === undefined) return;
    bytes[index + 1] = node.options.findIndex((option) => option.id === answer) + 1;
  });
  return toBase64Url(bytes);
}

/** The answers inside a code, or `null` when the code is not one `encodeSpec` would write. */
export function decodeAnswers(code: unknown): Answers | null {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  const bytes = fromBase64Url(code);
  if (bytes === null || bytes.length !== CODE_BYTES || bytes[0] !== SPEC_CODE_VERSION) return null;

  const answers: Answers = {};
  for (const [index, node] of DECISION_TREE.entries()) {
    const value = bytes[index + 1];
    if (value === 0) continue;
    const option = node.options[value - 1];
    if (option === undefined) return null;
    answers[node.id] = option.id;
  }

  // Canonical or nothing: an answer the tree would drop means a forged code.
  const kept = pruneAnswers(answers);
  if (Object.keys(kept).length !== Object.keys(answers).length) return null;
  // And the round trip must be exact (no non-canonical base64 spelling of the same bytes).
  return encodeSpec(kept) === code ? kept : null;
}

/** The bike a code describes, with every unanswered question at its default; `null` when invalid. */
export function decodeSpec(code: unknown): BikeSpec | null {
  const answers = decodeAnswers(code);
  return answers === null ? null : buildBikeSpec(answerWithDefaults(answers));
}
