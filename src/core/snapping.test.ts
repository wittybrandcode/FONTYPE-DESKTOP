import { describe, expect, it } from "vitest";
import { rulerScaleFor } from "./rulers";
import {
  cullSnapTargets,
  guideDragTargets,
  smartGuides,
  snapDistanceFU,
  snapGuidePosition,
  SNAP_PRIORITY,
} from "./snapping";
import { findSnap, transformRect, type Placement, type SnapTarget } from "./workspace";

const placement: Placement = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
const rect = (xMin: number, yMin: number, xMax: number, yMax: number) => ({ xMin, yMin, xMax, yMax });

describe("professional snapping", () => {
  it("documents priority from anchors through grid", () => {
    expect(Object.values(SNAP_PRIORITY)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("converts a pixel tolerance into font units and lets lower priority win", () => {
    const targets: SnapTarget[] = [
      { id: "grid", kind: "grid", priority: 6, axis: "x", value: 10, label: "شبكة" },
      { id: "anchor", kind: "anchor", priority: 1, axis: "x", value: 12, label: "مرساة" },
    ];
    const result = findSnap({ x: 10.5, y: 0 }, targets, {
      enabled: {},
      tolerancePx: 8,
      hysteresisPx: 0,
      zoom: 0.5,
    });
    expect(result.point.x).toBe(12);
    expect(result.winnerId).toBe("anchor");
    expect(snapDistanceFU(result, 0.5)).toBeCloseTo(1.5);
  });

  it("culls off-screen grid candidates only", () => {
    const targets: SnapTarget[] = [
      { id: "grid:near", kind: "grid", priority: 6, axis: "x", value: 500, label: "شبكة" },
      { id: "grid:far", kind: "grid", priority: 6, axis: "x", value: 9000, label: "شبكة" },
      { id: "guide", kind: "guide", priority: 3, axis: "y", value: 9000, label: "دليل" },
    ];
    const culled = cullSnapTargets(targets, rect(0, 0, 1000, 1000), 100);
    expect(culled.map((target) => target.id)).toEqual(["grid:near", "guide"]);
  });

  it("culls grid targets per axis instead of using the x range for y", () => {
    const targets: SnapTarget[] = [
      { id: "grid:y:near", kind: "grid", priority: 6, axis: "y", value: 120, label: "شبكة" },
      { id: "grid:x:far", kind: "grid", priority: 6, axis: "x", value: 9000, label: "شبكة" },
      { id: "guide", kind: "guide", priority: 3, axis: "y", value: 9000, label: "دليل" },
    ];
    const culled = cullSnapTargets(targets, rect(0, 0, 100, 100), 50);
    expect(culled.map((target) => target.id)).toEqual(["grid:y:near", "guide"]);
  });

  it("builds guide-drag targets from sibling guides and ruler ticks only", () => {
    const scale = rulerScaleFor(1);
    const guides = [
      { guideId: "v1", orientation: "vertical", positionFU: 200, locked: true, scope: "project", visible: true, name: "رأسي" },
      { guideId: "v2", orientation: "vertical", positionFU: 260, locked: false, scope: "other", visible: true },
      { guideId: "h1", orientation: "horizontal", positionFU: 300, locked: false, scope: "project", visible: true },
      { guideId: "hidden", orientation: "vertical", positionFU: 400, locked: false, scope: "project", visible: false },
    ];
    const targets = guideDragTargets(guides, "x", "slot-a", scale, rect(0, 0, 400, 400));
    expect(targets.find((target) => target.id === "guide:v1:position")?.priority).toBe(3);
    expect(targets.some((target) => target.id.includes("v2"))).toBe(false);
    expect(targets.some((target) => target.id.includes("h1"))).toBe(false);
    expect(targets.some((target) => target.id.includes("hidden"))).toBe(false);
    expect(targets.filter((target) => target.kind === "grid").every((target) => target.axis === "x")).toBe(true);
    expect(
      guideDragTargets(guides, "x", "slot-a", scale, rect(0, 0, 400, 400), "v1")
        .some((target) => target.id.includes("v1")),
    ).toBe(false);
  });

  it("snaps a ruler guide to a sibling guide, then to the nearest tick", () => {
    const scale = rulerScaleFor(1);
    const guides = [
      { guideId: "v1", orientation: "vertical", positionFU: 200, locked: false, scope: "project", visible: true },
      { guideId: "v2", orientation: "vertical", positionFU: 460, locked: false, scope: "slot-a", visible: true },
    ];
    const targets = guideDragTargets(guides, "x", "slot-a", scale, rect(0, 0, 400, 400), "v2");
    const options = { enabled: { guides: true, grid: true }, tolerancePx: 8, hysteresisPx: 0, zoom: 1 };

    const toGuide = snapGuidePosition(198, "x", targets, options);
    expect(toGuide.position).toBe(200);
    expect(toGuide.result.winnerId).toBe("guide:v1:position");

    const toTick = snapGuidePosition(263, "x", targets, options);
    expect(toTick.position).toBe(260);
    expect(toTick.result.winnerId).toMatch(/^grid:/);

    const free = snapGuidePosition(210, "x", targets, options);
    expect(free.position).toBe(210);
    expect(free.result.snapped).toBe(false);
  });

  it("finds aligned edges and equal spacing", () => {
    const items = [
      { id: "a", bounds: rect(0, 0, 100, 100), placement },
      { id: "b", bounds: rect(200, 0, 300, 100), placement },
      { id: "c", bounds: rect(400, 0, 500, 100), placement },
    ];
    const guides = smartGuides(items, (item) => transformRect(item.bounds, item.placement), 0.01, 600);
    expect(guides.some((guide) => guide.id.includes("y:min") && guide.label === "حافتان متحاذيتان")).toBe(true);
    expect(guides.some((guide) => guide.id === "smart:x:equal")).toBe(true);
    expect(guides.some((guide) => guide.id === "smart:advance:end")).toBe(true);
  });
});
