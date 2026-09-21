# 015 — W4-T3: visual baselines, a WebKit "layout bug" that was an input API, and a field that forgets

**Date** 2026-09-21 · **Status** resolved (tests); product follow-ups open (§2, §9) ·
**Touches** `tests/e2e/**`, `playwright.config.ts`, `scripts/ci/{e2e,e2e-docker}.sh`,
`.github/workflows/{ci,perf,visual-baseline-guard}.yml`, `tests/unit/ci/required-checks.test.ts`,
`lib/testing/e2e-hooks.ts`, `components/bike3d/perf/PerfProbe.tsx`

W4-T3 was §7.2's visual regression, §7.6 AC5–6 and §3.6 AC6: baselines, the label
guard, EN in every spec, and the `mobile-webkit` leg. Four findings were not
visible from the task list, and each changed what a test asserts (§1, §2, §3,
§8); §7 is the dry run on CI that produced the baselines and proved the guard.

---

## 1. `mobile-webkit`'s sticky-bar failure was the test's input API

**Symptom.** `checkup.mobile.spec.ts` "the verdict bar stays on screen while the
guide is scrolled" failed on `mobile-webkit` three attempts out of three, green on
every Chromium project. `docs/backlog.md` suspected `position: sticky` or a scroll
container.

**Root cause.** Neither. Every attempt died on the scroll itself:
`mouse.wheel: Mouse wheel is not supported in mobile WebKit` (CI run
35550216873). Playwright refuses the wheel on a mobile WebKit descriptor; the
test never reached a layout assertion.

**Fix.** The document is scrolled by script (`window.scrollBy`), which every
engine supports — sticky positioning is layout, indifferent to what moved the
document. Checking the geometry first showed the old assertion was weaker than it
looked:

| viewport                | bar pinned before | after `scrollBy(600)`                        |
| ----------------------- | ----------------- | -------------------------------------------- |
| desktop 1280×720        | yes (720/720)     | parked at the wizard's end (631), not pinned |
| landscape 844×390       | yes               | parked at the wizard's end                   |
| Pixel 7, 320 px, iPhone | yes               | still pinned                                 |

`toBeInViewport()` passes for a bar that merely scrolled back to the end of a
short step, so two projects had been passing for the wrong reason. The test now
requires a step taller than the screen, measures the bar pinned to the bottom
edge, scrolls **inside** the step (never past the wizard's end, where the bar
parks), checks that the guide moved under it and that the bar is still pinned.

**Verified.** Mutation: `sticky` → `relative` on `VerdictBar` turns all six runs
red. On WebKit: green in FR and EN, first attempt, on the CI run of §7
(35586384934) — the layout was never at fault, so `VerdictBar`'s CSS is untouched.

## 2. `fit.spec.ts`'s EN flake was a real race — and a product bug

**Symptom.** "the English page says 74.2 cm" failed its first attempt on
`mobile-webkit` (readout never appeared, 10 s) and passed on retry in 1.1 s.
`.debug/003` suspected a `fill` landing before hydration.

**Investigation.** A throwaway probe held the JS chunks back 3 s with
`page.route`, filled the inseam as soon as the server-rendered input existed, and
read the field and the readout after hydration:

| engine   | chunks | filled at | React attached at fill | value after | readout   |
| -------- | ------ | --------- | ---------------------- | ----------- | --------- |
| Chromium | —      | 353 ms    | yes                    | `84`        | `74.2 cm` |
| Chromium | +3 s   | 63 ms     | no                     | **empty**   | none      |
| WebKit   | —      | 2 157 ms  | **yes**                | **empty**   | none      |
| WebKit   | +3 s   | 1 282 ms  | no                     | **empty**   | none      |

Control — the sign-up e-mail, a plain controlled `useState` input, typed at the
same moment: the text **survives** hydration on both engines. So it is not React.

**Root cause.** `components/bike/MeasurementForm.tsx` re-seeds its draft from
storage whenever the value on record changes (`if (stored !== known) setDraft(…)`),
and for a guest bike that value comes from `useLocalBikeSnapshot()`, whose server
snapshot is "pending": the real bike arrives in the render right AFTER hydration,
and that render wipes whatever was typed before it. The WebKit row with React
already attached is the decisive one — waiting for React to own the input is not
enough; the window closes only when the snapshot has resolved.

**Fix (test).** Before typing into a guest bike's form, `fit.spec.ts` waits for
the header's "Mon vélo" link to point at `/velo/local`: `MyBikeLink` reads the same
key through its own `useSyncExternalStore` and resolves in that same render.
With the chunks held back 3 s, that wait keeps `84` and shows `74.2 cm` on both
engines. The saved-bike test, which nothing re-seeds (its fit is a prop), waits
for React to own the input and asserts the readout before saving.

**Open (product).** A visitor on a slow phone who types before the page settles
loses the value silently. This answers `.debug/003`'s W4-T3 follow-up: plain
controlled inputs keep pre-hydration text; this form does not. Fix belongs to the
component: re-seed only the fields the visitor has not touched.

## 3. Reduced motion: assert the camera, and why the threshold is absolute

`reduced-motion.spec.ts` inferred "the camera animated" from "five more frames in
1.2 s", which collapsed to 3 = 3 under load. The new read-only
`__va.bike.camera()` returns the pose the last frame was drawn from
(`camera.position`, written by camera-controls' `update()`) and the pose the
controls are heading to (`getPosition/getTarget(…, true)`); it does not call
`update(0)` the way `screenPositionOf` does.

The first attempt used a relative threshold ("more than 2 % of the travel is left
after one frame") and the numbers said no:

| run (desktop)          | travel | gap one frame in | frames |
| ---------------------- | ------ | ---------------- | ------ |
| first in worker (cold) | 2.774  | 0.238            | 16     |
| second (warm)          | 2.774  | 2.684            | 23     |
| reduced motion         | 2.774  | 0.0000           | 2–3    |

R3F's `demand` loop hands `useFrame` the time since the LAST frame, and the first
frame after a selection compiles the highlight shader cold under SwiftShader
(~0.8 s): smoothDamp at `smoothTime` 0.25 s covers ~95 % of the way in that one
frame. A fraction-of-travel threshold is a timing assertion in disguise. So:
reduced motion must leave **exactly** nothing (`< 1e-4`, measured 0); with motion
the camera must not have arrived (`> 1e-3` — even a ten-second frame leaves
millimetres), must close the gap over more than one frame, never widen it, and
end below half of it. `renderFrames(2)` right before the focus keeps the clock
fresh. Mutation: `reducedMotion={false}` into `CameraRig` → both reduced tests red
(gap 0.85 / 1.09); `={true}` → both motion tests red (gap 0).

## 4. Visual baselines: how they are made, and what a dry run can prove

- `tests/e2e/visual.spec.ts` skips unless `process.platform === "linux"`; every
  project but desktop-chromium and mobile-chromium inverts `@snapshot`, because a
  missing baseline is written AND failed.
- **@playwright/test 1.63.0 (verified in `node_modules`):** `-u/--update-snapshots`
  presets `changed` (a missing baseline is written and passes; a mismatch is
  rewritten); without the flag the mode is `missing` (written, test fails with a
  soft error, not retried); in `none`, `toHaveScreenshot` returns before taking
  any screenshot when the baseline is missing — so a `none` dry run proves the
  wiring and shows no image. The pre-flight that did show them redirected
  `snapshotPathTemplate` into `test-results/` with a throwaway config: 20 images,
  all stable on the first try (`--retries=0`), nothing under `__screenshots__`.
- `e2e.sh` with `UPDATE_SNAPSHOTS=1` runs
  `--grep @snapshot --update-snapshots=changed` only; the whole suite used to run
  there, and any unrelated failure skipped the PR step.
- A PR opened with `GITHUB_TOKEN` starts no workflow. The bot PR's body says so:
  close and reopen it to run CI and the guard.
- `visual-baseline-guard.yml` replaces the ci.yml job: `labeled`/`unlabeled` in
  its types (adding the label after a red guard now re-runs it), `paths:` so it
  does not exist on other PRs, a per-PR concurrency group so the newest label
  event wins. `required-checks.test.ts` parses it and now also refuses a context
  produced by two jobs.

## 5. `scripts/ci/e2e-docker.sh` per worktree

The container took its database from `.env.test` only — from a worktree it would
have truncated the shared `velo_atelier_test`. It now takes the NAME from the
shell's `POSTGRES_URL` (host stays `db`) and refuses anything but a plain
`*_test` name. Its volumes are keyed by content (`va-e2e-nm-<lockfile hash>`,
`va-e2e-generated-<lockfile+schema hash>`), "installed" is a marker inside the
volume, and a `flock` in `va-e2e-locks` serialises first installs. It creates
volumes and never deletes one. First install on this Mac: 33 s, not the 9 min
`.debug/005` measured.

## 6. Found in passing

- `mobile-sheet.spec.ts`'s canvas-tap fallback returned `screenPositionOf(pose)` —
  a PART id API given a pose name, always null — so the test skipped whenever the
  first pose hid the caliper. Fixed.
- The checkup's tool list renders its rows centred with ragged offsets
  (`tap-target` sets `justify-content: center` on a full-width label). Seen in the
  visual preview; reported, not fixed (not this task's file). The baselines record
  it as it is: fixing it means regenerating `checkup-{fr,en}.png` (§4).

## 7. The dry run, on CI

Everything ran on `w4/t3` at `3fe3403`; the bot branch is that commit plus one
commit of 20 PNGs and nothing else.

| step                                                            | run                      | result                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh workflow run perf.yml --ref w4/t3 -f update_snapshots=true` | 35585950087              | `build`, `perf (nightly)`, `update-snapshots`, `lighthouse (nightly)` green; bot PR #2 `visual-baselines/35585950087` → `w4/t3`, labelled, 20 PNGs (7 desktop-chromium, 13 mobile-chromium) |
| the bot PR's own `pull_request` runs (`github-actions[bot]`)    | 35586267772, 35586267849 | zero jobs: `action_required`, then `failure`                                                                                                                                                |
| close and reopen by the maintainer                              | 35586384934 (`CI`)       | every job green                                                                                                                                                                             |
| guard, label present                                            | 35586384950              | success                                                                                                                                                                                     |
| guard, label removed                                            | 35586440703              | failure: "not labelled 'visual-baseline'"                                                                                                                                                   |
| guard, label added back                                         | 35586514859              | success                                                                                                                                                                                     |

e2e on 35586384934, in the Playwright container with the baselines checked out:

| leg              | tests | passed | skipped | flaky | failed |
| ---------------- | ----- | ------ | ------- | ----- | ------ |
| desktop-chromium | 475   | 417    | 58      | 0     | 0      |
| mobile-chromium  | 475   | 470    | 5       | 0     | 0      |
| mobile-landscape | 462   | 441    | 21      | 0     | 0      |
| mobile-narrow    | 89    | 89     | 0       | 0     | 0      |
| no-webgl         | 417   | 377    | 40      | 0     | 0      |
| mobile-webkit    | 462   | 445    | 15      | 2     | 0      |

The two Chromium legs are the AC6 comparison itself: without `-u` a missing
baseline fails its test, so green there means all 20 images existed and matched.
`mobile-webkit`'s e2e step exited 0 on its own merits, not through
`continue-on-error` (on 35550216873 it had failed on §1's test): the pinned bar
(§1), the settled fit form (§2) and the camera assertions (§3) passed in FR and
EN on the first attempt. Its two flakes are §8.

## 8. WebKit's last two flakes: a `goto` that Next overruled

**Symptom.** On 35586384934 two tests failed once on `mobile-webkit` and passed on
retry, both EN instances of tests this task converted: `checkup-partial` "the
resume banner … goes once the checkup is done" and `edge-states` row 9
(`recheck-ok`). One error for both: `page.goto: Navigation to "…/en/bike/demo" is
interrupted by another navigation to "…/en/bike/demo/build-list"` (row 9:
`…/bike/local/checkup?…`, interrupted by `…/bike/local/build-list?spec=…`).

**Mechanism.** "Créer ma liste" (`Wizard.onCreate`) writes the checkup and the
list, synchronously inside the click's own microtask checkpoint, then
`router.push`es to the list: a soft navigation that waits for its RSC payload.
Both tests polled storage (already written) and went straight to `page.goto`. Two
throwaway probes in the CI container (no retries) told the candidates apart:

| probe                               | engine   | click, poll, `goto` (the old tests)                   | click, wait for the list URL, `goto` (the fix) |
| ----------------------------------- | -------- | ----------------------------------------------------- | ---------------------------------------------- |
| v1: the `goto`'s document held 4 s  | both     | ok, FR and EN                                         | ok                                             |
| v2: the list's RSC fetch held 2.5 s | Chromium | ok, FR and EN                                         | ok                                             |
| v2: the list's RSC fetch held 2.5 s | WebKit   | **interrupted**, FR and EN; the page ends on the list | ok                                             |

v1 rules out a `pushState` landing while a `goto` is pending. v2 is the CI error,
every time: WebKit cancels the page's in-flight fetch when the `goto` starts
(`TypeError: Load failed`), and Next 16.3.4's `fetchServerResponse`
(`next/dist/client/components/router-reducer/fetch-server-response.js`) treats a
failed RSC fetch as "Falling back to browser navigation" (logged in both WebKit
runs), so the document navigates to the list and that navigation beats the
test's. Chromium lets the fetch run until the old page unloads, when `pagehide` has
set Next's `isPageUnloading` and the fallback no longer matters, which is why no
Chromium leg ever flaked. The race was there in FR too; EN just lost it first.

**Fix (test).** Both tests wait for the list URL (`waitForURL` on its pathname)
before leaving, which is also what the product promises: finishing opens the
list (§6.8 AC6). The other two "create" clicks read storage and end, with nothing
left to race. Verified: the two tests × FR/EN × 3 repeats on `mobile-webkit` in the
container, no retries: 12 of 12.

**Observed, not fixed (framework).** In v2 the visitor's own navigation lost: on
WebKit, leaving within the RSC round trip of any `router.push` lands on the push
target instead. That is Next's fallback, not this app's code.

## 9. Review: the shop box drops text typed before hydration

**Symptom.** The review re-ran CI on the final code (35632747193, on PR #2's
CI merge ref into `w4/t3` at `02b8c38`; the PR itself was never merged): all 21
jobs green, and `mobile-webkit` 445 passed /
15 skipped / 0 failed with two new flakes. One was `shop.spec.ts` "what is typed
becomes the search at the three shops" (FR): after `fill`, no shop link ever
appeared (10 s), then the retry passed in 1.3 s.

**Mechanism.** `/acheter` is prerendered, and `VendorSearch` is a plain
controlled input (`value={raw}`, `onChange` → `setRaw`). react-dom 19.2.8's
`initInput` does not write the DOM value while hydrating, and nothing replays the
edit, so a value typed before hydration stays in the box and never reaches state.
This corrects §2's control: a plain controlled input keeps pre-hydration text in
the DOM only. A throwaway probe in the container held the JS chunks back 3 s:

| engine   | typed                   | value after hydration | shop links |
| -------- | ----------------------- | --------------------- | ---------- |
| Chromium | before hydration        | `chaîne 11 vitesses`  | 0          |
| WebKit   | before hydration        | `chaîne 11 vitesses`  | 0          |
| both     | once React owns the box | —                     | 3          |

**Fix (test).** Both free-text tests wait until React owns the box
(`searchBox()`) before typing. Verified: those two tests × FR/EN × 3 repeats on
`mobile-webkit` in the container, no retries: 12 of 12.

**Open (product).** It is not only `MeasurementForm` (§2): on a prerendered page,
any controlled input ignores what a visitor typed before hydration. Here the text
stays visible and no shop link appears: the probe's box still had none 2.5 s
after React took over.

**Observed, not diagnosed.** The other new flake, `account.spec.ts` "a session
read still in flight …" (FR), hung in `register()` waiting for `/mes-velos` after
the sign-up click (45 s), then passed on retry: 1 of the leg's 22 `register()`
runs. That spec is unchanged since `w4/base`. It does not reproduce locally:
in this Mac's emulated amd64 container the sign-up itself hangs on
`mobile-webkit`, for a control test too, at that same line, where
`mobile-chromium` passes:

| container run (no retries)             | `mobile-chromium` | `mobile-webkit` |
| -------------------------------------- | ----------------- | --------------- |
| that test, FR/EN × 3 repeats           | —                 | 0 of 6          |
| that test + "shows the address", FR/EN | 4 of 4            | 0 of 4          |

So the local container reproduced WebKit's navigation race (§8) and this box's
race, but it cannot reproduce a sign-up: a WebKit failure in `register()` has to
be read on CI's native amd64 runner.

## 10. Review: the motion trail graded the machine again

**Symptom.** On the final code's CI (35639300551), `reduced-motion.spec.ts` "with
motion, a focus travels" (FR) failed its first attempt on `desktop-chromium`, a
blocking leg, and passed on retry: travel 2.774, first-frame gap 3.084, 7/7
samples still travelling, last 2.070, 9 frames rendered. `last < first / 2`
wanted less than 1.542.

**Mechanism.** R3F 9.7.0 hands every `useFrame` `clock.getDelta()`: the wall time
since the previous rendered frame, uncapped. camera-controls moves the camera only
inside that `update(delta)`. So the camera catches up only when a frame is drawn,
by all the time since the last one. The trail sampled `requestAnimationFrame` for
1.2 s of wall time: under SwiftShader, a long frame (§3: the highlight shader
compiling after a selection) can land at the end of the window, after the last
sample, and the gap looks stuck. `last < first / 2` was a frame-rate floor in
disguise, which §3 set out to remove.

**Fix (test).** The trail is sampled after a fixed number of rendered frames
(`renderFrames(1)`: 24 with motion, 8 under reduce), never over a stretch of wall
time. Every threshold is unchanged. Verified with no retries: 40 of 40 on the host
(desktop and mobile Chromium, FR/EN × 5), 24 of 24 on Linux SwiftShader in the
container (× 3). Mutations again, on this version: `reducedMotion={false}` into
`CameraRig` turns the 4 reduced-motion tests red (first-frame gap 0.82 to 2.73,
where < 1e-4 is required); `={true}` turns the 4 motion tests red (gap 0, "0/24
samples still travelling").

## How to detect a regression

`tests/e2e/checkup.mobile.spec.ts` (pinned bar), `tests/e2e/fit.spec.ts` (settled
before typing), `tests/e2e/bike3d/reduced-motion.spec.ts` (camera gap, sampled
per rendered frame), `tests/e2e/checkup-partial.spec.ts` and `edge-states.spec.ts`
row 9 (the list lands before the next `goto`; WebKit flakes again if a test leaves
right after a `router.push`), `tests/e2e/shop.spec.ts` (types only once React owns
the box), `tests/e2e/visual.spec.ts` (`npm run e2e:docker -- --grep @snapshot`,
never `-u`), `tests/unit/ci/required-checks.test.ts` (the guard's triggers).
