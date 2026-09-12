import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { routerSpies, setNavigationState } from "@/tests/_fakes/session";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { LocaleSwitcher, queryFromSearch } from "./LocaleSwitcher";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("queryFromSearch", () => {
  it("keeps every key, in order, with repeated keys as arrays", () => {
    expect(queryFromSearch("")).toEqual({});
    expect(queryFromSearch("?parts=chain")).toEqual({ parts: "chain" });
    expect(queryFromSearch("?parts=a&parts=b&parts=c&step=2")).toEqual({
      parts: ["a", "b", "c"],
      step: "2",
    });
    expect(queryFromSearch("?q=cha%C3%AEne+11v&spec=a%2Cb")).toEqual({
      q: "chaîne 11v",
      spec: "a,b",
    });
    expect(Object.keys(queryFromSearch("?z=1&a=2&m=3"))).toEqual(["z", "a", "m"]);
  });
});

describe("LocaleSwitcher", () => {
  it("is a labelled group of one button per locale, the current one marked", async () => {
    await renderWithIntl(<LocaleSwitcher />);
    const group = screen.getByRole("group", { name: "Langue du site" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(2);

    const fr = within(group).getByRole("button", { name: "Français" });
    const en = within(group).getByRole("button", { name: "English" });
    expect(fr).toHaveAttribute("aria-current", "true");
    expect(fr).toHaveAttribute("lang", "fr");
    expect(en).not.toHaveAttribute("aria-current");
    expect(en).toHaveAttribute("lang", "en");
    expect(fr).toHaveTextContent("FR");
    expect(en).toHaveTextContent("EN");
    for (const button of buttons) expect(button).toHaveClass("tap-target");
  });

  it("does nothing when the current locale is picked", async () => {
    const { user } = await renderWithIntl(<LocaleSwitcher />);
    await user.click(screen.getByRole("button", { name: "Français" }));
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it("stays on the same route, with its params and the whole query", async () => {
    setNavigationState({
      pathname: "/velo/[id]/controle",
      params: { locale: "fr", id: "demo" },
    });
    window.history.replaceState(
      null,
      "",
      "/fr/velo/demo/controle?parts=chain&parts=brake-pads-rear&spec=v1.abc",
    );

    const { user } = await renderWithIntl(<LocaleSwitcher />);
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(routerSpies.replace).toHaveBeenCalledTimes(1);
    expect(routerSpies.replace).toHaveBeenCalledWith(
      {
        pathname: "/velo/[id]/controle",
        params: { id: "demo" },
        query: { parts: ["chain", "brake-pads-rear"], spec: "v1.abc" },
      },
      { locale: "en", scroll: false },
    );
  });

  it("switches back to French from an English page", async () => {
    setNavigationState({ pathname: "/", params: { locale: "en" } });
    const { user } = await renderWithIntl(<LocaleSwitcher className="self-end" />, {
      locale: "en",
    });
    const group = screen.getByRole("group", { name: "Site language" });
    expect(group).toHaveClass("self-end");
    expect(within(group).getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await user.click(within(group).getByRole("button", { name: "Français" }));
    expect(routerSpies.replace).toHaveBeenCalledWith(
      { pathname: "/", params: {}, query: {} },
      { locale: "fr", scroll: false },
    );
  });
});
