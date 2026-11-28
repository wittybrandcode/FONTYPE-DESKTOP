# Project Data Model

## 1. Goals

The data model must preserve each glyph slot's identity independently of the source SVG filename. It must separate source artwork, normalized geometry, positioning, metrics, anchors, shaping relationships, and compiled outputs.

## 2. Project folder

```text
MyArabicFont.afsp/
├── project.json
├── glyphs/
│   ├── beh/
│   │   ├── isolated.svg
│   │   ├── initial.svg
│   │   ├── medial.svg
│   │   └── final.svg
│   └── ...
├── normalized/
├── reports/
└── output/
```

## 3. Example project metadata

```json
{
  "schemaVersion": "0.1.0",
  "projectId": "project_uuid",
  "font": {
    "familyName": "My Arabic Typeface",
    "styleName": "Regular",
    "version": "1.000",
    "designer": "",
    "copyright": "",
    "license": "",
    "unitsPerEm": 1000,
    "characterSetPreset": "arabic-core"
  },
  "metrics": {
    "baseline": 0,
    "ascender": 800,
    "descender": -250,
    "capHeight": 700,
    "arabicBodyHeight": null,
    "markTopZone": 850,
    "markBottomZone": -350
  },
  "workspace": {
    "rulersVisible": true,
    "gridVisible": false,
    "gridMajorStep": 100,
    "gridMinorDivisions": 5,
    "snapEnabled": true,
    "snapTolerancePx": 8,
    "snapTargets": {
      "grid": false,
      "metricLines": true,
      "guides": true,
      "glyphBounds": true,
      "advanceBoundaries": true,
      "outlineNodes": true,
      "anchors": true
    }
  },
  "glyphSlots": []
}
```

Metric values above are illustrative defaults only. The project wizard should explain that font metrics are design choices and must be reviewed for the intended family and line spacing.

## 4. Glyph slot record

```json
{
  "slotId": "beh.initial",
  "characterName": "Beh",
  "unicode": "U+0628",
  "glyphName": "beh.init",
  "form": "initial",
  "joiningType": "D",
  "required": true,
  "originalSvg": "glyphs/beh/initial.svg",
  "sourceRevisions": [],
  "import": {
    "mode": "fit_to_em",
    "viewBox": [0, 0, 1000, 1000],
    "sourceWidth": 1000,
    "sourceHeight": 1000,
    "scale": 1,
    "matrix": [1, 0, 0, 1, 0, 0],
    "sourceFileName": "my-drawing.svg",
    "contentHash": "sha256:...",
    "importedAt": "2026-01-01T12:00:00Z",
    "contours": 1,
    "segments": 8,
    "bounds": [40, 0, 660, 700],
    "findings": [],
    "previewPath": "M40 0 ... Z"
  },
  "placement": {
    "x": 0,
    "y": 0,
    "scaleX": 1,
    "scaleY": 1,
    "rotation": 0
  },
  "metrics": {
    "advanceWidth": 620,
    "leftSideBearing": 40,
    "rightSideBearing": 35
  },
  "anchors": [
    { "name": "top", "x": 280, "y": 420, "class": "top" },
    { "name": "bottom", "x": 280, "y": 80, "class": "bottom" },
    { "name": "entry", "x": 30, "y": 180, "class": "cursive-entry" },
    { "name": "exit", "x": 580, "y": 180, "class": "cursive-exit" }
  ],
  "status": "needs-review",
  "validation": []
}
```

The record is illustrative. The exact joining role and which anchors apply must come from the character and form definitions, not from a fixed template applied to every glyph.

## 5. Core entities

### Project

- `projectId`: stable unique ID.
- `schemaVersion`: migration control.
- `font`: naming and export metadata.
- `metrics`: global vertical metrics and design reference guides.
- `workspace`: user preferences for the canvas.
- `glyphSlots`: collection of slot records.
- `builds`: history of build attempts and outputs.

### Glyph Slot

- `slotId`: stable application identity, e.g. `beh.initial`.
- `unicode`: base Unicode codepoint where applicable; forms may share the same base codepoint.
- `glyphName`: internal font glyph name.
- `form`: isolated/initial/medial/final/base/mark/ligature/alternate.
- `joiningType`: Unicode-derived joining classification where applicable.
- `originalSvg`: retained source artwork inside the project folder.
- `import`: normalized geometry, preview path, bounds, counts, hash and findings.
- `placement`: transform applied to normalized source geometry.
- `metrics`: advance width and side bearings.
- `anchors`: named attachment points.
- `status`: derived workflow state.
- `validation`: current findings.

### Guide

- `guideId`, `orientation`, `positionFU`, `scope`, `locked`, `visible`, `name`.
- `scope` is `project` or a specific glyph slot.

### Anchor

- `anchorId`, `name`, `class`, `x`, `y`, `scope`, `locked`.
- Coordinates are font units in glyph space.

### Build Record

- `buildId`, timestamp, application version, toolchain versions, requested formats, result, compiler log path, validation report path, output paths, and source project revision/hash.

## 6. Status derivation

- `empty`: no source artwork exists.
- `imported`: SVG parsed and normalized successfully, but placement/review is incomplete.
- `needs-review`: warnings or user review remain.
- `ready`: required geometry, metrics, anchors, and validation checks meet the current preset's requirements.
- `error`: source or geometry cannot be used.

Status must be recalculated when artwork, metrics, anchors, or project settings change.

## 7. Data integrity rules

- Slot IDs are stable across replace operations.
- Original SVG is retained unchanged.
- Normalized geometry can be regenerated from the original SVG and import settings.
- Metrics and anchors are separate from the source SVG.
- Every build references a specific project revision.
- Missing glyphs are represented as missing slots, not silently omitted from the inventory.
- Unicode codepoints must be stored as strings in a canonical form such as `U+0628` to avoid numeric serialization ambiguity.

## 8. Phase 9 / `DATA-GATE` invariant

Phase 9 M3ب adds Bezier node editing **without changing the project schema**:

- Node/handle identities such as `c0-n2` are derived at runtime from the order of commands in the existing `previewPath`. No `pathModel`, `contourIds`, `pointIds` or command arrays are persisted.
- `set_preview_path` writes only the existing `import` fields `previewPath`, `bounds`, `contours` and `segments`.
- `originalSvg`, `sourceFileName`, `contentHash`, `importedAt`, `sourceRevisions`, `placement`, `metrics`, `anchors` and global settings are untouched.
- An approval edit resets `approvedAt` and flags geometry-dependent anchors for review; the source artwork and hash remain the audit trail.
- `import::tests::preview_path_edit_roundtrips_without_schema_changes` opens a legacy project, verifies the absence of new fields, edits the path, reopens it and confirms the invariants above.
- `samples/sample-alef.afsp/` is a bundled schema-`0.1.0` example with one ready slot, a clean import and an SVG copy; `bundled_sample_project_loads` verifies it can be opened without migration notes.
