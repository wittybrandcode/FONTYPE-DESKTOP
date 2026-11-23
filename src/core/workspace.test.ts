import { describe, expect, it } from "vitest";
import {
  collectSnapTargets,
  findSnap,
  fitViewport,
  majorStepFor,
  rulerTicks,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type SnapTarget,
} from "./workspace";

const viewport = { x: 300, y: 500, zoom: 0.8 };

describe("viewport transforms", () => {
  it("round-trips font and screen coordinates", () => {
    const point = { x: 420, y: -180 };
    const screen = worldToScreen(point, viewport);
    const back = screenToWorld(screen, viewport);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it("keeps the anchored screen point fixed while zooming", () => {
    const anchor = { x: 640, y: 360 };
    const next = zoomAt(viewport, 1.5, anchor);
    const screen = worldToScreen(screenToWorld(anchor, viewport), next);
    expect(screen.x).toBeCloseTo(anchor.x, 6);
    expect(screen.y).toBeCloseTo(anchor.y, 6);
    expect(next.zoom).toBeCloseTo(1.2, 6);
  });

  it("fits the em box inside the canvas", () => {
    const fitted = fitViewport(1000, 800, 600);
    expect(fitted.zoom).toBeGreaterThan(0);
    const topLeft = worldToScreen({ x: 0, y: 1000 }, fitted);
    expect(topLeft.x).toBeGreaterThan(0);
    expect(topLeft.y).toBeGreaterThan(0);
  });
});

describe("rulers", () => {
  it("uses 1/2/5-style major steps", () => {
    expect(majorStepFor(0.5)).toBe(200);
    expect(majorStepFor(1)).toBe(100);
    expect(majorStepFor(2)).toBe(50);
  });

  it("marks majors and minors distinctly", () => {
    const ticks = rulerTicks(0, 200, 100, 4);
    expect(ticks.some((tick) => tick.major && tick.value === 100)).toBe(true);
    expect(ticks.some((tick) => !tick.major && tick.value === 25)).toBe(true);
    expect(ticks.find((tick) => tick.value === 100)?.label).toBe("100");
  });
});

function target(
  id: string,
  priority: number,
  axis: "x" | "y",
  value: number,
  kind: SnapTarget["kind"] = "guide",
): SnapTarget {
  return { id, priority, axis, value, kind, label: id };
}

const options = {
  enabled: {
    grid: true,
    metricLines: true,
    guides: true,
    glyphBounds: true,
    advanceBoundaries: true,
    outlineNodes: true,
    anchors: true,
  },
  tolerancePx: 8,
  hysteresisPx: 3,
  zoom: 1,
};

describe("snapping", () => {
  it("snaps to a nearby target and reports the winner", () => {
    const result = findSnap({ x: 103, y: 0 }, [target("g1", 3, "x", 100)], options);
    expect(result.point.x).toBe(100);
    expect(result.snapped).toBe(true);
    expect(result.winnerId).toBe("g1");
    expect(result.distancePx).toBe(3);
  });

  it("does not snap beyond screen-pixel tolerance", () => {
    const result = findSnap({ x: 120, y: 0 }, [target("g1", 3, "x", 100)], options);
    expect(result.point.x).toBe(120);
    expect(result.snapped).toBe(false);
  });

  it("prefers higher priority even when it is farther away", () => {
    const targets = [target("grid", 6, "x", 101), target("metric", 2, "x", 104, "metricLine")];
    const result = findSnap({ x: 100, y: 0 }, targets, options);
    expect(result.winnerId).toBe("metric");
    expect(result.point.x).toBe(104);
  });

  it("breaks equal-priority, equal-distance ties deterministically by id", () => {
    const targets = [target("z-guide", 3, "x", 96), target("a-guide", 3, "x", 104)];
    const result = findSnap({ x: 100, y: 0 }, targets, options);
    expect(result.winnerId).toBe("a-guide");
  });

  it("keeps the active target within the hysteresis margin", () => {
    const targets = [target("g1", 3, "x", 100), target("g2", 3, "x", 118)];
    const result = findSnap({ x: 110, y: 0 }, targets, { ...options, currentId: "g1" });
    expect(result.winnerId).toBe("g1");
    expect(result.point.x).toBe(100);
  });

  it("keeps snap tolerance in screen pixels across zoom levels", () => {
    const targets = [target("g1", 3, "x", 100)];
    expect(findSnap({ x: 110, y: 0 }, targets, options).snapped).toBe(false);
    expect(
      findSnap({ x: 110, y: 0 }, targets, { ...options, zoom: 0.5 }).snapped,
    ).toBe(true);
  });

  it("ignores disabled target groups", () => {
    const result = findSnap({ x: 103, y: 0 }, [target("g1", 3, "x", 100)], {
      ...options,
      enabled: { ...options.enabled, guides: false },
    });
    expect(result.snapped).toBe(false);
  });
});

describe("snap target registry", () => {
  const input = {
    upm: 1000,
    advanceWidth: 600,
    leftSideBearing: 40,
    rightSideBearing: 60,
    bounds: [100, 0, 300, 500] as [number, number, number, number],
    scaleX: 1,
    scaleY: 1,
    metricValues: { baseline: 0, ascender: 800 },
    metricLocks: { baseline: true, ascender: false },
    guides: [
      {
        guideId: "v1",
        orientation: "vertical",
        positionFU: 200,
        locked: true,
        visible: true,
        scope: "project",
      },
      {
        guideId: "h1",
        orientation: "horizontal",
        positionFU: 700,
        locked: false,
        visible: true,
        scope: "beh.initial",
      },
      {
        guideId: "hidden",
        orientation: "vertical",
        positionFU: 900,
        locked: false,
        visible: false,
        scope: "project",
      },
    ],
    scope: "beh.initial",
    visibleRange: { xMin: -100, xMax: 700, yMin: -200, yMax: 900 },
    majorStep: 100,
    divisions: 5,
  };

  it("converts guides and metrics into origin-space targets", () => {
    const targets = collectSnapTargets(input);
    expect(targets.find((item) => item.id === "guide:v1:left")?.value).toBe(100);
    expect(targets.find((item) => item.id === "guide:h1:bottom")?.value).toBe(700);
    expect(targets.find((item) => item.id === "metric:baseline:bottom")?.priority).toBe(2);
    expect(targets.some((item) => item.id.includes("hidden"))).toBe(false);
  });

  it("limits grid targets to the visible range", () => {
    const targets = collectSnapTargets(input);
    const gridX = targets.filter((item) => item.id.startsWith("grid:x:"));
    expect(gridX.length).toBeGreaterThan(0);
    expect(gridX.every((item) => item.value >= -100 && item.value <= 700)).toBe(true);
    expect(targets.find((item) => item.id === "advance:end")?.value).toBe(600);
  });
});
