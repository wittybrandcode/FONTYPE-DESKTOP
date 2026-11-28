import { describe, expect, it } from "vitest";
import {
  alignPlacedRects,
  collectSnapTargets,
  distributePlacedRects,
  findSnap,
  fitViewport,
  flipPlacement,
  majorStepFor,
  movePlacement,
  rectFromPoints,
  rectsIntersect,
  rotatePlacementAround,
  rulerTicks,
  scalePlacementAxisAround,
  scalePlacementAround,
  screenToWorld,
  selectionBounds,
  stepZoom,
  transformRect,
  unionRect,
  worldToScreen,
  zoomAt,
  type Placement,
  type PlacedRect,
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

  it("aligns transformed edges, not axis-aligned assumptions", () => {
    const targets = collectSnapTargets({
      ...input,
      bounds: [0, 0, 200, 100],
      placement: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90 },
      leftSideBearing: 40,
      rightSideBearing: 40,
      guides: [{
        guideId: "v", orientation: "vertical", positionFU: 300,
        locked: false, visible: true, scope: "project",
      }],
    });
    // A 90° turn puts the artwork's left edge 100 FU left of its origin.
    expect(targets.find((item) => item.id === "guide:v:left")?.value).toBeCloseTo(400);
    expect(targets.find((item) => item.id === "outline:xMin")?.value).toBeCloseTo(100);
    expect(targets.find((item) => item.id === "outline:xMin")?.lineValue).toBe(0);
  });

  it("treats side bearings as edge lines and keeps cue coordinates", () => {
    const targets = collectSnapTargets(input);
    expect(targets.find((item) => item.id === "advance:lsb")?.value).toBe(-60);
    expect(targets.find((item) => item.id === "advance:lsb")?.lineValue).toBe(40);
    expect(targets.find((item) => item.id === "grid:x:0")?.lineValue).toBe(0);
  });
});

describe("selection geometry", () => {
  const identity: Placement = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const bounds = { xMin: 100, yMin: 0, xMax: 300, yMax: 400 };

  it("steps through the advertised discrete zoom levels", () => {
    expect(stepZoom(0.73, 1)).toBe(1);
    expect(stepZoom(0.73, -1)).toBe(0.5);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.02, -1)).toBe(0.25);
  });

  it("builds a marquee rectangle from any two screen corners", () => {
    expect(rectFromPoints({ x: 9, y: 3 }, { x: 2, y: 8 })).toEqual({ xMin: 2, yMin: 3, xMax: 9, yMax: 8 });
    expect(rectsIntersect({ xMin: 0, yMin: 0, xMax: 1, yMax: 1 }, { xMin: 2, yMin: 0, xMax: 3, yMax: 1 })).toBe(false);
  });

  it("unions placed artwork bounds after scale and rotation", () => {
    expect(transformRect(bounds, { ...identity, x: 20, y: 10 })).toEqual({ xMin: 120, yMin: 10, xMax: 320, yMax: 410 });
    const rect = transformRect(bounds, { ...identity, rotation: 90 });
    expect(rect.xMin).toBeCloseTo(-400, 6);
    expect(rect.xMax).toBeCloseTo(0, 6);
    const union = unionRect([rect, { xMin: 500, yMin: 500, xMax: 600, yMax: 600 }]);
    expect(union?.xMin).toBeCloseTo(-400, 6);
    expect(union?.xMax).toBe(600);
  });

  it("scales and rotates a placement around a world pivot without drifting", () => {
    const scaled = scalePlacementAround({ ...identity, x: 100, y: 100 }, { x: 0, y: 0 }, 2);
    expect(scaled.x).toBe(200);
    expect(scaled.scaleX).toBe(2);
    expect(transformPointForTest({ x: 10, y: 10 }, scaled).x).toBeCloseTo(220, 6);

    const axisScaled = scalePlacementAxisAround({ ...identity, x: 100, y: 100 }, { x: 0, y: 0 }, "x", 3);
    expect(axisScaled.x).toBe(300);
    expect(axisScaled.y).toBe(100);
    expect(axisScaled.scaleX).toBe(3);
    expect(axisScaled.scaleY).toBe(1);

    const rotated = rotatePlacementAround({ ...identity, x: 100, y: 0, rotation: 10 }, { x: 0, y: 0 }, 90);
    expect(rotated.x).toBeCloseTo(0, 6);
    expect(rotated.y).toBeCloseTo(100, 6);
    expect(rotated.rotation).toBe(100);
  });

  it("mirrors the artwork exactly, including its rotation direction", () => {
    const rotated: Placement = { x: 100, y: 40, scaleX: 1.2, scaleY: 0.8, rotation: 30 };
    const flipped = flipPlacement(rotated, "x", { x: 200, y: 40 });
    expect(flipped.scaleX).toBeCloseTo(-1.2, 6);
    expect(flipped.rotation).toBe(-30);
    expect(flipped.x).toBe(300);
    const source = { x: 20, y: 30 };
    const original = transformPointForTest(source, rotated);
    const mirrored = transformPointForTest(source, flipped);
    expect(mirrored.x).toBeCloseTo(400 - original.x, 6);
    expect(mirrored.y).toBeCloseTo(original.y, 6);
  });

  it("aligns and distributes placed rectangles deterministically", () => {
    const items: PlacedRect[] = [
      { id: "a", bounds, placement: { ...identity, x: 0 } },
      { id: "b", bounds, placement: { ...identity, x: 100 } },
      { id: "c", bounds, placement: { ...identity, x: 400 } },
    ];
    const aligned = alignPlacedRects(items, "left", { xMin: 50, yMin: 0, xMax: 250, yMax: 400 });
    expect(aligned.map((item) => item.placement.x)).toEqual([-50, -50, -50]);

    const distributed = distributePlacedRects(items, "x");
    expect(distributed.map((item) => item.placement.x)).toEqual([0, 200, 400]);
    expect(distributePlacedRects(items.slice(0, 2), "x").map((item) => item.placement.x)).toEqual([0, 100]);
    expect(selectionBounds(items)?.xMin).toBe(100);
  });

  it("moves every placement by the same font-unit delta", () => {
    expect(movePlacement({ ...identity, x: 40, y: -20 }, 10, -5)).toEqual({ ...identity, x: 50, y: -25 });
  });
});

function transformPointForTest(point: { x: number; y: number }, placement: Placement) {
  // Local projection of the engine's placement matrix: scale, then rotate, then translate.
  const radians = (placement.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: placement.x + placement.scaleX * point.x * cosine - placement.scaleY * point.y * sine,
    y: placement.y + placement.scaleX * point.x * sine + placement.scaleY * point.y * cosine,
  };
}
