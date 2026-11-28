import { describe, expect, it } from "vitest";
import { metricLayers, metricReadout, sideBearingLayers } from "./metricLayers";
import type { GlyphSlot, GlobalMetrics } from "./types";

const metrics: GlobalMetrics = {
  baseline: 0,
  ascender: 800,
  descender: -200,
  capHeight: null,
  arabicBodyHeight: 500,
  markTopZone: 850,
  markBottomZone: -250,
  metricLocks: { baseline: true },
  metricVisibility: { markBottomZone: false },
};

describe("M4 metric layers", () => {
  it("includes only visible numeric metrics and preserves locks", () => {
    const layers = metricLayers(metrics);
    expect(layers.map((layer) => layer.key)).not.toContain("capHeight");
    expect(layers.map((layer) => layer.key)).not.toContain("markBottomZone");
    expect(layers.find((layer) => layer.key === "baseline")?.locked).toBe(true);
  });

  it("derives side bearings from slot metrics without new fields", () => {
    const slot = {
      metrics: { advanceWidth: 600, leftSideBearing: 40, rightSideBearing: 60 },
    } as GlyphSlot;
    expect(sideBearingLayers(slot).map((layer) => layer.value)).toEqual([0, 40, 540, 600]);
    expect(sideBearingLayers(null)).toEqual([]);
  });

  it("formats compact readouts with dashes for missing metrics", () => {
    expect(metricReadout(metrics, ["baseline", "capHeight"])).toBe("baseline: 0 · capHeight: —");
  });
});
