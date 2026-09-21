/**
 * `prefers-reduced-motion: reduce` (§3.3): no camera transitions, no fade, no
 * quality governor. A camera focus from the list lands in the frame that
 * requested it instead of animating over ~1 s.
 *
 * The CAMERA is what is asserted, through the read-only `__va.bike.camera()`:
 * the pose the last frame was drawn from, and the pose the controls are heading
 * to. Under reduced motion the two agree one frame after the focus is applied;
 * with motion they do not, and the gap between them closes frame after frame.
 *
 * This used to be inferred from a frame count — "the animated focus renders at
 * least five more frames in 1.2 s" — which only holds while the machine draws
 * fast enough for the difference to show: with two cores lost to runaway
 * processes both halves collapsed to 3 frames and the test could no longer tell
 * "the camera did not animate" from "this machine could not draw"
 * (`docs/backlog.md`, `.debug/010 §9`). The frame count is still recorded, as an
 * annotation: it describes the machine, and the camera is the assertion.
 */
import type { Page } from "@playwright/test";

import type { CameraState, WorldPoint } from "../../../lib/testing/e2e-hooks";
import { expect, forEachLocale, test } from "../_fixtures";
import { openViewer, waitReady } from "./_viewer";

/** What one focus did to the camera, sampled in the page. */
interface FocusTrace {
  /** How far the focus moves the camera: rendered pose before → end pose after. */
  travel: number;
  /** What is left of the way one rendered frame after the rig applied the focus. */
  first: number;
  /** What is left after each of the next `draws` rendered frames. */
  trail: number[];
  /** Frames the canvas rendered from the focus on — the old proxy, kept as a note. */
  frames: number;
}

/** Sum of the position and target gaps: zero exactly when the camera is at rest. */
function gap(camera: CameraState): number {
  return distance(camera.position, camera.endPosition) + distance(camera.target, camera.endTarget);
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The trail is sampled after a fixed number of RENDERED frames, never over a
 * stretch of wall time. The camera advances only when a frame is drawn, by the
 * time since the previous one, so a window in milliseconds grades the machine:
 * under SwiftShader on CI a 1.2 s window once held 9 frames and a gap that went
 * only from 3.08 to 2.07 (run 35639300551, `.debug/015` §10). A forced frame
 * hands the camera all the time since the previous one, so however slow a frame
 * is, the samples that follow it see the camera catch up.
 */
async function focusTrace(page: Page, partId: string, draws: number): Promise<FocusTrace> {
  const raw = await page.evaluate(
    async ({ partId, draws }) => {
      const va = window.__va!;
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const moved = (a: [number, number, number], b: [number, number, number]) =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-6;

      // Draw right before focusing: R3F's `demand` loop hands `useFrame` the
      // time since the LAST frame, so after an idle second the first frame of a
      // transition would cover most of it in one step and look like a jump.
      await va.perf.renderFrames(2);
      const before = va.bike.camera()!;
      const framesBefore = va.perf.snapshot()!.frameMs.length;
      va.bike.focus(partId);

      // The rig applies the focus from a React effect: wait until the end pose
      // has moved, then let exactly that change be drawn once.
      let applied = va.bike.camera()!;
      for (let tries = 0; tries < 120 && !moved(applied.endPosition, before.endPosition); tries++) {
        await nextFrame();
        applied = va.bike.camera()!;
      }
      await va.perf.renderFrames(1);
      const first = va.bike.camera()!;

      const trail: (typeof first)[] = [];
      for (let drawn = 0; drawn < draws; drawn++) {
        await va.perf.renderFrames(1);
        trail.push(va.bike.camera()!);
      }
      return {
        before,
        first,
        trail,
        frames: va.perf.snapshot()!.frameMs.length - framesBefore,
      };
    },
    { partId, draws },
  );
  return {
    travel: distance(raw.before.position, raw.first.endPosition),
    first: gap(raw.first),
    trail: raw.trail.map(gap),
    frames: raw.frames,
  };
}

function note(trace: FocusTrace): string {
  const last = trace.trail.at(-1) ?? Number.NaN;
  const travelling = trace.trail.filter((left) => left > 1e-4).length;
  return (
    `travel ${trace.travel.toFixed(3)}, first-frame gap ${trace.first.toFixed(4)}, ` +
    `${travelling}/${trace.trail.length} samples still travelling, last ${last.toFixed(4)}, ` +
    `${trace.frames} frames rendered`
  );
}

forEachLocale((locale) => {
  test(`reduced motion: the camera arrives in the first frame, no fade, governor off (${locale}) @webgl`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewer(page, locale);
    await waitReady(page);

    const svg = page.getByTestId("bike3d-svg");
    // globals.css collapses durations to 0.01 ms under reduced motion (not exactly 0).
    const duration = await svg.evaluate((element) =>
      parseFloat(getComputedStyle(element).transitionDuration),
    );
    expect(duration).toBeLessThan(0.001);

    const trace = await focusTrace(page, "saddle", 8);
    test.info().annotations.push({ type: "reduced-motion focus", description: note(trace) });
    expect(await page.evaluate(() => window.__va!.bike.selectedPartId)).toBe("saddle");
    // The focus really moves the camera, or "it is already there" proves nothing.
    expect(trace.travel, note(trace)).toBeGreaterThan(0.1);
    // One frame after the rig applied it, the drawn pose IS the end pose.
    expect(trace.first, note(trace)).toBeLessThan(1e-4);
    for (const left of trace.trail) expect(left, note(trace)).toBeLessThan(1e-4);

    // Orbiting does not change the tier (the governor is off).
    const quality = await page.evaluate(() => window.__va!.bike.quality);
    await page.evaluate(() => window.__va!.perf.runOrbit(1200));
    expect(await page.evaluate(() => window.__va!.bike.quality)).toBe(quality);
  });

  test(`with motion, a focus travels: the gap to its pose closes frame after frame (${locale}) @webgl`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openViewer(page, locale);
    await waitReady(page);

    const trace = await focusTrace(page, "saddle", 24);
    test.info().annotations.push({ type: "animated focus", description: note(trace) });
    expect(await page.evaluate(() => window.__va!.bike.selectedPartId)).toBe("saddle");
    expect(trace.travel, note(trace)).toBeGreaterThan(0.1);
    // NOT there one frame in. How much of the way that first frame covers is
    // the machine's business, not the viewer's: `smoothTime` is 0.25 s, so a
    // frame that takes a second — the first frame after a selection compiles
    // the highlight shader cold under SwiftShader — covers ~95 % of it. Even a
    // ten-second frame leaves millimetres, where reduced motion leaves zero.
    expect(trace.first, note(trace)).toBeGreaterThan(1e-3);
    // …then the gap closes over the frames that follow — more than one of
    // them — and only ever closes (camera-controls damps without overshoot),
    // ending well short of where it was.
    expect(trace.trail.filter((left) => left > 1e-4).length, note(trace)).toBeGreaterThan(1);
    let previous = trace.first;
    for (const left of trace.trail) {
      expect(left, note(trace)).toBeLessThanOrEqual(previous * 1.001 + 1e-6);
      previous = left;
    }
    expect(trace.trail.at(-1)!, note(trace)).toBeLessThan(trace.first / 2);
  });
});
