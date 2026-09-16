"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";

import {
  PASSWORD_MIN_SCORE,
  passwordRuleStates,
  type PasswordRuleState,
} from "@/lib/auth/password-strength";

/**
 * The live password meter on the sign-up and change-password forms.
 *
 * Two layers, and the split is the whole point:
 *
 * - the **four syntactic rules** come from `lib/auth/password-strength.ts`,
 *   which has no dependencies, runs on every keystroke, and is the same module
 *   the server enforces. They render as a checklist, because "at least 12
 *   characters" is something a person can act on;
 * - the **score** comes from zxcvbn, loaded with a dynamic `import()` the first
 *   time someone types. Its dictionaries are several hundred kilobytes, so they
 *   must not sit in the initial bundle, and until they arrive the meter simply
 *   shows the rules.
 *
 * Everything here is **advisory**. `lib/auth/password-policy.ts` decides, on the
 * server, on every submission — a visitor with JavaScript disabled or a script
 * posting straight to the action gets exactly the same verdict (§4.8 AC5). The
 * submit button is therefore never disabled: disabling it hides the reason and
 * traps anyone whose meter failed to load.
 *
 * The common-password list is deliberately NOT consulted here: it is 10 000
 * entries, it lives behind `server-only`, and zxcvbn's own dictionaries already
 * cover the same ground for the meter's purposes.
 */

const SCORE_COUNT = 5;

/** Debounce before scoring: long enough to skip a burst of keystrokes, short enough to feel live. */
const SCORE_DELAY_MS = 180;

type Scorer = (password: string, userInputs: string[]) => number;

let scorerPromise: Promise<Scorer> | undefined;

/**
 * Load zxcvbn once per page, with the common + English + French dictionaries.
 *
 * Verified against @zxcvbn-ts/core 4.2.0: `new ZxcvbnFactory(options).check(
 * password, userInputs)` is synchronous and returns `{ score: 0..4 }`.
 */
function loadScorer(): Promise<Scorer> {
  scorerPromise ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
    import("@zxcvbn-ts/language-fr"),
  ]).then(([{ ZxcvbnFactory }, common, en, fr]) => {
    const factory = new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary, ...fr.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
      useLevenshteinDistance: true,
    });
    return (password: string, userInputs: string[]) => factory.check(password, userInputs).score;
  });
  return scorerPromise;
}

const SCORE_KEYS = ["score0", "score1", "score2", "score3", "score4"] as const;
const RULE_KEYS = {
  length: "rules.length",
  classes: "rules.classes",
  whitespace: "rules.whitespace",
  email: "rules.email",
} as const;

function barClass(index: number, score: number | null): string {
  if (score === null || index > score) return "bg-rule";
  if (score < 2) return "bg-danger";
  if (score < PASSWORD_MIN_SCORE) return "bg-warn";
  return "bg-success";
}

export function PasswordStrength({
  password,
  email,
  describedById,
}: {
  password: string;
  email?: string;
  /** The id the password input points at with `aria-describedby`. */
  describedById?: string;
}): React.JSX.Element {
  const t = useTranslations("auth.strength");
  const generatedId = useId();
  const id = describedById ?? generatedId;
  // The score is stored WITH the password it was computed for, so a keystroke
  // invalidates it by comparison rather than by a synchronous `setState(null)`
  // in the effect (which would cascade a render on every character).
  const [scored, setScored] = useState<{ password: string; score: number } | null>(null);

  useEffect(() => {
    if (password.length === 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadScorer()
        .then((scorer) => {
          if (cancelled) return;
          setScored({
            password,
            score: scorer(password, email ? [email, email.split("@")[0]] : []),
          });
        })
        .catch(() => {
          // The meter is advisory: a chunk that fails to load must not break
          // the form. The server still enforces the policy.
        });
    }, SCORE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, email]);

  const score = scored !== null && scored.password === password ? scored.score : null;

  const rules: PasswordRuleState[] = passwordRuleStates(password, { email });

  return (
    <div id={id} className="mt-2 space-y-2" data-testid="password-strength">
      <div
        role="progressbar"
        aria-label={t("label")}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score ?? 0}
        // eslint-disable-next-line security/detect-object-injection -- `score` is 0..4 from zxcvbn, indexing a frozen tuple
        aria-valuetext={score === null ? undefined : t(SCORE_KEYS[score])}
        data-score={score ?? ""}
        className="flex gap-1"
      >
        {Array.from({ length: SCORE_COUNT }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`h-1 flex-1 rounded-full ${barClass(index, score)}`}
          />
        ))}
      </div>

      <ul className="space-y-0.5 text-xs text-ink-muted">
        {rules.map((rule) => (
          <li
            key={rule.id}
            data-rule={rule.id}
            data-satisfied={rule.satisfied}
            className={rule.satisfied ? "text-success-fg" : undefined}
          >
            <span aria-hidden="true" className="mr-1">
              {rule.satisfied ? "✓" : "•"}
            </span>
            {t(RULE_KEYS[rule.id])}
          </li>
        ))}
      </ul>
    </div>
  );
}
