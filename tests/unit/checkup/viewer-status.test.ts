/**
 * The workspace's tint after a checkup (§6.4 `status`): what a finished checkup
 * left in `BikePartState.status` on a saved bike, as the colours the 3D viewer
 * and the parts list understand.
 *
 * Three rules, each one a thing a visitor would notice if it broke:
 *
 *   - `OK` is green and `ATTENTION` / `BROKEN` are the KO tint — the viewer has
 *     two verdict colours, and a part that needs attention is one the checkup
 *     wants looked at;
 *   - `UNKNOWN` paints NOTHING: a bike that has never been checked would
 *     otherwise come up entirely in the "todo" colour, and "nothing is known"
 *     is not a finding;
 *   - an id the catalogue does not know is dropped, and a bike with nothing to
 *     say gets `undefined` (no `status` prop at all), not an empty object.
 */
import { describe, expect, it } from "vitest";

import { toneOf, viewerStatus } from "@/components/checkup/viewer-status";

describe("toneOf", () => {
  it("maps the four stored statuses onto the viewer's two verdict colours", () => {
    expect(toneOf("OK")).toBe("ok");
    expect(toneOf("ATTENTION")).toBe("ko");
    expect(toneOf("BROKEN")).toBe("ko");
    expect(toneOf("UNKNOWN")).toBeNull();
  });
});

describe("viewerStatus", () => {
  it("tints what a checkup found and nothing else", () => {
    expect(
      viewerStatus({
        chain: "OK",
        "brake-caliper-front": "ATTENTION",
        "tire-rear": "BROKEN",
        saddle: "UNKNOWN",
      }),
    ).toEqual({ chain: "ok", "brake-caliper-front": "ko", "tire-rear": "ko" });
  });

  it("paints nothing on a bike that was never checked", () => {
    expect(viewerStatus({ chain: "UNKNOWN", saddle: "UNKNOWN" })).toBeUndefined();
    expect(viewerStatus({})).toBeUndefined();
    expect(viewerStatus(undefined)).toBeUndefined();
  });

  it("drops a part id the catalogue does not know, and a hole in the record", () => {
    expect(
      viewerStatus({ "not-a-part": "BROKEN", ["__proto__"]: "OK", chain: undefined, saddle: "OK" }),
    ).toEqual({ saddle: "ok" });
  });
});
