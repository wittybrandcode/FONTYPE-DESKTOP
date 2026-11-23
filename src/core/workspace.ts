/** Pure font-unit workspace math: viewport transforms, rulers and snapping. */

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

/** Chooses a 1/2/5-style major step so labels stay roughly `targetPx` apart. */
export function majorStepFor(zoom: number, targetPx = 72): number {
  const desired = targetPx / Math.max(zoom, 1e-6);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(desired, 1e-6)));
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * magnitude;
    if (step >= desired) return step;
  }
  return 10 * magnitude;
}

export interface Tick {
  value: number;
  major: boolean;
  label: string;
}

export function rulerTicks(min: number, max: number, major: number, divisions: number): Tick[] {
  const minor = major / Math.max(1, divisions);
  const first = Math.ceil(min / minor - 1e-9);
  const last = Math.floor(max / minor + 1e-9);
  const ticks: Tick[] = [];
  for (let index = first; index <= last; index += 1) {
    const value = index * minor;
    const isMajor = Math.abs(value / major - Math.round(value / major)) < 1e-6;
    const rounded = Math.abs(value - Math.round(value)) < 1e-6 ? String(Math.round(value)) : value.toFixed(2);
    ticks.push({ value, major: isMajor, label: isMajor ? rounded : "" });
  }
  return ticks;
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
  metricValues: Record<string, number | null | undefined>;
  metricLocks: Record<string, boolean>;
  guides: Array<{ guideId: string; orientation: string; positionFU: number; locked: boolean; scope: string; visible: boolean; name?: string }>;
  scope: string;
  visibleRange: Rect;
  majorStep: number;
  divisions: number;
}

/** Builds snap candidates expressed as desired origin coordinates. */
export function collectSnapTargets(input: TargetInput): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const [bxMin, byMin, bxMax, byMax] = input.bounds ?? [0, 0, 0, 0];
  const push = (
    id: string,
    kind: SnapKind,
    priority: number,
    axis: "x" | "y",
    value: number,
    label: string,
    lineValue?: number,
  ) => targets.push({ id, kind, priority, axis, value, lineValue, label });

  // 1. Anchors (filled in Phase 3); reserved priority above all others.
  // 2. Baseline and metric lines. Artwork bottom/top align to the line.
  for (const [key, raw] of Object.entries(input.metricValues)) {
    if (raw === null || raw === undefined) continue;
    const locked = input.metricLocks[key] === true;
    const priority = locked ? 2 : 4;
    push(`metric:${key}:bottom`, "metricLine", priority, "y", raw - byMin * input.scaleY, `${key} ← قاع`, raw);
    push(`metric:${key}:top`, "metricLine", priority, "y", raw - byMax * input.scaleY, `${key} ← قمة`, raw);
    if (key === "baseline") push("origin:y", "outline", 4, "y", 0, "الأصل");
  }

  // 3. Custom guides — project-wide plus guides scoped to this slot.
  for (const guide of input.guides) {
    if (!guide.visible || (guide.scope !== "project" && guide.scope !== input.scope)) continue;
    const priority = guide.locked ? 3 : 4;
    const label = guide.name || guide.guideId;
    if (guide.orientation === "vertical") {
      push(`guide:${guide.guideId}:origin`, "guide", priority, "x", guide.positionFU, label, guide.positionFU);
      push(
        `guide:${guide.guideId}:left`, "guide", priority, "x",
        guide.positionFU - bxMin * input.scaleX, `${label} ← يسار`, guide.positionFU,
      );
      push(
        `guide:${guide.guideId}:right`, "guide", priority, "x",
        guide.positionFU - bxMax * input.scaleX, `${label} ← يمين`, guide.positionFU,
      );
    } else {
      push(`guide:${guide.guideId}:origin`, "guide", priority, "y", guide.positionFU, label, guide.positionFU);
      push(
        `guide:${guide.guideId}:bottom`, "guide", priority, "y",
        guide.positionFU - byMin * input.scaleY, `${label} ← قاع`, guide.positionFU,
      );
      push(
        `guide:${guide.guideId}:top`, "guide", priority, "y",
        guide.positionFU - byMax * input.scaleY, `${label} ← قمة`, guide.positionFU,
      );
    }
  }

  // 4. Outline bounds and extrema relative to the current origin.
  push("outline:xMin", "outline", 4, "x", -bxMin * input.scaleX, "حدود الرسم ← يسار");
  push("outline:xMax", "outline", 4, "x", -bxMax * input.scaleX, "حدود الرسم ← يمين");
  push("outline:yMin", "outline", 4, "y", -byMin * input.scaleY, "حدود الرسم ← قاع");
  push("outline:yMax", "outline", 4, "y", -byMax * input.scaleY, "حدود الرسم ← قمة");

  // 5. Advance and side-bearing boundaries.
  push("advance:origin", "advance", 5, "x", 0, "أصل الخانة");
  push("advance:end", "advance", 5, "x", input.advanceWidth, "نهاية التقدّم");
  push("advance:lsb", "advance", 5, "x", input.leftSideBearing, "الحافة اليسرى");
  push(
    "advance:rsb", "advance", 5, "x",
    input.advanceWidth - input.rightSideBearing, "الحافة اليمنى",
  );

  // 6. Grid intersections are visible-range limited to avoid huge arrays.
  const minor = input.majorStep / Math.max(1, input.divisions);
  const xStart = Math.ceil(input.visibleRange.xMin / minor);
  const xEnd = Math.floor(input.visibleRange.xMax / minor);
  for (let index = xStart; index <= xEnd; index += 1) {
    push(`grid:x:${index}`, "grid", 6, "x", index * minor, "الشبكة");
  }
  const yStart = Math.ceil(input.visibleRange.yMin / minor);
  const yEnd = Math.floor(input.visibleRange.yMax / minor);
  for (let index = yStart; index <= yEnd; index += 1) {
    push(`grid:y:${index}`, "grid", 6, "y", index * minor, "الشبكة");
  }

  return targets;
}
