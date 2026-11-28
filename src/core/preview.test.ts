import { describe, expect, it } from "vitest";
import { FORM_ORDER, formSequence, highlightSlotGlyphs, onionForms, previewSummary } from "./preview";
import type { GlyphSlot } from "./types";

function slot(form: string, withImport = true): GlyphSlot {
  return {
    slotId: `alef-${form}`,
    characterName: "ألف",
    unicode: "0627",
    glyphName: `alef.${form}`,
    form,
    joiningType: "R",
    group: "alef",
    markClass: null,
    required: true,
    originalSvg: withImport ? "alef.svg" : null,
    sourceRevisions: [],
    import: withImport ? {
      mode: "fit", viewBox: [0, 0, 100, 400], sourceWidth: 100, sourceHeight: 400, scale: 1,
      matrix: [1, 0, 0, 1, 0, 0], sourceFileName: "alef.svg", contentHash: "sha256:x",
      importedAt: "2026-01-01T00:00:00Z", contours: 1, segments: 4, bounds: [0, 0, 100, 400],
      findings: [], previewPath: "M0 0 L100 0 L100 400 Z",
    } : null,
    placement: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    metrics: { advanceWidth: 400, leftSideBearing: 0, rightSideBearing: 0 },
    anchors: [], status: "imported", approvedAt: null, validation: [],
  };
}

const slots = [slot("final"), slot("isolated"), slot("medial"), slot("initial"), slot("isolated", false)];

describe("M5 comparison and preview", () => {
  it("keeps four fixed form cells and fills gaps", () => {
    const sequence = formSequence(slots, slots[1]);
    expect(sequence.map((entry) => entry.form)).toEqual([...FORM_ORDER]);
    expect(sequence.every((entry) => entry.label.length > 0)).toBe(true);
    expect(sequence.map((entry) => entry.slot?.slotId)).toEqual([
      "alef-isolated", "alef-initial", "alef-medial", "alef-final",
    ]);
  });

  it("uses imported neighbours for onion skin", () => {
    expect(onionForms(slots, slots[2]).previous?.form).toBe("initial");
    expect(onionForms(slots, slots[2]).next?.form).toBe("final");
    expect(onionForms(slots, slots[0]).next).toBeNull();
  });

  it("highlights only glyphs produced by the edited slot", () => {
    const modes = [{ mode: "word", glyphs: [
      { name: "alef.iso", slotId: "alef-isolated" },
      { name: "seen.ini", slotId: "seen-initial" },
      { name: "alef.fin", slotId: "alef-isolated" },
    ] }];
    expect(highlightSlotGlyphs(modes, "alef-isolated")).toHaveLength(2);
    expect(highlightSlotGlyphs(modes, "alef-final")).toHaveLength(0);
    expect(previewSummary(modes)).toBe("3 حرف من التشكيل");
  });
});
