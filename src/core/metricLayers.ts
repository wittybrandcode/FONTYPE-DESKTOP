/** M4 — metric and side-bearing layers derived from existing project fields only. */

import type { GlobalMetrics, GlyphSlot } from "./types";

export interface MetricLayer {
  key: string;
  label: string;
  value: number;
  axis: "x" | "y";
  locked: boolean;
  source: "global" | "slot";
}

const GLOBAL_ROWS: Array<[keyof GlobalMetrics, string]> = [
  ["baseline", "خط الأساس"],
  ["ascender", "الصاعد"],
  ["descender", "الهابط"],
  ["capHeight", "ارتفاع الحرف الكبير"],
  ["arabicBodyHeight", "ارتفاع جسم العربي"],
  ["markTopZone", "منطقة العلامات العليا"],
  ["markBottomZone", "منطقة العلامات السفلى"],
];

/** Only visible, non-null global metric lines become canvas layers. */
export function metricLayers(metrics: GlobalMetrics): MetricLayer[] {
  return GLOBAL_ROWS.flatMap(([key, label]) => {
    const value = metrics[key];
    if (typeof value !== "number") return [];
    if (metrics.metricVisibility[key] === false) return [];
    return [{
      key: String(key),
      label,
      value,
      axis: "y" as const,
      locked: metrics.metricLocks[String(key)] === true,
      source: "global" as const,
    }];
  });
}

/** Advance and side-bearing boundaries belong to the selected slot, not to global metrics. */
export function sideBearingLayers(slot: GlyphSlot | null): MetricLayer[] {
  if (!slot) return [];
  const { advanceWidth, leftSideBearing, rightSideBearing } = slot.metrics;
  return [
    { key: "advance:start", label: "أصل التقدّم", value: 0, axis: "x", locked: false, source: "slot" },
    { key: "lsb", label: "الحافة اليسرى", value: leftSideBearing, axis: "x", locked: false, source: "slot" },
    { key: "rsb", label: "الحافة اليمنى", value: advanceWidth - rightSideBearing, axis: "x", locked: false, source: "slot" },
    { key: "advance:end", label: "نهاية التقدّم", value: advanceWidth, axis: "x", locked: false, source: "slot" },
  ];
}

/** Short readout for the canvas legend; null metrics are shown as a dash. */
export function metricReadout(metrics: GlobalMetrics, keys: string[]): string {
  return keys
    .map((key) => {
      const value = metrics[key as keyof GlobalMetrics];
      return `${key}: ${typeof value === "number" ? value : "—"}`;
    })
    .join(" · ");
}
