# Product & Interaction Design Specification

## 1. Experience model

The interface is organized around three persistent work areas:

1. **Glyph Inventory:** the complete character set and its dedicated import slots.
2. **Glyph Workspace:** the font-aware drawing-placement canvas for the selected slot.
3. **Preview & Build:** real-text testing, quality checks, and font export.

The default experience is designer-centric. Technical terms may appear in tooltips or an advanced panel, but routine tasks use plain language such as “Baseline”, “Top Mark”, “Spacing”, and “Connects to next”.

## 2. Main application layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Project / Font Family       Undo  Redo  Save      Preview      Build Font   │
├───────────────────┬──────────────────────────────────────┬─────────────────┤
│ GLYPH INVENTORY   │ GLYPH WORKSPACE                      │ PROPERTIES      │
│ Search / Filters  │                                      │                 │
│                   │  vertical ruler                      │ Import SVG      │
│ [ا] [ب] [ت] [ث]  │  ┌───────────────────────────────┐   │ Metrics         │
│ [ج] [ح] [خ] [د]  │  │ Ascender / reference guides   │   │ Position        │
│                   │  │                               │   │ Scale           │
│ Beh               │  │       imported outline        │   │ Advance width   │
│  Isolated         │  │                               │   │ Side bearings   │
│  Initial          │  │ - - - Arabic height guide     │   │ Anchors         │
│  Medial           │  │ ───── Baseline                 │   │                 │
│  Final            │  └───────────────────────────────┘   │ Validation      │
│                   │  horizontal ruler                    │                 │
├───────────────────┴──────────────────────────────────────┴─────────────────┤
│ Context bar: Snap · Grid · Guides · Units · Zoom · View · Preview          │
└────────────────────────────────────────────────────────────────────────────┘
```

The user can collapse the inventory or properties panel to give the workspace more room. The workspace must support high-DPI displays and scalable panel widths.

## 3. Glyph slot card

Each slot displays:

- The rendered glyph preview, when available.
- Character/name, e.g. Beh.
- Form label: Isolated, Initial, Medial, or Final.
- Import status and validation indicator.
- A primary Import SVG action when empty.
- Replace SVG and Open Workspace actions when populated.

A slot must never imply that a file is correct merely because it was imported. “Imported” means the SVG passed basic parsing; “Ready” means the user approved placement and all required checks passed.

## 4. Glyph workspace canvas

### 4.1 Coordinate system

- The authoritative workspace unit is **font units (FU)**.
- The default project preset is 1000 units per em (UPM), with 2048 available as an alternative.
- The baseline is Y = 0.
- Positive font Y values extend above the baseline; negative values extend below it.
- X values increase from left to right in the editor.
- SVG's usual downward-positive Y axis is transformed during import into the font coordinate system.
- The canvas view may be mirrored for visual inspection, but the stored glyph coordinates must not be mirrored by that view option.

Horizontal advances remain positive font metrics. Arabic right-to-left text direction is handled by the shaping/layout system; it is not implemented by reversing or making glyph advances negative.

### 4.2 Rulers

**Horizontal ruler:** shows X positions in font units, including the glyph origin, left side bearing boundary, outline bounds, right side bearing boundary, and advance-width endpoint.

**Vertical ruler:** shows Y positions in font units relative to the baseline and the active vertical metrics.

Requirements:

- Ruler labels adapt to zoom and available screen space.
- Major and minor tick marks are visually distinct.
- The pointer position is shown as a live coordinate readout.
- Ruler origin can be reset to the glyph origin; project-wide font coordinates remain stable.
- Units can be displayed as FU, em fractions, or pixels for visual reference; FU remains the source of truth.
- Rulers can be hidden without hiding metric guides.

### 4.3 Global metric lines

The font project defines global vertical metrics and optional design references. The workspace can show:

- Baseline: mandatory reference at Y = 0.
- Ascender line: upper global metric reference.
- Descender line: lower global metric reference.
- Cap-height reference: optional, mainly useful for Latin capitals or mixed-script families.
- Arabic body-height reference: optional designer-defined guide; not treated as a universal Arabic typographic standard.
- Mark-safe zones: optional top and bottom regions used to help maintain room for combining marks.

Metric values are edited in the Font Metrics panel. Dragging a metric line can update its value when the line is unlocked; a lock icon prevents accidental modification.

### 4.4 Glyph-local guides

Users can create horizontal or vertical guides by:

- Dragging from the rulers.
- Adding a guide and entering an exact FU value.
- Converting a selected anchor or outline extremum into a guide.

Guides support move, duplicate, lock, hide, rename, and delete. A guide may be local to one glyph or saved as a reusable project guide. Guide colors and line styles should be configurable, with accessible contrast.

### 4.5 Grid

The grid is an optional visual aid, not a substitute for metrics.

- Major and minor grid intervals are configurable in FU.
- Defaults may be offered based on UPM, but users can customize them.
- Grid visibility and grid snapping are separate controls.
- Grid density adapts to zoom to avoid visual clutter.
- A “subdivision” setting can show smaller intervals for detailed placement.

## 5. Snapping system

Snapping must be predictable, inspectable, and controllable. The application must never silently alter imported source artwork merely because snapping is enabled.

### 5.1 Snap targets

Each target can be enabled or disabled independently:

1. Grid intersections.
2. Baseline and global metric lines.
3. Custom guides.
4. Glyph origin and advance-width boundary.
5. Left/right side-bearing boundaries.
6. Outline bounds and extrema.
7. Outline nodes and Bézier handles, if node editing is supported.
8. Anchor points.
9. Smart alignment with other selected or reference elements.

### 5.2 Snap tolerance

- Tolerance is specified in screen pixels, not font units, so it feels consistent at different zoom levels.
- Initial default: 8 screen pixels; configurable range: 2–24 pixels.
- The application should use a small hysteresis margin so the snap does not flicker when a pointer rests near a target.
- A clear visual indicator identifies the active target and the exact alignment line.

### 5.3 Snap priority

Recommended default priority:

1. Explicit anchor-to-anchor attachment.
2. Baseline and locked metric lines.
3. Custom guides.
4. Outline nodes/extrema and glyph bounds.
5. Advance and side-bearing boundaries.
6. Grid.

When two candidates have comparable distances, the application must use deterministic tie-breaking and display which target won. Users may adjust target priority in preferences.

### 5.4 Smart Guides

Smart Guides appear temporarily while moving artwork or anchors. They show:

- Shared horizontal or vertical alignment.
- Equal gaps or matching offsets.
- Alignment to baseline, metric lines, anchors, and outline extrema.
- Distance readouts in FU.

Smart Guides are visual feedback; they only affect position when the relevant snapping target is enabled.

### 5.5 Temporary bypass and constraints

- Global Snap toggle is available in the context bar.
- Hold **Alt** (Windows/Linux) or **Option** (macOS) during a drag to temporarily bypass snapping; shortcut must be configurable.
- Hold Shift to constrain movement to the dominant axis, where applicable.
- Numeric X/Y fields provide exact positioning independently of snapping.
- Accessibility and keyboard-only alternatives must be supported for all drag operations.

## 6. Artwork placement and metrics controls

The Properties panel includes:

- X and Y position.
- Uniform scale percentage.
- Width and height of the outline bounds (read-only unless scaling is enabled).
- Advance width.
- Left side bearing.
- Right side bearing.
- Baseline offset.
- Lock proportions toggle.
- Center in advance box action.
- Align bottom to baseline action.
- Fit to reference height action.
- Reset placement action.

Advance width and side bearings are separate concepts from outline width. Changing one must not silently scale the artwork.

Recommended placement presets:

- Preserve Original Size.
- Align to Baseline.
- Fit to Arabic Body-Height Reference.
- Fit to Em Box (proportional).
- Center in Advance Box.

Presets apply an initial transformation and remain editable. The application should not claim that automatic fit produces professional optical sizing; it is a starting point.

## 7. Anchors and attachment visualization

An anchor is a named positioning point that the font engine uses when placing marks or joining cursive glyphs.

### Mark anchors

- Base glyph anchors: top and bottom classes, with room for additional classes.
- Mark glyph anchors: matching attachment anchors, e.g. top-mark or bottom-mark.
- The workspace displays compatible anchor pairs using matching visual symbols.
- Users can snap a mark anchor to a base anchor or set an exact coordinate.

### Cursive anchors

- Entry and exit anchors can be shown for forms that participate in cursive joining.
- A connection preview displays the expected relationship between adjoining glyph forms.
- The engine translates approved anchors into the required cursive positioning data.

Anchor names and classes are managed through visual lists and presets; no positioning code is required.

## 8. Import interaction

Import is slot-based:

1. User selects a glyph slot.
2. User clicks Import SVG or drops a file into the slot/workspace.
3. Import preview shows artwork, viewBox, detected bounds, and warnings.
4. User selects a placement preset or retains the default.
5. User confirms import.
6. Workspace opens with the artwork and guides visible.

The filename may be displayed as source information but does not determine the slot's character identity.

## 9. Preview panel

Preview modes:

- Character: current glyph and all forms.
- Word: Arabic joining and mark behavior.
- Paragraph: full layout with Arabic/Latin mixed text, numerals, punctuation, and diacritics.

Preview controls include font size, line spacing, sample text, direction display, and a way to select a rendered glyph run and jump to its source slot. Text shaping must be performed by the selected shaping engine rather than simulated by concatenating visual forms.

## 10. Interaction and accessibility

- Every draggable value must also have a numeric input.
- Tooltips explain specialized terms in plain language.
- Distinguish selected, hovered, snapped, locked, invalid, and edited states.
- Provide undo/redo for positioning, guide, anchor, and metrics changes.
- Avoid using color as the only status indicator; pair color with icons and labels.
- Support keyboard navigation between slots and workspace controls.
