import { describe, expect, it } from "vitest";
import {
  crispPixel,
  formatRulerLabel,
  nearestRulerTick,
  RULER_THICKNESS,
  rulerScaleFor,
  rulerTicksFor,
  rulerView,
  viewportRange,
} from "./rulers";

describe("adaptive rulers", () => {
  it("keeps labels at least 64px apart at every supported zoom", () => {
    for (const zoom of [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4]) {
      const scale = rulerScaleFor(zoom);
      expect(scale.major * zoom).toBeGreaterThanOrEqual(64);
      expect([5, 2, 1]).toContain(scale.divisions);
    }
  });

  it("uses canonical font-unit steps", () => {
    expect(rulerScaleFor(1).major).toBe(100);
    expect(rulerScaleFor(0.25).major).toBe(500);
    expect(rulerScaleFor(4).major).toBe(20);
  });

  it("emits only major labels with no duplicates", () => {
    const scale = rulerScaleFor(1);
    const ticks = rulerTicksFor(-250, 750, scale);
    const labels = ticks.filter((tick) => tick.label);
    expect(labels.length).toBeGreaterThan(5);
    expect(new Set(labels.map((tick) => tick.label)).size).toBe(labels.length);
    expect(labels.every((tick) => tick.major)).toBe(true);
  });

  it("formats labels without floating point noise", () => {
    expect(formatRulerLabel(200.00000001)).toBe("200");
    expect(formatRulerLabel(12.5)).toBe("12.5");
  });

  it("derives both axes and the visible range from one viewport", () => {
    const view = rulerView({ x: 100, y: 400, zoom: 0.5 }, 800, 600);
    expect(view.range.xMin).toBeCloseTo(-200);
    expect(view.range.yMin).toBeCloseTo(-400);
    expect(view.scale.major).toBe(200);
    expect(view.xTicks.length).toBeGreaterThan(0);
    expect(view.yTicks.length).toBeGreaterThan(0);
    expect(viewportRange({ x: 0, y: 0, zoom: 1 }, 100, 200).yMax).toBe(0);
  });

  it("falls back safely for non-finite zoom and label targets", () => {
    expect(rulerScaleFor(Number.NaN).major).toBe(rulerScaleFor(1).major);
    expect(rulerScaleFor(0).major).toBe(rulerScaleFor(1).major);
    expect(rulerScaleFor(1, 0).major).toBe(rulerScaleFor(1).major);
  });

  it("quantises guide positions onto drawn ticks in both directions", () => {
    const scale = rulerScaleFor(1); // major 100, minor 20
    expect(nearestRulerTick(287, scale)).toBe(280);
    expect(nearestRulerTick(293, scale)).toBe(300);
    expect(nearestRulerTick(-93, scale)).toBe(-100);
    expect(nearestRulerTick(287, scale, "major")).toBe(300);
    expect(nearestRulerTick(Number.NaN, scale)).toBeNaN();
  });

  it("aligns ruler strokes to half pixels and matches CSS thickness", () => {
    expect(crispPixel(100.2)).toBe(100.5);
    expect(crispPixel(100.7)).toBe(101.5);
    expect(RULER_THICKNESS).toBe(20);
  });
});
