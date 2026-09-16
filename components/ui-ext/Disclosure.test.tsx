import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Disclosure, disclosureStorageKey } from "./Disclosure";

afterEach(() => {
  window.localStorage.clear();
});

function renderDisclosure(props: Partial<React.ComponentProps<typeof Disclosure>> = {}) {
  const user = userEvent.setup();
  const result = render(
    <Disclosure summary="Comment reconnaître mes freins ?" {...props}>
      <p>Regardez le moyeu&nbsp;: un disque signifie un frein à disque.</p>
    </Disclosure>,
  );
  return { user, ...result };
}

describe("Disclosure", () => {
  it("is a native details/summary — closed, with its content hidden", () => {
    const { container } = renderDisclosure();
    const details = container.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Comment reconnaître mes freins ?").closest("summary")).toBeTruthy();
  });

  it("opens and closes on click", async () => {
    const { container, user } = renderDisclosure();
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = screen.getByText("Comment reconnaître mes freins ?");

    await user.click(summary);
    expect(details).toHaveAttribute("open");

    await user.click(summary);
    expect(details).not.toHaveAttribute("open");
  });

  it("can start open", () => {
    const { container } = renderDisclosure({ defaultOpen: true });
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("reports every change to the caller", async () => {
    const onOpenChange = vi.fn();
    const { user } = renderDisclosure({ onOpenChange });
    await user.click(screen.getByText("Comment reconnaître mes freins ?"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByText("Comment reconnaître mes freins ?"));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("gives the summary a 44 px tap target and hides the native marker", () => {
    renderDisclosure();
    const summary = screen
      .getByText("Comment reconnaître mes freins ?")
      .closest("summary") as HTMLElement;
    expect(summary).toHaveClass("tap-target", "list-none");
  });

  describe("with a persistKey", () => {
    const key = "decision:brake-type";

    it("remembers being opened", async () => {
      const { user } = renderDisclosure({ persistKey: key });
      await user.click(screen.getByText("Comment reconnaître mes freins ?"));
      expect(window.localStorage.getItem(disclosureStorageKey(key))).toBe("1");

      await user.click(screen.getByText("Comment reconnaître mes freins ?"));
      expect(window.localStorage.getItem(disclosureStorageKey(key))).toBe("0");
    });

    it("restores the remembered state on a later render", async () => {
      window.localStorage.setItem(disclosureStorageKey(key), "1");
      const { container } = renderDisclosure({ persistKey: key });
      await waitFor(() => expect(container.querySelector("details")).toHaveAttribute("open"));
    });

    it("lets a remembered 'closed' beat defaultOpen", async () => {
      window.localStorage.setItem(disclosureStorageKey(key), "0");
      const { container } = renderDisclosure({ persistKey: key, defaultOpen: true });
      await waitFor(() => expect(container.querySelector("details")).not.toHaveAttribute("open"));
    });

    it("namespaces the key so it cannot collide with the guest bike state", () => {
      expect(disclosureStorageKey(key)).toBe("va:ui:disclosure:decision:brake-type");
    });

    it("survives a localStorage that throws (Safari private mode)", async () => {
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      try {
        const { container, user } = renderDisclosure({ persistKey: key });
        await user.click(screen.getByText("Comment reconnaître mes freins ?"));
        // It just forgets; it does not take the page down with it.
        expect(container.querySelector("details")).toHaveAttribute("open");
      } finally {
        getItem.mockRestore();
        setItem.mockRestore();
      }
    });
  });
});
