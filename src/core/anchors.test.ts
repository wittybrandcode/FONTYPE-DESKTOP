import { describe, expect, it } from "vitest";
import {
  ANCHOR_CLASSES,
  anchorClassInfo,
  areCompatible,
  collectAnchorSnapTargets,
  compatibleClasses,
  compatiblePairs,
  compatibilityCount,
} from "./anchors";
import type { Anchor } from "./types";

function anchor(id: string, name: string, klass: string, x = 0, y = 0): Anchor {
  return {
    anchorId: id,
    name,
    class: klass,
    x,
    y,
    scope: "beh.initial",
    locked: false,
    geometryKey: null,
    needsReview: false,
    reviewNote: "",
  };
}

describe("anchor compatibility", () => {
  it("pairs mark and base classes by attachment role", () => {
    expect(compatibleClasses("top")).toEqual(["top-mark"]);
    expect(compatibleClasses("top-mark")).toEqual(["top"]);
    expect(compatibleClasses("cursive-entry")).toEqual(["cursive-exit"]);
    expect(areCompatible(anchor("1", "top", "top"), anchor("2", "top-mark", "top-mark"))).toBe(true);
    expect(areCompatible(anchor("1", "top", "top"), anchor("2", "bottom", "bottom"))).toBe(false);
  });

  it("never treats an anchor as compatible with itself", () => {
    const item = anchor("1", "top", "top");
    expect(areCompatible(item, item)).toBe(false);
  });

  it("lists compatible pairs and cross-slot matches", () => {
    const items = [
      anchor("1", "top", "top"),
      anchor("2", "top-mark", "top-mark"),
      anchor("3", "entry", "cursive-entry"),
    ];
    expect(compatiblePairs(items)).toEqual([[items[0], items[1]]]);
    expect(compatibilityCount(items[0], items)).toBe(1);
    expect(compatibilityCount(items[2], items)).toBe(0);
  });

  it("exposes a visual symbol and label for every class", () => {
    for (const [name, info] of Object.entries(ANCHOR_CLASSES)) {
      expect(info.symbol.length).toBeGreaterThan(0);
      expect(info.label.length).toBeGreaterThan(0);
      expect(anchorClassInfo(name)).toEqual(info);
    }
    expect(anchorClassInfo("custom").symbol).toBe("•");
  });

  it("generates x and y snap targets without the dragged anchor", () => {
    const items = [anchor("1", "top", "top", 220, 400), anchor("2", "entry", "cursive-entry", 30, 180)];
    const targets = collectAnchorSnapTargets(items, "1");
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.axis)).toEqual(["x", "y"]);
    expect(targets[0].value).toBe(30);
    expect(targets[1].value).toBe(180);
    expect(targets.every((target) => target.kind === "anchor")).toBe(true);
  });
});
