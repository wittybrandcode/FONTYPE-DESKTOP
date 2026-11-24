import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlyphWorkspace from "./GlyphWorkspace";
import type { ProjectHandle } from "../core/types";

function fixture(): ProjectHandle {
  return {
    path: "D:/projects/sample.afsp",
    migrationNotes: [],
    project: {
      schemaVersion: "0.6",
      projectId: "test",
      font: {
        familyName: "اختبار",
        styleName: "Regular",
        version: "1.000",
        designer: "",
        copyright: "",
        license: "",
        unitsPerEm: 1000,
        characterSetPreset: "arabic-basic",
      },
      metrics: {
        baseline: 0,
        ascender: 800,
        descender: -200,
        capHeight: 700,
        arabicBodyHeight: 500,
        markTopZone: 850,
        markBottomZone: -250,
        metricLocks: {},
        metricVisibility: {},
      },
      workspace: {
        rulersVisible: true,
        gridVisible: true,
        gridMajorStep: 100,
        gridMinorDivisions: 5,
        snapEnabled: true,
        snapTolerancePx: 8,
        snapTargets: {},
        guides: [],
        uiLanguage: "ar",
      },
      shaping: { lamAlefLigatures: false, markPositioning: true, cursivePositioning: true },
      glyphSlots: [
        {
          slotId: "alef-isolated",
          characterName: "ألف",
          unicode: "0627",
          glyphName: "alef.iso",
          form: "isolated",
          joiningType: "R",
          group: "alef",
          markClass: null,
          required: true,
          originalSvg: "alef.svg",
          sourceRevisions: [],
          import: null,
          placement: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          metrics: { advanceWidth: 400, leftSideBearing: 40, rightSideBearing: 40 },
          anchors: [],
          status: "imported",
          approvedAt: null,
          validation: [],
        },
      ],
      builds: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
}

describe("redesigned glyph workspace", () => {
  it("renders the tool rail, floating toolbar, live status strip and accordion inspector", () => {
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={fixture()} onProject={() => {}} onNotice={() => {}} />,
    );
    expect(html).toContain("ws-tool-rail");
    expect(html).toContain('aria-label="أدوات مساحة العمل"');
    expect(html).toContain("ws-canvas-toolbar");
    expect(html).toContain("ws-status-strip");
    expect(html).toContain("خصائص الخانة");
    expect(html).toContain("accordion");
    expect(html).toContain("ألف");
    expect(html).not.toContain("🔒");
    expect(html).not.toContain("✕");
  });

  it("keeps inspector folds in the Transform → Metrics → Anchors → Validation order", () => {
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={fixture()} onProject={() => {}} onNotice={() => {}} />,
    );
    const positions = [
      html.indexOf(">الاستيراد</span>"),
      html.indexOf(">خصائص الخانة</span>"),
      html.indexOf(">خطوط القياس</span>"),
      html.indexOf(">المراسي</span>"),
      html.indexOf(">التحقق</span>"),
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
