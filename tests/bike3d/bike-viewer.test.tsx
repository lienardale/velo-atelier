/**
 * `BikeViewer` (RTL, jsdom): capability branches, lazy mounting, fallbacks,
 * props ↔ store (§3.3, §3.5). The lazy scene is a stub (`next/dynamic` mocked).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BikeViewer, BikeViewerProvider } from "@/components/bike3d/BikeViewer";
import { useViewerStore, useViewerStoreApi } from "@/components/bike3d/store";
import { presetBuild } from "@/lib/bike3d/builds";
import { QUALITY_STORAGE_KEY } from "@/lib/bike3d/quality";
import type { PartId } from "@/lib/domain/data/parts";
import { renderWithIntl } from "@/tests/_helpers/intl";
import { setMediaQuery, triggerIntersection } from "@/tests/setup.dom";
import { createdContexts, setWebGLSupport } from "@/tests/setup.bike3d";

import { resetStub, stubControl } from "./_stub-scene";

vi.mock("next/dynamic", async () => {
  const { StubScene } = await import("./_stub-scene");
  return { default: () => StubScene };
});

const gravel = presetBuild("gravel-1x11");

async function renderViewer(
  props: Partial<Parameters<typeof BikeViewer>[0]> = {},
  locale: "fr" | "en" = "fr",
) {
  return renderWithIntl(
    <BikeViewer spec={gravel.spec} build={gravel} locale={locale} {...props} />,
    { locale },
  );
}

const viewer = () => screen.getByTestId("bike3d-viewer");
const svg = () => screen.getByTestId("bike3d-svg");

/** Visible + idle: what gates the 3D chunk. */
async function becomeVisibleAndIdle() {
  await act(async () => {
    triggerIntersection();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  resetStub();
  window.history.replaceState(null, "", "/fr/dev/bike3d");
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("without WebGL", () => {
  it("keeps the interactive SVG and says why", async () => {
    await renderViewer();
    await becomeVisibleAndIdle();
    expect(viewer()).toHaveAttribute("data-state", "no-webgl");
    expect(screen.queryByTestId("scene-stub")).toBeNull();
    expect(svg()).toHaveAttribute("data-concealed", "false");
    expect(screen.getByTestId("bike3d-notice")).toHaveTextContent(
      "La 3D n'est pas disponible sur cet appareil",
    );
    // A state that lasts is shown, not only announced.
    expect(screen.getByTestId("bike3d-notice")).not.toHaveClass("sr-only");
    // One button per rendered part, with its translated name.
    const buttons = svg().querySelectorAll("[data-part-id]");
    expect(buttons).toHaveLength(24);
    expect(within(svg()).getByRole("button", { name: "Selle" })).toHaveAttribute("tabindex", "0");
  });

  it("selects from the SVG by click and keyboard, reporting the source", async () => {
    const onSelect = vi.fn();
    const { user } = await renderViewer({ onSelect }, "en");
    await user.click(within(svg()).getByRole("button", { name: "Saddle" }));
    expect(onSelect).toHaveBeenLastCalledWith("saddle", "svg");
    expect(viewer()).toHaveAttribute("data-selected", "saddle");

    within(svg()).getByRole("button", { name: "Chain" }).focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("chain", "svg");
    within(svg()).getByRole("button", { name: "Frame" }).focus();
    await user.keyboard(" ");
    expect(viewer()).toHaveAttribute("data-selected", "frame");
    await user.keyboard("a");
    expect(viewer()).toHaveAttribute("data-selected", "frame");
    expect(within(svg()).getByRole("button", { name: "Frame" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders the host's panel for the selection", async () => {
    await renderViewer({
      initialPartId: "brake-pads-front",
      renderPanel: (id) => <p data-testid="panel">{id ?? "none"}</p>,
    });
    expect(screen.getByTestId("panel")).toHaveTextContent("brake-pads-front");
    // The hosted part lights its host in the SVG.
    expect(svg().querySelector('[data-part-id="brake-caliper-front"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("with WebGL 2", () => {
  beforeEach(() => setWebGLSupport("webgl2"));

  it("mounts the 3D chunk only once visible and idle, then conceals the SVG", async () => {
    await renderViewer();
    expect(screen.queryByTestId("scene-stub")).toBeNull();
    expect(viewer()).toHaveAttribute("data-state", "loading");
    // The capability probe released its context.
    expect(createdContexts[0]?.loseContextExtension.loseContext).toHaveBeenCalled();

    await becomeVisibleAndIdle();
    expect(screen.getByTestId("scene-stub")).toBeInTheDocument();
    await waitFor(() => expect(viewer()).toHaveAttribute("data-state", "ready"));
    expect(svg()).toHaveAttribute("aria-hidden", "true");
    expect(svg().querySelector("[data-part-id]")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("bike3d-reset")).toBeInTheDocument();
    expect(screen.queryByTestId("bike3d-rotate")).toBeNull();
    expect(screen.getByTestId("scene-stub")).toHaveAttribute("data-tier", "high");
  });

  it("announces the loading notice without painting it, until the scene is ready", async () => {
    stubControl.autoReady = false;
    await renderViewer();
    await becomeVisibleAndIdle();
    const notice = screen.getByTestId("bike3d-notice");
    expect(notice).toHaveTextContent("Chargement de la vue 3D");
    expect(notice).toHaveAttribute("role", "status");
    // Visually hidden: a line painted seconds after the first paint becomes the
    // page's LCP element as soon as it outgrows the `<h1>` (§6.8 AC9; CI run
    // 35600024232 measured /en/bike/demo at 4520 ms against /fr's 2302 ms).
    expect(notice).toHaveClass("sr-only");
    expect(svg()).toHaveAttribute("data-concealed", "false");
  });

  it("falls back to the SVG on context loss, twice at most", async () => {
    const { user } = await renderViewer({}, "en");
    await becomeVisibleAndIdle();
    await waitFor(() => expect(viewer()).toHaveAttribute("data-state", "ready"));

    await user.click(screen.getByRole("button", { name: "lose-context" }));
    expect(viewer()).toHaveAttribute("data-state", "context-lost");
    expect(screen.queryByTestId("scene-stub")).toBeNull();
    expect(svg()).toHaveAttribute("data-concealed", "false");
    expect(screen.getByTestId("bike3d-notice")).toHaveTextContent("The 3D view stopped.");
    expect(screen.getByTestId("bike3d-notice")).not.toHaveClass("sr-only");

    await user.click(screen.getByTestId("bike3d-reload"));
    await waitFor(() => expect(viewer()).toHaveAttribute("data-state", "ready"));
    expect(stubControl.mounts).toBe(2);

    await user.click(screen.getByRole("button", { name: "lose-context" }));
    expect(screen.queryByTestId("bike3d-reload")).toBeNull();
    expect(screen.getByTestId("bike3d-notice")).toHaveTextContent("stopped several times");
  });

  it("a scene error keeps the SVG", async () => {
    stubControl.throwOnRender = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderViewer();
    await becomeVisibleAndIdle();
    await waitFor(() => expect(viewer()).toHaveAttribute("data-state", "error"));
    expect(screen.getByTestId("bike3d-notice")).toHaveTextContent("problème");
    expect(svg()).toHaveAttribute("data-concealed", "false");
    consoleError.mockRestore();
  });

  it("passes reduced motion to the scene", async () => {
    setMediaQuery("(prefers-reduced-motion: reduce)", true);
    await renderViewer();
    await becomeVisibleAndIdle();
    expect(screen.getByTestId("scene-stub")).toHaveAttribute("data-reduced-motion", "true");
  });

  it("coarse pointer: med tier, no hover, and a rotate toggle", async () => {
    setMediaQuery("(pointer: coarse)", true);
    const { user } = await renderViewer();
    await becomeVisibleAndIdle();
    await waitFor(() => expect(viewer()).toHaveAttribute("data-state", "ready"));
    expect(viewer()).toHaveAttribute("data-quality", "med");
    expect(screen.getByTestId("scene-stub")).toHaveAttribute("data-coarse", "true");
    const rotate = screen.getByTestId("bike3d-rotate");
    expect(rotate).toHaveAttribute("aria-pressed", "false");
    await user.click(rotate);
    expect(screen.getByTestId("bike3d-rotate")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByTestId("bike3d-reset"));
  });

  it("restores a persisted tier, and a host-forced tier wins", async () => {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, "low");
    const first = await renderViewer();
    expect(viewer()).toHaveAttribute("data-quality", "low");
    first.unmount();
    await renderViewer({ initialQuality: "med" });
    expect(viewer()).toHaveAttribute("data-quality", "med");
  });

  it("survives a storage that throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await renderViewer();
    expect(viewer()).toHaveAttribute("data-quality", "high");
    getItem.mockRestore();
  });
});

describe("props ↔ store", () => {
  it("writes ?part= without navigation and reports picks in pick mode", async () => {
    const onPickedChange = vi.fn();
    const { user } = await renderViewer({ mode: "pick", onPickedChange }, "en");
    await user.click(within(svg()).getByRole("button", { name: "Chain" }));
    await user.click(within(svg()).getByRole("button", { name: "Saddle" }));
    expect([...onPickedChange.mock.lastCall![0]]).toEqual(["chain", "saddle"]);
    await waitFor(() => expect(window.location.search).toBe("?part=saddle&parts=chain%2Csaddle"));
    expect(viewer()).toHaveAttribute("data-mode", "pick");
  });

  it("tints parts with the checkup status", async () => {
    await renderViewer({ status: { chain: "ko", saddle: "ok" } });
    expect(svg().querySelector('[data-part-id="chain"]')).toHaveClass("text-danger");
    expect(svg().querySelector('[data-part-id="saddle"]')).toHaveClass("text-success");
  });

  it("drops an initial selection that is not on the bike", async () => {
    await renderViewer({
      initialPartId: "rear-shock",
      initialPickedIds: ["chain", "rear-shock"],
      mode: "pick",
    });
    expect(viewer()).toHaveAttribute("data-selected", "");
    expect(svg().querySelector('[data-part-id="chain"]')).toHaveClass("text-warn");
  });

  it("prunes the selection when the build changes, without remounting", async () => {
    function Host() {
      const [build, setBuild] = useState(presetBuild("mtb-full-dropper-1x12"));
      return (
        <>
          <button type="button" onClick={() => setBuild(presetBuild("road-rim-2x11"))}>
            switch
          </button>
          <BikeViewer spec={build.spec} build={build} locale="fr" initialPartId="rear-shock" />
        </>
      );
    }
    const { user } = await renderWithIntl(<Host />);
    expect(viewer()).toHaveAttribute("data-selected", "rear-shock");
    await user.click(screen.getByRole("button", { name: "switch" }));
    expect(viewer()).toHaveAttribute("data-selected", "");
    expect(svg().querySelector('[data-part-id="rear-shock"]')).toBeNull();
    expect(svg().querySelector('[data-part-id="front-derailleur"]')).not.toBeNull();
  });

  it("shares one store with the host through BikeViewerProvider", async () => {
    function HostList() {
      const { api } = useViewerStoreApi();
      const selected = useViewerStore((state) => state.selectedPartId);
      return (
        <button
          type="button"
          data-selected={selected ?? ""}
          onClick={() => api.getState().select("chain" as PartId, { source: "list", focus: true })}
        >
          list-chain
        </button>
      );
    }
    const onSelect = vi.fn();
    const { user } = await renderWithIntl(
      <BikeViewerProvider build={gravel} mode="browse">
        <HostList />
        <BikeViewer spec={gravel.spec} build={gravel} locale="fr" onSelect={onSelect} />
      </BikeViewerProvider>,
    );
    await user.click(screen.getByRole("button", { name: "list-chain" }));
    expect(onSelect).toHaveBeenLastCalledWith("chain", "list");
    expect(viewer()).toHaveAttribute("data-selected", "chain");
    await user.click(within(svg()).getByRole("button", { name: "Selle" }));
    expect(screen.getByRole("button", { name: "list-chain" })).toHaveAttribute(
      "data-selected",
      "saddle",
    );
  });
});
