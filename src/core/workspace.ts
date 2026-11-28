/** Pure font-unit workspace math: viewport transforms, rulers, selection and snapping. */

import { rulerScaleFor, rulerTicksFor } from "./rulers";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface Viewport {
  /** Screen x of font origin, in CSS pixels. */
  x: number;
  /** Screen y of font origin, in CSS pixels (font Y grows upward). */
  y: number;
  /** CSS pixels per font unit. */
  zoom: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return { x: viewport.x + point.x * viewport.zoom, y: viewport.y - point.y * viewport.zoom };
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (viewport.y - point.y) / viewport.zoom };
}

/** Zooms around a fixed screen anchor so the point under the cursor stays put. */
export function zoomAt(viewport: Viewport, factor: number, anchor: Point): Viewport {
  const before = screenToWorld(anchor, viewport);
  const zoom = clamp(viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const next: Viewport = { ...viewport, zoom };
  const after = worldToScreen(before, next);
  return { x: next.x + anchor.x - after.x, y: next.y + anchor.y - after.y, zoom };
}

/** Centers a sensible font range in the given pixel canvas. */
export function fitViewport(
  upm: number,
  width: number,
  height: number,
  bounds?: Rect | null,
): Viewport {
  const range: Rect = bounds
    ? {
        xMin: Math.min(bounds.xMin, -upm * 0.1),
        xMax: Math.max(bounds.xMax, upm * 1.1),
        yMin: Math.min(bounds.yMin, -upm * 0.4),
        yMax: Math.max(bounds.yMax, upm * 1.0),
      }
    : { xMin: -upm * 0.15, xMax: upm * 1.15, yMin: -upm * 0.4, yMax: upm * 1.0 };
  const spanX = Math.max(1, range.xMax - range.xMin);
  const spanY = Math.max(1, range.yMax - range.yMin);
  const zoom = clamp(Math.min(width / spanX, height / spanY) * 0.88, MIN_ZOOM, MAX_ZOOM);
  const center = { x: (range.xMin + range.xMax) / 2, y: (range.yMin + range.yMax) / 2 };
  return {
    x: width / 2 - center.x * zoom,
    y: height / 2 + center.y * zoom,
    zoom,
  };
}

/** Kept for callers of the original math API; the canonical engine is `rulers.ts`. */
export function majorStepFor(zoom: number, targetPx = 72): number {
  return rulerScaleFor(zoom, targetPx).major;
}

export interface Tick {
  value: number;
  major: boolean;
  label: string;
}

export function rulerTicks(min: number, max: number, major: number, divisions: number): Tick[] {
  return rulerTicksFor(min, max, { major, minor: major / Math.max(1, divisions), divisions });
}

export type SnapKind = "anchor" | "metricLine" | "guide" | "outline" | "advance" | "grid";

export interface SnapTarget {
  id: string;
  kind: SnapKind;
  /** Lower number wins; deterministic tie-break follows distance then id. */
  priority: number;
  axis: "x" | "y";
  /** Desired font coordinate of the artwork origin for this alignment. */
  value: number;
  /** Actual font coordinate where the cue line should be drawn. */
  lineValue?: number;
  label: string;
}

export interface SnapResult {
  point: Point;
  snapped: boolean;
  active: SnapTarget[];
  winnerId: string | null;
  distancePx: number;
}

export interface SnapOptions {
  enabled: Record<string, boolean>;
  tolerancePx: number;
  hysteresisPx: number;
  zoom: number;
  currentId?: string | null;
}

const TARGET_GROUP: Record<SnapKind, string> = {
  anchor: "anchors",
  metricLine: "metricLines",
  guide: "guides",
  outline: "glyphBounds",
  advance: "advanceBoundaries",
  grid: "grid",
};

/** Picks the single best x target and y target with deterministic priority. */
export function findSnap(point: Point, targets: SnapTarget[], options: SnapOptions): SnapResult {
  const tolerance = Math.max(0, options.tolerancePx) / Math.max(options.zoom, 1e-6);
  const hysteresis = Math.max(0, options.hysteresisPx) / Math.max(options.zoom, 1e-6);
  const axes: Array<"x" | "y"> = ["x", "y"];
  const active: SnapTarget[] = [];
  let winnerId: string | null = null;
  let winnerPriority = Number.POSITIVE_INFINITY;
  let winnerDistance = Number.POSITIVE_INFINITY;
  const snapped = { ...point };

  for (const axis of axes) {
    const candidates = targets
      .filter((target) => target.axis === axis && options.enabled[TARGET_GROUP[target.kind]] !== false)
      .map((target) => {
        const raw = Math.abs(point[axis] - target.value);
        const adjusted = target.id === options.currentId ? Math.max(0, raw - hysteresis) : raw;
        return { target, raw, adjusted };
      })
      .filter((candidate) => candidate.adjusted <= tolerance)
      .sort((a, b) =>
        a.target.priority - b.target.priority ||
        a.adjusted - b.adjusted ||
        a.raw - b.raw ||
        a.target.id.localeCompare(b.target.id),
      );

    const best = candidates[0];
    if (!best) continue;
    snapped[axis] = best.target.value;
    active.push(best.target);
    const better =
      best.target.priority < winnerPriority ||
      (best.target.priority === winnerPriority && best.adjusted < winnerDistance);
    if (better) {
      winnerPriority = best.target.priority;
      winnerDistance = best.adjusted;
      winnerId = best.target.id;
    }
  }

  return {
    point: snapped,
    snapped: active.length > 0,
    active,
    winnerId,
    distancePx: Number.isFinite(winnerDistance) ? winnerDistance * options.zoom : 0,
  };
}

export interface TargetInput {
  upm: number;
  advanceWidth: number;
  leftSideBearing: number;
  rightSideBearing: number;
  bounds: [number, number, number, number] | null;
  scaleX: number;
  scaleY: number;
  /**
   * Full placement when available. Rotation changes which origin aligns an
   * edge to a line; omitting it keeps the legacy scale-only behaviour.
   */
  placement?: Placement;
  metricValues: Record<string, number | null | undefined>;
  metricLocks: Record<string, boolean>;
  guides: Array<{ guideId: string; orientation: string; positionFU: number; locked: boolean; scope: string; visible: boolean; name?: string }>;
  scope: string;
  visibleRange: Rect;
  majorStep: number;
  divisions: number;
}

/** Ruler ticks expressed as snap targets, limited to the visible range. */
export function gridSnapTargets(majorStep: number, divisions: number, range: Rect): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const minor = majorStep / Math.max(1, divisions);
  if (!Number.isFinite(minor) || minor <= 0) return targets;
  for (const axis of ["x", "y"] as const) {
    const min = axis === "x" ? range.xMin : range.yMin;
    const max = axis === "x" ? range.xMax : range.yMax;
    const first = Math.ceil(min / minor - 1e-9);
    const last = Math.floor(max / minor + 1e-9);
    for (let index = first; index <= last; index += 1) {
      const value = Number((index * minor).toFixed(6));
      targets.push({
        id: `grid:${axis}:${index}`, kind: "grid", priority: 6, axis,
        value, lineValue: value, label: "الشبكة",
      });
    }
  }
  return targets;
}

/** Builds snap candidates expressed as desired origin coordinates. */
export function collectSnapTargets(input: TargetInput): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const [bxMin, byMin, bxMax, byMax] = input.bounds ?? [0, 0, 0, 0];
  const placement: Placement = input.placement ?? {
    x: 0, y: 0, scaleX: input.scaleX, scaleY: input.scaleY, rotation: 0,
  };
  const placed = input.bounds
    ? transformRect({ xMin: bxMin, yMin: byMin, xMax: bxMax, yMax: byMax }, placement)
    : null;
  const push = (
    id: string,
    kind: SnapKind,
    priority: number,
    axis: "x" | "y",
    value: number,
    label: string,
    lineValue?: number,
  ) => targets.push({ id, kind, priority, axis, value, lineValue, label });

  /** Origin coordinate that puts the requested transformed edge on `line`. */
  const originFor = (axis: "x" | "y", edge: "min" | "max", line: number): number => {
    if (!placed) {
      const offset = axis === "x"
        ? (edge === "min" ? bxMin : bxMax) * input.scaleX
        : (edge === "min" ? byMin : byMax) * input.scaleY;
      return line - offset;
    }
    const key = axis === "x"
      ? (edge === "min" ? "xMin" : "xMax")
      : (edge === "min" ? "yMin" : "yMax");
    return placement[axis] + line - placed[key];
  };

  // 1. Anchors (filled in Phase 3); reserved priority above all others.
  // 2. Baseline and metric lines. Artwork bottom/top align to the line.
  for (const [key, raw] of Object.entries(input.metricValues)) {
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    const locked = input.metricLocks[key] === true;
    const priority = locked ? 2 : 4;
    push(`metric:${key}:bottom`, "metricLine", priority, "y", originFor("y", "min", raw), `${key} ← قاع`, raw);
    push(`metric:${key}:top`, "metricLine", priority, "y", originFor("y", "max", raw), `${key} ← قمة`, raw);
    if (key === "baseline") push("origin:y", "outline", 4, "y", 0, "الأصل", 0);
  }

  // 3. Custom guides — project-wide plus guides scoped to this slot.
  for (const guide of input.guides) {
    if (!guide.visible || (guide.scope !== "project" && guide.scope !== input.scope)) continue;
    if (!Number.isFinite(guide.positionFU)) continue;
    const priority = guide.locked ? 3 : 4;
    const label = guide.name || guide.guideId;
    if (guide.orientation === "vertical") {
      push(`guide:${guide.guideId}:origin`, "guide", priority, "x", guide.positionFU, label, guide.positionFU);
      push(
        `guide:${guide.guideId}:left`, "guide", priority, "x",
        originFor("x", "min", guide.positionFU), `${label} ← يسار`, guide.positionFU,
      );
      push(
        `guide:${guide.guideId}:right`, "guide", priority, "x",
        originFor("x", "max", guide.positionFU), `${label} ← يمين`, guide.positionFU,
      );
    } else {
      push(`guide:${guide.guideId}:origin`, "guide", priority, "y", guide.positionFU, label, guide.positionFU);
      push(
        `guide:${guide.guideId}:bottom`, "guide", priority, "y",
        originFor("y", "min", guide.positionFU), `${label} ← قاع`, guide.positionFU,
      );
      push(
        `guide:${guide.guideId}:top`, "guide", priority, "y",
        originFor("y", "max", guide.positionFU), `${label} ← قمة`, guide.positionFU,
      );
    }
  }

  // 4. Outline bounds and extrema relative to the current origin.
  push("outline:xMin", "outline", 4, "x", originFor("x", "min", 0), "حدود الرسم ← يسار", 0);
  push("outline:xMax", "outline", 4, "x", originFor("x", "max", 0), "حدود الرسم ← يمين", 0);
  push("outline:yMin", "outline", 4, "y", originFor("y", "min", 0), "حدود الرسم ← قاع", 0);
  push("outline:yMax", "outline", 4, "y", originFor("y", "max", 0), "حدود الرسم ← قمة", 0);

  // 5. Advance and side-bearing boundaries; edge targets use the transformed box.
  const rsb = input.advanceWidth - input.rightSideBearing;
  push("advance:origin", "advance", 5, "x", 0, "أصل الخانة", 0);
  push("advance:end", "advance", 5, "x", input.advanceWidth, "نهاية التقدّم", input.advanceWidth);
  push("advance:lsb", "advance", 5, "x", originFor("x", "min", input.leftSideBearing), "الحافة اليسرى", input.leftSideBearing);
  push("advance:rsb", "advance", 5, "x", originFor("x", "max", rsb), "الحافة اليمنى", rsb);

  // 6. Grid intersections are visible-range limited to avoid huge arrays.
  targets.push(...gridSnapTargets(input.majorStep, input.divisions, input.visibleRange));
  return targets;
}

/* -------------------------------------------------------------------------- */
/* Phase 9 M1/M2 — selection geometry and placement transforms               */
/* -------------------------------------------------------------------------- */

/** Shape of `GlyphSlot["placement"]`, kept structural so this module stays pure. */
export interface Placement {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface PlacedRect {
  id: string;
  bounds: Rect;
  placement: Placement;
}

/** Discrete steps offered by the canvas zoom buttons and keyboard. */
export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4] as const;

/** Next/previous discrete zoom above or below the current fractional zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const below = [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6);
  return below ?? ZOOM_STEPS[0];
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    xMin: Math.min(a.x, b.x),
    yMin: Math.min(a.y, b.y),
    xMax: Math.max(a.x, b.x),
    yMax: Math.max(a.y, b.y),
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.xMax < b.xMin || b.xMax < a.xMin || a.yMax < b.yMin || b.yMax < a.yMin);
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return rects.reduce(
    (acc, rect) => ({
      xMin: Math.min(acc.xMin, rect.xMin),
      yMin: Math.min(acc.yMin, rect.yMin),
      xMax: Math.max(acc.xMax, rect.xMax),
      yMax: Math.max(acc.yMax, rect.yMax),
    }),
    { ...rects[0] },
  );
}

/** Maps an artwork point in font units through a slot placement into world units. */
export function transformPoint(point: Point, placement: Placement): Point {
  const radians = (placement.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: placement.x + placement.scaleX * point.x * cosine - placement.scaleY * point.y * sine,
    y: placement.y + placement.scaleX * point.x * sine + placement.scaleY * point.y * cosine,
  };
}

/** Axis-aligned world bounds of a placed artwork rectangle. */
export function transformRect(bounds: Rect, placement: Placement): Rect {
  const corners = [
    transformPoint({ x: bounds.xMin, y: bounds.yMin }, placement),
    transformPoint({ x: bounds.xMin, y: bounds.yMax }, placement),
    transformPoint({ x: bounds.xMax, y: bounds.yMin }, placement),
    transformPoint({ x: bounds.xMax, y: bounds.yMax }, placement),
  ];
  return {
    xMin: Math.min(...corners.map((point) => point.x)),
    yMin: Math.min(...corners.map((point) => point.y)),
    xMax: Math.max(...corners.map((point) => point.x)),
    yMax: Math.max(...corners.map((point) => point.y)),
  };
}

/** Bounding box of the whole selection in world (font) coordinates. */
export function selectionBounds(items: PlacedRect[]): Rect | null {
  return unionRect(items.map((item) => transformRect(item.bounds, item.placement)));
}

export function movePlacement(placement: Placement, dx: number, dy: number): Placement {
  return { ...placement, x: placement.x + dx, y: placement.y + dy };
}

/** Uniform scale keeps rotation exact when scaling around a world pivot. */
export function scalePlacementAround(placement: Placement, pivot: Point, factor: number): Placement {
  return {
    ...placement,
    x: pivot.x + (placement.x - pivot.x) * factor,
    y: pivot.y + (placement.y - pivot.y) * factor,
    scaleX: placement.scaleX * factor,
    scaleY: placement.scaleY * factor,
  };
}

/** Single-axis resize around a world pivot; the other axis stays untouched. */
export function scalePlacementAxisAround(
  placement: Placement,
  pivot: Point,
  axis: "x" | "y",
  factor: number,
): Placement {
  return axis === "x"
    ? {
        ...placement,
        x: pivot.x + (placement.x - pivot.x) * factor,
        scaleX: placement.scaleX * factor,
      }
    : {
        ...placement,
        y: pivot.y + (placement.y - pivot.y) * factor,
        scaleY: placement.scaleY * factor,
      };
}

export function rotatePlacementAround(placement: Placement, pivot: Point, degrees: number): Placement {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = placement.x - pivot.x;
  const dy = placement.y - pivot.y;
  return {
    ...placement,
    x: pivot.x + dx * cosine - dy * sine,
    y: pivot.y + dx * sine + dy * cosine,
    rotation: placement.rotation + degrees,
  };
}

/** Mirrors the artwork around a world pivot, including its rotation direction. */
export function flipPlacement(placement: Placement, axis: "x" | "y", pivot: Point): Placement {
  if (axis === "x") {
    return {
      ...placement,
      x: 2 * pivot.x - placement.x,
      scaleX: -placement.scaleX,
      rotation: -placement.rotation,
    };
  }
  return {
    ...placement,
    y: 2 * pivot.y - placement.y,
    scaleY: -placement.scaleY,
    rotation: -placement.rotation,
  };
}

export type AlignMode = "left" | "centerX" | "right" | "bottom" | "centerY" | "top";

/** Aligns each placed rectangle to an edge or center of the target rectangle. */
export function alignPlacedRects(items: PlacedRect[], mode: AlignMode, target: Rect): Array<{ id: string; placement: Placement }> {
  return items.map((item) => {
    const current = transformRect(item.bounds, item.placement);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = target.xMin - current.xMin;
    else if (mode === "centerX") dx = (target.xMin + target.xMax) / 2 - (current.xMin + current.xMax) / 2;
    else if (mode === "right") dx = target.xMax - current.xMax;
    else if (mode === "bottom") dy = target.yMin - current.yMin;
    else if (mode === "centerY") dy = (target.yMin + target.yMax) / 2 - (current.yMin + current.yMax) / 2;
    else dy = target.yMax - current.yMax;
    return { id: item.id, placement: movePlacement(item.placement, dx, dy) };
  });
}

/** Spaces three or more placed rectangles evenly between the outermost centers. */
export function distributePlacedRects(items: PlacedRect[], axis: "x" | "y"): Array<{ id: string; placement: Placement }> {
  if (items.length < 3) return items.map((item) => ({ id: item.id, placement: item.placement }));
  const centers = items.map((item) => {
    const rect = transformRect(item.bounds, item.placement);
    return axis === "x" ? (rect.xMin + rect.xMax) / 2 : (rect.yMin + rect.yMax) / 2;
  });
  const order = items.map((_, index) => index).sort((a, b) => centers[a] - centers[b] || items[a].id.localeCompare(items[b].id));
  const first = centers[order[0]];
  const last = centers[order[order.length - 1]];
  const spacing = (last - first) / (order.length - 1);
  const result = items.map((item) => ({ id: item.id, placement: item.placement }));
  order.forEach((originalIndex, rank) => {
    const current = centers[originalIndex];
    const desired = first + spacing * rank;
    const delta = desired - current;
    result[originalIndex].placement = movePlacement(
      result[originalIndex].placement,
      axis === "x" ? delta : 0,
      axis === "y" ? delta : 0,
    );
  });
  return result;
}
