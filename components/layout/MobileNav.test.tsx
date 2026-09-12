import { act, fireEvent, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { MobileNav } from "./MobileNav";

// jsdom 30 has HTMLDialogElement but not its modal API. Mirror the spec
// closely enough for the component: showModal() opens, close() closes and
// fires `close`.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

async function renderNav() {
  const result = await renderWithIntl(
    <MobileNav title="Menu" openLabel="Ouvrir le menu" closeLabel="Fermer le menu">
      <ul>
        <li>
          <a href="#guides">Guides</a>
        </li>
        <li>
          <span>Texte</span>
        </li>
      </ul>
    </MobileNav>,
  );
  const trigger = screen.getByRole("button", { name: "Ouvrir le menu" });
  const dialog = result.container.querySelector("dialog") as HTMLDialogElement;
  return { ...result, trigger, dialog };
}

describe("MobileNav", () => {
  it("is a 44 px menu button, hidden from lg up, that controls a labelled dialog", async () => {
    const { trigger, dialog } = await renderNav();
    expect(trigger).toHaveClass("tap-target", "lg:hidden");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(dialog).not.toHaveAttribute("open");
    const title = screen.getByText("Menu");
    expect(dialog).toHaveAttribute("aria-labelledby", title.id);
  });

  it("opens as a modal and closes from its close button", async () => {
    const { user, trigger, dialog } = await renderNav();
    await user.click(trigger);
    expect(dialog).toHaveAttribute("open");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Menu" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fermer le menu" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when a link inside it is followed, not on other clicks inside", async () => {
    const { user, trigger, dialog } = await renderNav();
    await user.click(trigger);
    await user.click(screen.getByText("Texte"));
    expect(dialog).toHaveAttribute("open");

    const link = screen.getByRole("link", { name: "Guides" });
    link.addEventListener("click", (event) => event.preventDefault()); // jsdom cannot navigate
    await user.click(link);
    expect(dialog).not.toHaveAttribute("open");
  });

  it("closes on a backdrop click (a click whose target is the dialog itself)", async () => {
    const { user, trigger, dialog } = await renderNav();
    await user.click(trigger);
    fireEvent.click(dialog);
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("syncs its state when the browser closes it (Escape → close event)", async () => {
    const { user, trigger, dialog } = await renderNav();
    await user.click(trigger);
    act(() => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when the route changes", async () => {
    setNavigationState({ pathname: "/" });
    const { user, trigger, dialog, rerender } = await renderNav();
    await user.click(trigger);
    expect(dialog).toHaveAttribute("open");

    setNavigationState({ pathname: "/guides" });
    rerender(
      <MobileNav title="Menu" openLabel="Ouvrir le menu" closeLabel="Fermer le menu">
        <p>après navigation</p>
      </MobileNav>,
    );
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
