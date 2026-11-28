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

function importedFixture(): ProjectHandle {
  const handle = fixture();
  const slot = handle.project.glyphSlots[0];
  const importInfo = {
    mode: "fit",
    viewBox: [0, 0, 100, 400] as [number, number, number, number],
    sourceWidth: 100,
    sourceHeight: 400,
    scale: 1,
    matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    sourceFileName: "alef.svg",
    contentHash: "sha256:test",
    importedAt: "2026-01-02T00:00:00Z",
    contours: 1,
    segments: 4,
    bounds: [80, 0, 320, 400] as [number, number, number, number],
    findings: [],
    previewPath: "M80 0 L320 0 L320 400 L80 400 Z",
  };
  slot.import = importInfo;
  handle.project.glyphSlots.push({
    ...slot,
    slotId: "alef-final",
    glyphName: "alef.fin",
    form: "final",
    placement: { x: 440, y: -10, scaleX: 0.9, scaleY: 0.9, rotation: 4 },
    import: { ...importInfo, bounds: [0, 0, 240, 360] },
  });
  return handle;
}

describe("redesigned glyph workspace", () => {
  it("renders the tool rail, floating toolbar, live status strip and accordion inspector", () => {
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={fixture()} onProject={() => {}} onNotice={() => {}} />,
    );
    expect(html).toContain("ws-tool-rail");
    expect(html).toContain('aria-label="أدوات مساحة العمل"');
    expect(html).toContain("ws-canvas-toolbar");
    expect(html).toContain("data-svg-import");
    expect(html).toContain("استيراد SVG");
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

  it("renders the phase 9 selection box, transform fields and navigation minimap", () => {
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={importedFixture()} onProject={() => {}} onNotice={() => {}} />,
    );
    expect(html).toContain("ws-transform-box");
    expect(html).toContain("ws-transform-handle");
    expect(html).toContain("ws-transform-rotate");
    expect(html).toContain("canvas-transform-bar");
    expect(html).toContain("مقياس X");
    expect(html).toContain("دوران");
    expect(html).toContain("ws-minimap");
    expect(html).toContain("mini-viewport");
    expect(html).toContain("canvas-view-label");
    expect(html).toContain("تحديد: 1");
    expect(html).not.toContain("ws-marquee");
  });

  it("renders the four-form strip and live-preview entry point on the canvas", () => {
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={importedFixture()} onProject={() => {}} onNotice={() => {}} />,
    );
    expect(html).toContain("data-form-compare");
    expect(html).toContain("مقارنة الأشكال الأربعة");
    for (const label of ["مفرد", "بدائي", "وسيط", "نهائي"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).toContain("المعاينة الحيّة");
    expect(html).toContain("الشكل الشبحي (onion skin)");
  });

  it("keeps the slot fold order while exposing contextual inspector tabs", () => {
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={importedFixture()} onProject={() => {}} onNotice={() => {}} />,
    );
    expect(html).toContain('aria-label="سياق المفتش"');
    expect(html).toContain(">الخانة</button>");
    expect(html).toContain(">المراسي</button>");
    expect(html).toContain(">المسار</button>");
    expect(html).toContain(">المعاينة</button>");
    expect(html).toContain("التخطيط");
  });

  it("turns validation findings into fix-now actions", () => {
    const handle = importedFixture();
    handle.project.glyphSlots[0].import!.findings = [{
      severity: "warning",
      code: "BAD_VIEWBOX",
      slotId: "alef-isolated",
      message: "viewBox غير صالح",
      hint: "أعد استيراد الملف بعد ضبط الأبعاد.",
    }];
    const html = renderToStaticMarkup(
      <GlyphWorkspace project={handle} onProject={() => {}} onNotice={() => {}} />,
    );
    expect(html).toContain("BAD_VIEWBOX");
    expect(html).toContain("إصلح الآن");
  });
});
