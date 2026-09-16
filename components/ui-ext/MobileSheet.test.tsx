import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MEDIA } from "@/lib/hooks/use-media";
import { setMediaQuery } from "@/tests/setup.dom";

import { MobileSheet, SHEET_HEIGHT, SHEET_SNAP_POINTS, type SheetSnap } from "./MobileSheet";

/** jsdom's viewport, which the drag maths converts px offsets against. */
const VIEWPORT = 768;

function renderSheet(props: Partial<React.ComponentProps<typeof MobileSheet>> = {}) {
  const user = userEvent.setup();
  const result = render(
    <MobileSheet
      id="parts-sheet"
      data-testid="parts-sheet"
      expandLabel="Agrandir"
      collapseLabel="Réduire"
      {...props}
    >
      <p>Liste des pièces</p>
    </MobileSheet>,
  );
  const sheet = screen.getByTestId("parts-sheet");
  const handle = sheet.querySelector("[data-slot=mobile-sheet-handle]") as HTMLButtonElement;
  return { user, sheet, handle, ...result };
}

/** `--sheet-y` on the sheet: the offset the transform reads. */
function offset(sheet: HTMLElement): string {
  return sheet.style.getPropertyValue("--sheet-y");
}

function snapOf(sheet: HTMLElement): string | null {
  return sheet.getAttribute("data-snap");
}

/** A full press-drag-release on the handle, in jsdom's viewport coordinates. */
function drag(handle: HTMLElement, fromY: number, toY: number): void {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: fromY });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: toY });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: toY });
}

describe("MobileSheet", () => {
  it("declares its geometry the way §6.4 specifies it", () => {
    expect(SHEET_HEIGHT).toBe(0.92);
    expect(SHEET_SNAP_POINTS).toEqual([0.18, 0.5, 0.92]);
  });

  it("is a labelled, bottom-anchored region resting at the half snap point", () => {
    const { sheet } = renderSheet({ title: "Pièces" });
    expect(sheet.tagName).toBe("SECTION");
    expect(sheet).toHaveAttribute("id", "parts-sheet");
    expect(sheet).toHaveAccessibleName("Pièces");
    expect(sheet.className).toContain("fixed");
    expect(sheet.className).toContain("h-[92dvh]");
    expect(snapOf(sheet)).toBe("1");
    expect(offset(sheet)).toBe("42dvh");
  });

  it("scrolls in one place only, padded past the home indicator", () => {
    const { sheet } = renderSheet();
    const content = sheet.querySelector("[data-slot=mobile-sheet-content]");
    expect(content).toHaveClass("overflow-y-auto", "overscroll-contain");
    expect(content?.className).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
    expect(screen.getByText("Liste des pièces")).toBeInTheDocument();
  });

  describe("the handle", () => {
    it("is a 44 px button that controls the sheet and states its own state", () => {
      const { sheet, handle } = renderSheet();
      expect(handle.tagName).toBe("BUTTON");
      expect(handle).toHaveClass("tap-target", "touch-none");
      expect(handle).toHaveAttribute("aria-controls", sheet.id);
      expect(handle).toHaveAttribute("aria-expanded", "true");
      expect(handle).toHaveAccessibleName("Agrandir");
    });

    it("reads 'collapsed' at the lowest snap point", () => {
      const { handle } = renderSheet({ defaultSnap: 0 });
      expect(handle).toHaveAttribute("aria-expanded", "false");
    });

    it("reads 'Réduire' once there is nowhere left to grow", () => {
      const { handle } = renderSheet({ defaultSnap: 2 });
      expect(handle).toHaveAccessibleName("Réduire");
    });
  });

  describe("reached from the keyboard", () => {
    it("steps up on each press and wraps back to the bottom from the top", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 0 });
      expect(snapOf(sheet)).toBe("0");

      await user.click(handle);
      expect(snapOf(sheet)).toBe("1");

      await user.click(handle);
      expect(snapOf(sheet)).toBe("2");

      // One button, three positions: the top wraps round to the peek.
      await user.click(handle);
      expect(snapOf(sheet)).toBe("0");
    });

    it("is operable with Enter and Space, since the handle is a real button", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 0 });
      handle.focus();
      await user.keyboard("{Enter}");
      expect(snapOf(sheet)).toBe("1");
      await user.keyboard(" ");
      expect(snapOf(sheet)).toBe("2");
    });

    it("moves one snap point at a time with the arrow keys, and clamps at both ends", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 1 });
      handle.focus();

      await user.keyboard("{ArrowUp}");
      expect(snapOf(sheet)).toBe("2");
      await user.keyboard("{ArrowUp}");
      expect(snapOf(sheet)).toBe("2");

      await user.keyboard("{ArrowDown}");
      expect(snapOf(sheet)).toBe("1");
      await user.keyboard("{ArrowDown}");
      expect(snapOf(sheet)).toBe("0");
      await user.keyboard("{ArrowDown}");
      expect(snapOf(sheet)).toBe("0");
    });

    it("jumps to either end with Home and End", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 1 });
      handle.focus();
      await user.keyboard("{End}");
      expect(snapOf(sheet)).toBe("2");
      await user.keyboard("{Home}");
      expect(snapOf(sheet)).toBe("0");
    });

    it("leaves keys it does not handle to the page", () => {
      const { handle } = renderSheet();
      const event = fireEvent.keyDown(handle, { key: "PageDown" });
      // fireEvent returns false when a handler called preventDefault().
      expect(event).toBe(true);
    });

    it("stops the page behind it scrolling on the keys it does handle", () => {
      const { handle } = renderSheet();
      expect(fireEvent.keyDown(handle, { key: "ArrowUp" })).toBe(false);
    });

    it("reaches every snap point — the whole point of the button", async () => {
      const seen = new Set<string | null>();
      const { user, sheet, handle } = renderSheet({ defaultSnap: 0 });
      seen.add(snapOf(sheet));
      for (let i = 0; i < 3; i += 1) {
        await user.click(handle);
        seen.add(snapOf(sheet));
      }
      expect([...seen].sort()).toEqual(["0", "1", "2"]);
    });
  });

  describe("data-snap and the offset it drives", () => {
    it.each([
      [0, "74dvh"],
      [1, "42dvh"],
      [2, "0dvh"],
    ] as const)("snap %i sits at %s", (snap, expected) => {
      const { sheet } = renderSheet({ defaultSnap: snap as SheetSnap });
      expect(snapOf(sheet)).toBe(String(snap));
      expect(offset(sheet)).toBe(expected);
    });

    it("honours custom snap points", () => {
      const { sheet } = renderSheet({ defaultSnap: 0, snapPoints: [0.32, 0.6, 0.92] });
      expect(offset(sheet)).toBe("60dvh");
    });
  });

  describe("dragging the handle", () => {
    it("tracks the finger, then snaps to the nearest resting point", () => {
      const onSnapChange = vi.fn();
      const { sheet, handle } = renderSheet({ defaultSnap: 2, onSnapChange });

      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400 });
      expect(sheet).toHaveAttribute("data-dragging", "true");
      expect(offset(sheet)).toBe("300px");
      // No transition while a finger is down, or the sheet lags behind it.
      expect(sheet.style.getPropertyValue("--sheet-duration")).toBe("0ms");

      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 400 });
      // 0.92 − 300/768 ≈ 0.53 → the half snap point.
      expect(snapOf(sheet)).toBe("1");
      expect(offset(sheet)).toBe("42dvh");
      expect(sheet).not.toHaveAttribute("data-dragging");
      expect(onSnapChange).toHaveBeenCalledWith(1);
    });

    it("drags all the way down to the peek", () => {
      const { sheet, handle } = renderSheet({ defaultSnap: 2 });
      drag(handle, 100, 100 + 0.74 * VIEWPORT);
      expect(snapOf(sheet)).toBe("0");
    });

    it("drags back up to full screen", () => {
      const { sheet, handle } = renderSheet({ defaultSnap: 0 });
      drag(handle, 700, 100);
      expect(snapOf(sheet)).toBe("2");
    });

    it("never lets the sheet be dragged past either end", () => {
      const { sheet, handle } = renderSheet({ defaultSnap: 1 });
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 400 });

      fireEvent.pointerMove(handle, { pointerId: 1, clientY: -5000 });
      expect(offset(sheet)).toBe("0px");

      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 5000 });
      expect(offset(sheet)).toBe(`${Math.round(0.74 * VIEWPORT)}px`);

      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 5000 });
      expect(snapOf(sheet)).toBe("0");
    });

    it("treats a tap on the handle as a click, not a zero-length drag", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 0 });
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 300 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 301 });
      await user.click(handle);
      expect(snapOf(sheet)).toBe("1");
    });

    it("does not also step when the click that ends a real drag arrives", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 2 });
      drag(handle, 100, 400);
      expect(snapOf(sheet)).toBe("1");

      // A browser fires `click` right after the `pointerup` of the same
      // gesture. Swallowed, or every drag would also step the sheet.
      fireEvent.click(handle);
      expect(snapOf(sheet)).toBe("1");

      // …and the next, separate click still works.
      await user.click(handle);
      expect(snapOf(sheet)).toBe("2");
    });

    it("ignores a secondary button and a foreign pointer", () => {
      const { sheet, handle } = renderSheet({ defaultSnap: 1 });
      fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientY: 100 });
      expect(sheet).not.toHaveAttribute("data-dragging");

      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 9, clientY: 600 });
      expect(offset(sheet)).toBe(`${Math.round(0.42 * VIEWPORT)}px`);
      fireEvent.pointerUp(handle, { pointerId: 9, clientY: 600 });
      expect(sheet).toHaveAttribute("data-dragging", "true");
    });

    it("snaps back when the gesture is cancelled mid-drag", () => {
      const { sheet, handle } = renderSheet({ defaultSnap: 2 });
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400 });
      fireEvent.pointerCancel(handle, { pointerId: 1, clientY: 400 });
      expect(sheet).not.toHaveAttribute("data-dragging");
      expect(snapOf(sheet)).toBe("1");
    });
  });

  describe("motion", () => {
    it("transitions the transform over the base motion token", () => {
      const { sheet } = renderSheet();
      expect(sheet.className).toContain("transition-transform");
      expect(sheet.className).toContain("duration-(--sheet-duration)");
      expect(sheet.style.getPropertyValue("--sheet-duration")).toBe("var(--motion-base)");
    });

    it("runs for 0 ms under prefers-reduced-motion", () => {
      setMediaQuery(MEDIA.reducedMotion, true);
      const { sheet } = renderSheet();
      expect(sheet.style.getPropertyValue("--sheet-duration")).toBe("0ms");
    });

    it("drops to 0 ms the moment the preference changes, without a remount", async () => {
      const { user, sheet, handle } = renderSheet({ defaultSnap: 0 });
      expect(sheet.style.getPropertyValue("--sheet-duration")).toBe("var(--motion-base)");
      setMediaQuery(MEDIA.reducedMotion, true);
      await user.click(handle);
      expect(sheet.style.getPropertyValue("--sheet-duration")).toBe("0ms");
      expect(snapOf(sheet)).toBe("1");
    });
  });

  describe("as a controlled component", () => {
    it("shows the snap point it is given and never moves on its own", async () => {
      const onSnapChange = vi.fn();
      const { user, sheet, handle } = renderSheet({ snap: 0, onSnapChange });
      expect(snapOf(sheet)).toBe("0");

      await user.click(handle);
      expect(onSnapChange).toHaveBeenCalledWith(1);
      // The parent owns the value: without a re-render, nothing moves.
      expect(snapOf(sheet)).toBe("0");
    });

    it("follows the parent when the value changes", () => {
      const { sheet, rerender } = renderSheet({ snap: 0, onSnapChange: vi.fn() });
      rerender(
        <MobileSheet
          id="parts-sheet"
          data-testid="parts-sheet"
          expandLabel="Agrandir"
          collapseLabel="Réduire"
          snap={2}
          onSnapChange={vi.fn()}
        >
          <p>Liste des pièces</p>
        </MobileSheet>,
      );
      expect(snapOf(sheet)).toBe("2");
      expect(offset(sheet)).toBe("0dvh");
    });

    it("stays quiet when a gesture lands back on the current snap point", () => {
      const onSnapChange = vi.fn();
      const { handle } = renderSheet({ defaultSnap: 1, onSnapChange });
      drag(handle, 300, 310);
      expect(onSnapChange).not.toHaveBeenCalled();
    });
  });

  it("generates its own id when the consumer does not supply one", () => {
    render(
      <MobileSheet data-testid="anonymous" expandLabel="Agrandir" collapseLabel="Réduire">
        contenu
      </MobileSheet>,
    );
    const sheet = screen.getByTestId("anonymous");
    expect(sheet.id).toMatch(/^sheet-/);
    expect(sheet.querySelector("[data-slot=mobile-sheet-handle]")).toHaveAttribute(
      "aria-controls",
      sheet.id,
    );
  });

  it("merges the caller's className and style with its own", () => {
    const { sheet } = renderSheet({ className: "lg:hidden", style: { zIndex: 60 } });
    expect(sheet).toHaveClass("lg:hidden");
    expect(sheet.style.zIndex).toBe("60");
    expect(offset(sheet)).toBe("42dvh");
  });
});
