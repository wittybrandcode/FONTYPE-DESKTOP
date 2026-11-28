import { describe, expect, it } from "vitest";
import { buildReadiness, requiredAnchorClasses } from "./readiness";
import type { GlyphSlot, ProjectHandle } from "./types";

function slot(overrides: Partial<GlyphSlot> = {}): GlyphSlot {
  return {
    slotId: "beh-initial",
    characterName: "باء",
    unicode: "0628",
    glyphName: "beh-initial",
    form: "initial",
    joiningType: "L",
    group: "بدايات",
    markClass: null,
    required: true,
    originalSvg: "beh.svg",
    sourceRevisions: [],
    import: {
      mode: "fit",
      viewBox: [0, 0, 1000, 1000],
      sourceWidth: 1000,
      sourceHeight: 1000,
      scale: 1,
      matrix: [1, 0, 0, 1, 0, 0],
      sourceFileName: "beh.svg",
      contentHash: "sha256:beh",
      importedAt: "2026-01-01T00:00:00Z",
      contours: 1,
      segments: 4,
      bounds: [0, 0, 400, 600],
      findings: [],
      previewPath: "M0 0 L400 0 L400 600 Z",
    },
    placement: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    metrics: { advanceWidth: 400, leftSideBearing: 0, rightSideBearing: 0 },
    anchors: [{ anchorId: "a1", name: "exit", class: "cursive-exit", x: 300, y: 300, scope: "slot", locked: false, geometryKey: null, needsReview: false, reviewNote: "" }],
    status: "ready",
    approvedAt: null,
    validation: [],
    ...overrides,
  };
}

function handle(overrides: { slots?: GlyphSlot[]; builds?: number; markPositioning?: boolean; cursivePositioning?: boolean } = {}): ProjectHandle {
  return {
    path: "D:/projects/ready.afsp",
    migrationNotes: [],
    project: {
      schemaVersion: "0.6",
      projectId: "readiness-test",
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
        baseline: 0, ascender: 800, descender: -200, capHeight: 700,
        arabicBodyHeight: 500, markTopZone: 850, markBottomZone: -250,
        metricLocks: {}, metricVisibility: {},
      },
      workspace: {
        rulersVisible: true, gridVisible: true, gridMajorStep: 100, gridMinorDivisions: 5,
        snapEnabled: true, snapTolerancePx: 8, snapTargets: {}, guides: [], uiLanguage: "ar",
      },
      shaping: {
        lamAlefLigatures: false,
        markPositioning: overrides.markPositioning ?? true,
        cursivePositioning: overrides.cursivePositioning ?? true,
      },
      glyphSlots: overrides.slots ?? [slot()],
      builds: Array.from({ length: overrides.builds ?? 1 }, (_, index) => ({
        buildId: `b${index}`,
        timestamp: "2026-01-01T00:00:00Z",
        appVersion: "0.6.0",
        toolchainVersions: {},
        requestedFormats: ["otf", "ttf"],
        result: "ok",
        compilerLogPath: "",
        validationReportPath: "",
        outputPaths: { otf: "D:/out/font.otf", ttf: "D:/out/font.ttf" },
        projectHash: "hash",
      })),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
}

describe("professional readiness gate", () => {
  it("is blocked when no project is open", () => {
    const report = buildReadiness(null);
    expect(report.level).toBe("blocked");
    expect(report.canBuild).toBe(false);
    expect(report.blockers).toBe(1);
  });

  it("reports ready for a complete project without writing new fields", () => {
    const report = buildReadiness(handle());
    expect(report.level).toBe("ready");
    expect(report.canBuild).toBe(true);
    expect(report.blockers).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.checks).toHaveLength(7);
  });

  it("blocks a required slot with no import", () => {
    const report = buildReadiness(handle({ slots: [slot({ import: null })] }));
    expect(report.canBuild).toBe(false);
    expect(report.checks.find((item) => item.id === "coverage")?.ok).toBe(false);
    expect(report.checks.find((item) => item.id === "coverage")?.slotId).toBe("beh-initial");
  });

  it("blocks error-level import findings", () => {
    const bad = slot();
    bad.import!.findings = [{ severity: "error", code: "UNSUPPORTED_IMAGE", slotId: bad.slotId, message: "صورة غير مدعومة", hint: "" }];
    const report = buildReadiness(handle({ slots: [bad] }));
    expect(report.canBuild).toBe(false);
    expect(report.checks.find((item) => item.id === "geometry")?.detail).toContain("UNSUPPORTED_IMAGE");
  });

  it("blocks a slot that still needs anchor review", () => {
    const base = slot();
    const pending = slot({
      status: "needs-review",
      anchors: [{ ...base.anchors[0], needsReview: true }],
    });
    const report = buildReadiness(handle({ slots: [pending] }));
    expect(report.canBuild).toBe(false);
    expect(report.checks.find((item) => item.id === "validation")?.ok).toBe(false);
    expect(report.checks.find((item) => item.id === "anchors")?.detail).toContain("مراجعة");
  });

  it("treats disabled Arabic shaping as a warning rather than a blocker", () => {
    const report = buildReadiness(handle({ markPositioning: false, cursivePositioning: false, builds: 0 }));
    expect(report.level).toBe("attention");
    expect(report.canBuild).toBe(true);
    expect(report.warnings).toBe(2);
  });

  it("derives required anchors from the joining form and mark class", () => {
    expect(requiredAnchorClasses(slot({ form: "initial" }))).toEqual(["cursive-exit"]);
    expect(requiredAnchorClasses(slot({ form: "medial" }))).toEqual(["cursive-entry", "cursive-exit"]);
    expect(requiredAnchorClasses(slot({ form: "isolated", markClass: "top" }))).toEqual(["top"]);
  });
});
