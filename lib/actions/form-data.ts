/**
 * `FormData` → a plain object a `.strict()` zod schema can safely parse (§4.4).
 *
 * Every action in this project parses its input with `.strict()`, so that an
 * unexpected field is a *rejected* submission rather than a silently ignored
 * one (§4.7 `mass-assignment`). That is the right default, and it has exactly
 * one false positive: React puts its own bookkeeping into the FormData of a
 * `useActionState` form.
 *
 * A real submission from `<form action={formAction}>` carries, besides the
 * visitor's fields:
 *
 *   $ACTION_REF_2    ""                        reference to the action closure
 *   $ACTION_2:0      {"id":"60bf…","bound":…}  the action id and its bound args
 *   $ACTION_2:1      [{"ok":true,"data":false}] the previous state (arg 0)
 *   $ACTION_KEY      k63321961…                 the form's identity across renders
 *
 * (and `$ACTION_ID_<hash>` in the no-JS progressive-enhancement path). Next
 * consumes them to locate the action; they are still in the `FormData` the
 * action body receives. Handing them to a strict schema makes **every form in
 * the app fail validation** — which is precisely what happened: the unit and
 * security tiers build their `FormData` by hand, so they never saw these keys,
 * and only `tests/e2e/auth-login.spec.ts` (a real browser against a real build)
 * caught it.
 *
 * So: drop React's reserved keys, keep everything else. `$` is reserved by
 * React for this purpose and no input in this project is named with it, so the
 * prefix test is both sufficient and safe — a tampered payload adding
 * `userId`, `role` or `passwordHash` is still an unrecognized key and still
 * rejected. `tests/security/mass-assignment.test.ts` pins both halves.
 */

/** React's reserved prefix for action bookkeeping inside a form's FormData. */
const REACT_ACTION_PREFIX = "$ACTION";

/** True for a field React added itself, never for one the app or a visitor set. */
export function isReactActionField(name: string): boolean {
  return name.startsWith(REACT_ACTION_PREFIX);
}

/**
 * The visitor's fields, as a plain object.
 *
 * A repeated field keeps its **last** value, matching
 * `Object.fromEntries(formData.entries())`; no action in this project posts a
 * repeated name, and a schema that needs one should read the `FormData`
 * directly with `getAll()`.
 */
export function formFields(formData: FormData): Record<string, unknown> {
  // `Object.fromEntries` defines own properties instead of assigning them, so a
  // field literally named `__proto__` lands as data rather than reaching the
  // prototype setter. `fields[name] = value` in a loop would not.
  return Object.fromEntries([...formData.entries()].filter(([name]) => !isReactActionField(name)));
}
