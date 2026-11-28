import { describe, expect, it } from "vitest";
import { buildSvgInspectionParams, inspectionModeFor } from "./svgImport";

describe("SVG import params", () => {
  const options = { upm: 1000, advanceWidth: 600 };

  it("uses the existing single-file inspection contract", () => {
    const { params, mode } = buildSvgInspectionParams(["alef.svg"], options, "fit_to_em");
    expect(mode).toBe("fit_to_em");
    expect(params.svgPath).toBe("alef.svg");
    expect(params.svgPaths).toBeUndefined();
    expect(params.mode).toBe("fit_to_em");
    expect(params.advanceWidth).toBe(600);
  });

  it("sends multiple files as one composite inspection", () => {
    const { params, mode } = buildSvgInspectionParams(
      ["alef-main.svg", "alef-dot.svg"],
      options,
      "fit_to_em",
    );
    expect(mode).toBe("preserve_size");
    expect(params.svgPaths).toEqual(["alef-main.svg", "alef-dot.svg"]);
    expect(params.svgPath).toBeUndefined();
    expect(params.mode).toBe("preserve_size");
  });

  it("rejects an empty selection", () => {
    expect(() => buildSvgInspectionParams([], options)).toThrow();
    expect(inspectionModeFor(3)).toBe("preserve_size");
  });
});
