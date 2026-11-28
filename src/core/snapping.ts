/** R3 — snap priority, tolerance and smart guides, isolated from the canvas. */

import type { RulerScale } from "./rulers";
import {
  collectSnapTargets,
  findSnap,
  gridSnapTargets,
  type PlacedRect,
  type Point,
  type Rect,
  type SnapOptions,
  type SnapResult,
  type SnapTarget,
  type TargetInput,
} from "./workspace";

/** Lower number wins. Ties resolve by distance, then deterministically by id. */
export const SNAP_PRIORITY = {
  anchors: 1,
  metricLines: 2,
  guides: 3,
  outline: 4,
  advance: 5,
  grid: 6,
} as const;

export type { SnapOptions, SnapResult, SnapTarget, TargetInput };

export function buildSnapTargets(input: TargetInput): SnapTarget[] {
  return collectSnapTargets(input);
}

export function resolveSnap(point: Point, targets: SnapTarget[], options: SnapOptions): SnapResult {
  return findSnap(point, targets, options);
}

/** Converts the screen-space snap delta into font units for the status readout. */
export function snapDistanceFU(result: SnapResult, zoom: number): number {
  return result.distancePx / Math.max(zoom, 1e-6);
}

export interface GuideLike {
  guideId: string;
  orientation: string;
  positionFU: number;
  locked: boolean;
  scope: string;
  visible: boolean;
  name?: string;
}

/**
 * Targets used while creating or dragging a ruler guide: other guides on the
 * same axis win over the ruler's own minor ticks. The dragged guide excludes
 * itself so it can never snap to its old position.
 */
export function guideDragTargets(
  guides: GuideLike[],
  axis: "x" | "y",
  scope: string,
  scale: RulerScale,
  range: Rect,
  excludeId: string | null = null,
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const guide of guides) {
    const guideAxis = guide.orientation === "vertical" ? "x" : "y";
    if (guideAxis !== axis || guide.guideId === excludeId || !guide.visible) continue;
    if (guide.scope !== "project" && guide.scope !== scope) continue;
    if (!Number.isFinite(guide.positionFU)) continue;
    targets.push({
      id: `guide:${guide.guideId}:position`,
      kind: "guide",
      priority: guide.locked ? SNAP_PRIORITY.guides : SNAP_PRIORITY.guides + 1,
      axis,
      value: guide.positionFU,
      lineValue: guide.positionFU,
      label: guide.name || guide.guideId,
    });
  }
  targets.push(...gridSnapTargets(scale.major, scale.divisions, range).filter((target) => target.axis === axis));
  return targets;
}

/** Resolves a one-axis guide position through the normal snap pipeline. */
export function snapGuidePosition(value: number, axis: "x" | "y", targets: SnapTarget[], options: SnapOptions) {
  const result = resolveSnap(
    { x: axis === "x" ? value : 0, y: axis === "y" ? value : 0 },
    targets,
    options,
  );
  return {
    position: axis === "x" ? result.point.x : result.point.y,
    result,
  };
}

/** Keeps only grid candidates near the visible range, using each axis's own bounds. */
export function cullSnapTargets(targets: SnapTarget[], range: Rect, overscanFU = 200): SnapTarget[] {
  return targets.filter((target) => {
    if (target.kind !== "grid") return true;
    const min = target.axis === "x" ? range.xMin : range.yMin;
    const max = target.axis === "x" ? range.xMax : range.yMax;
    return target.value >= min - overscanFU && target.value <= max + overscanFU;
  });
}

export interface SmartGuide {
  id: string;
  axis: "x" | "y";
  value: number;
  from: number;
  to: number;
  label: string;
}

const center = (rect: Rect, axis: "x" | "y") =>
  axis === "x" ? (rect.xMin + rect.xMax) / 2 : (rect.yMin + rect.yMax) / 2;

/** Perpendicular span used to clip a guide line to the artwork it relates to. */
const perpendicularExtent = (rect: Rect, axis: "x" | "y"): [number, number] =>
  axis === "x" ? [rect.yMin, rect.yMax] : [rect.xMin, rect.xMax];

/** Transient alignment cues derived from neighbouring artwork and equal spacing. */
export function smartGuides(
  items: PlacedRect[],
  boundsOf: (item: PlacedRect) => Rect,
  toleranceFU: number,
  advanceWidth?: number,
): SmartGuide[] {
  const guides: SmartGuide[] = [];
  const placed = items.map((item) => ({ id: item.id, rect: boundsOf(item) }));
  const tolerance = Math.max(0, toleranceFU);

  for (const axis of ["x", "y"] as const) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i].rect;
        const b = placed[j].rect;
        const candidates: Array<[string, number, number]> = [
          ["min", a[axis === "x" ? "xMin" : "yMin"], b[axis === "x" ? "xMin" : "yMin"]],
          ["max", a[axis === "x" ? "xMax" : "yMax"], b[axis === "x" ? "xMax" : "yMax"]],
          ["center", center(a, axis), center(b, axis)],
        ];
        for (const [kind, first, second] of candidates) {
          if (Math.abs(first - second) > tolerance) continue;
          const [fromA, toA] = perpendicularExtent(a, axis);
          const [fromB, toB] = perpendicularExtent(b, axis);
          guides.push({
            id: `smart:${axis}:${kind}:${placed[i].id}:${placed[j].id}`,
            axis,
            value: (first + second) / 2,
            from: Math.min(fromA, fromB),
            to: Math.max(toA, toB),
            label: kind === "center" ? "مركزان متحاذيان" : "حافتان متحاذيتان",
          });
        }
      }
    }
  }

  for (const axis of ["x", "y"] as const) {
    const sorted = placed
      .map((item) => ({ id: item.id, value: center(item.rect, axis) }))
      .sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
    if (sorted.length < 3) continue;
    const gaps = sorted.slice(1).map((item, index) => item.value - sorted[index].value);
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (gaps.every((gap) => Math.abs(gap - average) <= tolerance)) {
      const spans = placed.map((item) => perpendicularExtent(item.rect, axis));
      guides.push({
        id: `smart:${axis}:equal`,
        axis,
        value: average,
        from: Math.min(...spans.map((span) => span[0])),
        to: Math.max(...spans.map((span) => span[1])),
        label: "مسافات متساوية",
      });
    }
  }

  if (advanceWidth && advanceWidth > 0) {
    const spans = placed.map((item) => perpendicularExtent(item.rect, "x"));
    const from = spans.length ? Math.min(...spans.map((span) => span[0])) : 0;
    const to = spans.length ? Math.max(...spans.map((span) => span[1])) : 1000;
    guides.push({ id: "smart:advance:start", axis: "x", value: 0, from, to, label: "أصل التقدّم" });
    guides.push({ id: "smart:advance:end", axis: "x", value: advanceWidth, from, to, label: "نهاية التقدّم" });
  }

  return guides;
}
