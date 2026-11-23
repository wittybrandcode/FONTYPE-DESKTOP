/** Pure anchor contracts and compatibility helpers for Phase 3. */

import type { SnapTarget } from "./workspace";
import type { Anchor } from "./types";

export interface AnchorClassInfo {
  label: string;
  symbol: string;
  color: string;
  /** Classes this anchor can attach to or receive. */
  compatible: string[];
}

export const ANCHOR_CLASSES: Record<string, AnchorClassInfo> = {
  top: { label: "علوي", symbol: "▲", color: "#4cc2a5", compatible: ["top-mark"] },
  bottom: { label: "سفلي", symbol: "▼", color: "#5b9bd5", compatible: ["bottom-mark"] },
  "cursive-entry": { label: "دخول الوصل", symbol: "›", color: "#e3b341", compatible: ["cursive-exit"] },
  "cursive-exit": { label: "خروج الوصل", symbol: "‹", color: "#e3b341", compatible: ["cursive-entry"] },
  "top-mark": { label: "ارتباط حركة علوية", symbol: "◆", color: "#d98cc8", compatible: ["top"] },
  "bottom-mark": { label: "ارتباط حركة سفلية", symbol: "◇", color: "#a78bfa", compatible: ["bottom"] },
};

export const ANCHOR_CLASS_OPTIONS = Object.entries(ANCHOR_CLASSES).map(([value, info]) => ({
  value,
  label: `${info.symbol} ${info.label}`,
}));

export function anchorClassInfo(name: string): AnchorClassInfo {
  return ANCHOR_CLASSES[name] ?? {
    label: name || "مخصص",
    symbol: "•",
    color: "#9aa9bd",
    compatible: [],
  };
}

export function compatibleClasses(name: string): string[] {
  return anchorClassInfo(name).compatible;
}

export function areCompatible(a: Anchor, b: Anchor): boolean {
  return a.anchorId !== b.anchorId && compatibleClasses(a.class).includes(b.class);
}

/** Compatible anchor pairs, used for dashed connection previews in one slot. */
export function compatiblePairs(anchors: Anchor[]): Array<[Anchor, Anchor]> {
  const pairs: Array<[Anchor, Anchor]> = [];
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      if (areCompatible(anchors[i], anchors[j])) pairs.push([anchors[i], anchors[j]]);
    }
  }
  return pairs;
}

/** Counts compatible anchors in other slots (or an explicit pool). */
export function compatibilityCount(anchor: Anchor, pool: Anchor[]): number {
  return pool.filter((candidate) => areCompatible(anchor, candidate)).length;
}

/** Snap candidates that align an anchor point to existing anchor points. */
export function collectAnchorSnapTargets(anchors: Anchor[], excludeId?: string): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const anchor of anchors) {
    if (anchor.anchorId === excludeId) continue;
    targets.push({
      id: `anchor:${anchor.anchorId}`,
      kind: "anchor",
      priority: 1,
      axis: "x",
      value: anchor.x,
      lineValue: anchor.x,
      label: `مرساة ${anchor.name} (X)`,
    });
    targets.push({
      id: `anchor:${anchor.anchorId}`,
      kind: "anchor",
      priority: 1,
      axis: "y",
      value: anchor.y,
      lineValue: anchor.y,
      label: `مرساة ${anchor.name} (Y)`,
    });
  }
  return targets;
}

/** Review state shown as a badge next to the anchor name. */
export function anchorReviewLabel(anchor: Anchor): string | null {
  return anchor.needsReview ? anchor.reviewNote || "تحتاج مراجعة" : null;
}
