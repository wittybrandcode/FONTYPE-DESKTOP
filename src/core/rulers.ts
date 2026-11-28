/** R1 — adaptive ruler scale in font units, independent of the React canvas. */

import type { Rect, Viewport } from "./workspace";

/** Font-unit steps that stay readable across the supported zoom range. */
export const RULER_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const;

/** CSS thickness of both rulers; SVG attributes must match it or ticks drift. */
export const RULER_THICKNESS = 20;
/** Minimum on-screen distance between two labelled ticks. */
export const RULER_LABEL_TARGET_PX = 64;

export interface RulerScale {
  /** Font units between labelled ticks. */
  major: number;
  /** Font units between drawn ticks. */
  minor: number;
  /** Number of minor divisions inside one major step. */
  divisions: number;
}

export interface RulerTick {
  value: number;
  major: boolean;
  label: string;
}

/**
 * Picks the smallest canonical step whose on-screen label spacing is at least
 * `targetPx`. Minor ticks are only drawn when they remain individually visible.
 */
export function rulerScaleFor(zoom: number, targetPx = RULER_LABEL_TARGET_PX): RulerScale {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const safeTarget = Number.isFinite(targetPx) && targetPx > 0 ? targetPx : RULER_LABEL_TARGET_PX;
  const major = RULER_STEPS.find((step) => step * safeZoom >= safeTarget) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const divisions = major / 5 >= 1 && (major / 5) * safeZoom >= 8 ? 5 : major / 2 >= 1 && (major / 2) * safeZoom >= 12 ? 2 : 1;
  return { major, minor: major / divisions, divisions };
}

/** Quantises a font coordinate onto the nearest drawn ruler tick. */
export function nearestRulerTick(
  value: number,
  scale: RulerScale,
  step: "minor" | "major" = "minor",
): number {
  const size = step === "major" ? scale.major : scale.minor;
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return value;
  return Math.round(value / size) * size;
}

/** Half-pixel alignment keeps 1px SVG strokes crisp at every zoom. */
export function crispPixel(value: number): number {
  return Number.isFinite(value) ? Math.round(value) + 0.5 : 0;
}

/** Formats a font-unit label without floating point noise or trailing zeros. */
export function formatRulerLabel(value: number): string {
  const rounded = Math.abs(value - Math.round(value)) < 1e-6 ? Math.round(value) : Number(value.toFixed(2));
  return String(rounded);
}

/** Ticks inside `[min, max]`; labels exist only on major ticks, so they never overlap. */
export function rulerTicksFor(min: number, max: number, scale: RulerScale): RulerTick[] {
  const first = Math.ceil(min / scale.minor - 1e-9);
  const last = Math.floor(max / scale.minor + 1e-9);
  const ticks: RulerTick[] = [];
  for (let index = first; index <= last; index += 1) {
    const value = index * scale.minor;
    const major = Math.abs(value / scale.major - Math.round(value / scale.major)) < 1e-6;
    ticks.push({ value, major, label: major ? formatRulerLabel(value) : "" });
  }
  return ticks;
}

/** World-space extent of a canvas in CSS pixels, with font Y growing upward. */
export function viewportRange(viewport: Viewport, width: number, height: number): Rect {
  return {
    xMin: (0 - viewport.x) / viewport.zoom,
    xMax: (width - viewport.x) / viewport.zoom,
    yMin: (viewport.y - height) / viewport.zoom,
    yMax: viewport.y / viewport.zoom,
  };
}

export interface RulerView {
  scale: RulerScale;
  xTicks: RulerTick[];
  yTicks: RulerTick[];
  range: Rect;
}

/** One call builds both axes from the same viewport so pan and zoom stay in sync. */
export function rulerView(viewport: Viewport, width: number, height: number, targetPx = RULER_LABEL_TARGET_PX): RulerView {
  const range = viewportRange(viewport, width, height);
  const scale = rulerScaleFor(viewport.zoom, targetPx);
  return {
    scale,
    range,
    xTicks: rulerTicksFor(range.xMin, range.xMax, scale),
    yTicks: rulerTicksFor(range.yMin, range.yMax, scale),
  };
}
