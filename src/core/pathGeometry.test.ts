import { describe, expect, it } from "vitest";
import {
  findNode,
  parsePathModel,
  pathModelBounds,
  pathModelCounts,
  reverseContour,
  serializePathModel,
  simplifyPath,
  splitSubpaths,
  subpathTransform,
  translateHandle,
  translateNode,
} from "./pathGeometry";

describe("M3أ display-only subpaths", () => {
  it("splits an imported path at moveto commands", () => {
    const parts = splitSubpaths("M10 20 C30 0 70 0 90 20 Z M120 20 L160 60 L120 60 Z");
    expect(parts).toHaveLength(2);
    expect(parts[0].d).toContain("M10 20");
    expect(parts[1].d).toContain("M120 20");
    expect(parts[0].curveCount).toBe(1);
    expect(parts[0].closed).toBe(true);
    expect(parts[1].pointCount).toBe(3);
  });

  it("normalises a relative moveto without touching the saved path", () => {
    const parts = splitSubpaths("M10 10 L20 20 Z m5 5 l10 10 z");
    expect(parts[1].d.startsWith("M15 15")).toBe(true);
    expect(parts[1].closed).toBe(true);
  });

  it("returns no segments for an empty path and only visual offsets", () => {
    expect(splitSubpaths("  ")).toEqual([]);
    expect(subpathTransform(4, -3)).toBe("translate(4 -3)");
  });
});

describe("M3ب Bezier path model", () => {
  const path = "M10 20 C30 0 70 0 90 20 Q110 40 130 20 L140 60 Z";

  it("parses absolute commands into stable node ids", () => {
    const model = parsePathModel(path);
    expect(model.contours).toHaveLength(1);
    expect(model.contours[0].nodes.map((node) => node.id)).toEqual([
      "c0-n0", "c0-n1", "c0-n2", "c0-n3",
    ]);
    expect(model.contours[0].nodes.map((node) => node.command)).toEqual(["M", "C", "Q", "L"]);
    expect(model.contours[0].closed).toBe(true);
    expect(findNode(model, "c0-n1")?.in).toEqual({ x: 70, y: 0 });
    expect(model.contours[0].nodes[0].out).toEqual({ x: 30, y: 0 });
  });

  it("roundtrips the path through serialization without changing counts", () => {
    const model = parsePathModel(path);
    const restored = parsePathModel(serializePathModel(model));
    expect(pathModelCounts(restored)).toEqual(pathModelCounts(model));
    expect(restored.contours[0].nodes.map((node) => [node.x, node.y])).toEqual(
      model.contours[0].nodes.map((node) => [node.x, node.y]),
    );
  });

  it("moves an anchor together with its handles", () => {
    const moved = translateNode(parsePathModel(path), "c0-n1", 10, -5);
    const node = findNode(moved, "c0-n1");
    expect(node?.x).toBe(100);
    expect(node?.y).toBe(15);
    expect(node?.in).toEqual({ x: 80, y: -5 });
  });

  it("moves a single control handle without moving the anchor", () => {
    const moved = translateHandle(parsePathModel(path), "c0-n0-out", 5, 5);
    expect(moved.contours[0].nodes[0]).toMatchObject({ x: 10, y: 20, out: { x: 35, y: 5 } });
  });

  it("reverses a contour and swaps its control points", () => {
    const reversed = reverseContour(parsePathModel(path), "c0");
    const nodes = reversed.contours[0].nodes;
    expect(nodes[0]).toMatchObject({ command: "M", x: 140, y: 60 });
    expect(nodes[1]).toMatchObject({ x: 130, y: 20 });
    expect(parsePathModel(serializePathModel(reversed)).contours[0].closed).toBe(true);
  });

  it("removes redundant collinear line nodes but keeps curves", () => {
    const model = parsePathModel("M0 0 L10 0 L20 0 C30 0 40 0 50 0 Z");
    const simplified = simplifyPath(model, 0.5);
    expect(simplified.contours[0].nodes).toHaveLength(2);
    expect(simplified.contours[0].nodes[1].command).toBe("C");
    expect(simplified.contours[0].nodes[0].out).toEqual({ x: 30, y: 0 });
  });

  it("derives bounds and counts from the model", () => {
    const model = parsePathModel(path);
    expect(pathModelCounts(model)).toEqual({ contours: 1, segments: 4 });
    expect(pathModelBounds(model)).toEqual([10, 0, 140, 60]);
  });

  it("converts smooth and orthogonal commands to explicit controls", () => {
    const model = parsePathModel("M0 0 C10 0 20 0 30 0 S50 0 60 0 Q70 10 80 0 T100 0 H120 V30 L120 0 Z");
    const nodes = model.contours[0].nodes;
    expect(nodes[2].command).toBe("C");
    expect(nodes[4].command).toBe("Q");
    expect(nodes[nodes.length - 1].x).toBe(120);
    expect(serializePathModel(model)).toContain("C40 0 50 0 60 0");
  });
});
