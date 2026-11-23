# SVG Import Specification

## 1. Purpose

SVG is the exchange format between Adobe Illustrator and Arabic Font Studio. Each file contains one intended glyph drawing or one intended glyph form. The application assigns its identity from the destination slot, not from the filename.

## 2. User workflow

1. Select a glyph slot, for example Beh → Medial.
2. Draw the relevant letterform in Illustrator.
3. Save/export the artwork as SVG.
4. Click Import SVG or drag the file into the slot.
5. Review the import preview and select a placement preset.
6. Confirm and position the glyph in the metrics workspace.

The same slot can later use Replace SVG to receive a revised drawing.

## 3. Illustrator authoring guidance

For predictable imports:

- Draw one glyph form per SVG file.
- Use vector paths; convert live text to outlines.
- Expand strokes before export.
- Remove hidden or unused objects.
- Avoid raster images, filters, live effects, and external linked assets.
- Use solid fills for outline artwork; the application interprets the filled silhouette as the glyph shape.
- Preserve holes/counters using correct compound paths and fill rules.
- Keep the artwork within a sensible artboard/viewBox; the importer still calculates actual path bounds.
- Do not add labels, registration marks, or decorative elements to the SVG.
- Save a backup of the original Illustrator document separately if future editing is needed.

## 4. Import modes

- **Preserve Size:** keep the artwork's source dimensions relative to the viewBox, then convert according to the project import scale.
- **Fit to Em:** proportionally scale the artwork to a selected target height within the em box.
- **Fit to Reference Height:** scale proportionally to the project's Arabic body-height guide or another selected metric line.
- **Manual Scale:** import at a neutral scale and let the user set exact scale values.

Non-uniform scaling is disabled by default. The UI must make any distortion explicit if a user chooses to unlock proportions.

## 5. SVG elements supported for MVP

Recommended support:

- `path` elements with supported SVG path commands.
- `g` groups and supported transform attributes.
- `viewBox` and width/height dimensions.
- Solid fill colors and `fill-rule` (`nonzero` and `evenodd`).
- Compound paths and multiple contours.
- Basic path geometry after transform resolution.

Warn or reject for MVP:

- `text` and font-dependent live text.
- Embedded or linked raster images.
- Filters, masks, patterns, and unsupported clipping paths.
- External references and scripts.
- Unexpanded strokes or appearance effects.
- CSS that cannot be resolved safely.
- Objects outside the viewBox if they are likely to be unintentionally clipped.

The importer should display a precise list of unsupported elements and offer a short correction hint.

## 6. Geometry normalization

The importer must:

1. Parse SVG XML defensively with external entity resolution disabled.
2. Resolve nested transforms into path coordinates.
3. Calculate the actual geometry bounds.
4. Convert supported path commands into the internal outline representation.
5. Convert the SVG Y-down coordinate system into font Y-up coordinates.
6. Apply the selected scale and placement transform.
7. Preserve contour direction and fill semantics where possible.
8. Detect open contours, degenerate segments, self-intersections, and suspicious duplicate geometry.
9. Generate a preview and structured validation report.

Do not silently change the silhouette to fix geometry. Any automatic repair must be explicit, reversible, and reported.

## 7. Font coordinate conversion

The project owns the UPM and coordinate origin. The importer maps SVG viewBox coordinates into font units using a recorded transform. The transform is stored with the slot so the import can be reproduced.

The baseline is Y = 0 and positive font Y points upward. SVG's positive Y direction points downward, so the importer must invert the vertical axis and then apply the selected placement offset. The application must not infer the baseline from an arbitrary SVG artboard edge.

## 8. Replacement behavior

Replacing the SVG must:

- Preserve the slot ID, character identity, form, Unicode mapping, metrics, guides, and project-level settings.
- Preserve anchors when possible, but mark anchors for review if the new outline bounds or geometry changed materially.
- Store the previous source file in project history or maintain a recoverable revision.
- Recalculate outline bounds and snapping references.
- Re-run validation.
- Never overwrite the external source SVG unless the user explicitly chooses an export action.

## 9. Import result contract

The import service returns:

- success/failure state;
- source filename and file hash;
- parsed dimensions and viewBox;
- normalized outline bounds;
- number of contours and segments;
- applied transform;
- supported/unsupported element list;
- validation warnings and errors;
- whether manual review is required.

## 10. File naming

Names such as `beh.svg` or `beh.medial.svg` are recommended for the designer's own organization, but the application must not rely on them. The currently selected glyph slot is the sole identity source at import time.
