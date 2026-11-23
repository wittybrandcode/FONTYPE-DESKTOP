# Product Requirements Document (PRD)

## 1. Product summary

Arabic Font Studio is a desktop application that turns individually drawn SVG glyphs into installable Arabic fonts. The designer creates artwork in Adobe Illustrator, saves each glyph or glyph form as an SVG, and imports the file into the corresponding visual slot in the application. The application provides a font-aware glyph workspace with rulers, metric lines, guides, snapping, anchors, spacing controls, Arabic shaping configuration, live text preview, validation, and font export.

The product hides font-engineering complexity behind visual controls and safe defaults. The designer should not need to write code, edit OpenType feature files, manually assign Unicode values, or understand compiler internals.

## 2. Problem statement

Creating an Arabic typeface currently requires both drawing skill and specialist knowledge of font construction. A graphic designer may be comfortable drawing letterforms in Illustrator but may not know how to:

- Organize base characters and contextual forms.
- Establish font units, baselines, ascenders, descenders, and side bearings.
- Build Arabic joining behavior and contextual substitutions.
- Position combining marks and cursive connections.
- Compile source outlines into OTF/TTF fonts.
- Validate shaping and font tables.

Arabic Font Studio separates the visual design work from font engineering. The designer supplies the artwork; the application supplies the structure, rules, checks, and build process.

## 3. Product goals

### Primary goals

- Make an Arabic font production workflow accessible to designers who do not know font programming.
- Import one SVG at a time into a specific glyph slot, with drag-and-drop and file-picker support.
- Provide professional font-editor positioning tools: rulers, metric lines, guides, grids, snapping, anchors, and spacing controls.
- Manage Arabic contextual forms and joining behavior through generated rules and visual settings.
- Preview Arabic shaping in words and paragraphs before export.
- Produce valid OTF and TTF files from a persistent project.
- Allow an imported drawing to be replaced while preserving its slot configuration.

### Secondary goals

- Support optional batch import after the slot-by-slot workflow is established.
- Support additional Arabic-script languages and extended character sets in later releases.
- Add multi-weight families, interpolation, and variable fonts in later releases.

## 4. Non-goals for MVP

- Replacing Illustrator as a vector drawing application.
- Requiring the user to edit a single master AI file.
- Providing a full-featured general Latin font editor.
- Requiring or exposing manual OpenType feature programming.
- Automatically inventing the designer's intended initial, medial, or final letterform from a single drawing.
- Promising automatic optical correction or professional spacing without designer review.
- Supporting every Arabic-script language and Unicode character set in the first release.

## 5. Target user and design principles

**Primary user:** A graphic designer or art director who can draw vector letterforms in Illustrator but has little or no knowledge of font engineering.

**Design principles:**

1. Visual first: show glyphs, rulers, and relationships instead of code.
2. Slot-led: every drawing enters through a clearly identified destination.
3. Safe defaults: standard Arabic behavior is generated automatically.
4. Explicit control: advanced adjustments are available without exposing implementation syntax.
5. Reversible actions: replace, undo, redo, and restore imported artwork safely.
6. Transparent validation: explain issues in design language and point to the exact glyph slot.
7. Preserve source: never destructively rewrite the user's original SVG file.

## 6. Core user journey

1. Create a new font project.
2. Enter family name, style name, units-per-em preset, and character-set preset.
3. The application creates a glyph inventory with dedicated slots for required characters and forms.
4. The designer draws each item in Illustrator and saves it as an individual SVG.
5. The designer opens a slot and imports its SVG, or drops the file directly onto the slot.
6. The application validates the SVG and displays the outline in the glyph metrics workspace.
7. The designer positions and scales the outline using rulers, metric guides, snapping, anchors, and side-bearing controls.
8. The designer repeats the process for the remaining glyphs and marks.
9. The application generates Arabic shaping relationships and default OpenType rules from project metadata and Unicode joining data.
10. The designer tests characters, words, and paragraphs in the preview panel.
11. The application reports missing artwork, spacing issues, mark attachment gaps, or shaping failures.
12. The designer resolves issues and builds OTF/TTF files.

## 7. Functional requirements

### 7.1 Project creation and management

- Create, open, duplicate, rename, and archive projects.
- Store project metadata, glyph artwork, metrics, anchors, settings, and build reports.
- Provide character-set presets: Arabic Core (MVP), Arabic Extended (later), Persian/Urdu (later), and optional Latin Basic (later).
- Allow a user to add or remove optional glyph groups without breaking required Unicode mapping.
- Autosave project metadata and edits; provide recovery after an unexpected close.

### 7.2 Glyph inventory and slots

- Show a searchable/filterable grid of glyph slots.
- Each slot must identify its character, human-readable name, glyph role/form, and completion state.
- Support required forms: isolated, initial, medial, and final when applicable to the character's joining behavior.
- Do not create unnecessary forms for right-joining or non-joining characters.
- Each slot must support Import SVG, Replace SVG, Remove Artwork, Open in Workspace, and View Validation.
- Slot identity and Unicode mapping are application metadata; filenames are not authoritative.
- Status states: Empty, Imported, Needs Review, Ready, Error. Status must be derived from validation and user approval, not merely file existence.

### 7.3 SVG import

- Import an individual SVG into the currently selected slot.
- Support file picker and drag-and-drop.
- Show a pre-import preview and detected SVG dimensions/viewBox.
- Provide import placement options: Preserve Size, Fit to Em, Fit to Reference Height, and Manual Scale.
- Default to Preserve Proportions; never stretch artwork non-uniformly without explicit user action.
- Convert SVG coordinates to font coordinates, including vertical-axis inversion.
- Warn about unsupported SVG elements, open contours, embedded raster images, strokes that have not been expanded, and unsupported effects.
- Keep a copy of the original imported SVG in the project.
- Allow Replace SVG while retaining slot metadata, metrics, anchors, and user settings. Recalculate geometry-dependent values and flag any anchors that may need review.

### 7.4 Glyph metrics workspace

- Display each outline in a dedicated font-coordinate canvas.
- Provide horizontal and vertical rulers with font-unit labels.
- Provide global and glyph-specific metric lines.
- Show advance width, left side bearing, right side bearing, outline bounds, and baseline.
- Allow selecting and moving artwork, scaling proportionally, and adjusting advance width.
- Allow manual numeric entry for all metric values as an alternative to dragging.
- Provide zoom, pan, fit glyph, fit em, and reset view.
- Provide optional outline/node view in a later milestone; imported path editing is not required for MVP.

### 7.5 Rulers, metric lines, guides, grids, and snapping

- Horizontal ruler displays X coordinates in font units; vertical ruler displays Y coordinates in font units.
- Baseline is always available and visually distinct.
- User can toggle global metric lines: baseline, ascender, descender, cap-height reference, and optional Arabic body-height reference.
- User can create, move, lock, hide, and delete custom horizontal and vertical guides.
- User can configure a major/minor grid and grid spacing in font units.
- Snapping targets are individually configurable: grid, metric lines, custom guides, baseline, glyph bounds, advance boundaries, outline nodes, outline extrema, and anchors.
- Smart Guides show temporary alignment and distance cues when an object aligns with another reference.
- Snap tolerance is measured in screen pixels so behavior remains predictable at different zoom levels.
- Provide a temporary snap-disable modifier and a global Snap toggle.
- Provide axis constraint while dragging and numeric positioning fields for precision.
- Snap priority must be deterministic and documented; users can configure target priority in preferences.

### 7.6 Anchors and Arabic positioning

- Provide named anchor presets for combining marks, including top and bottom attachment classes.
- Provide visual placement handles for mark anchors and base anchors.
- Provide entry and exit anchors for cursive attachment where required by the selected connection model.
- Allow anchor creation, movement, deletion, naming, and snapping.
- Display anchor class relationships and highlight compatible attachment points.
- Generate mark and cursive positioning data from approved anchors; users do not write positioning code.

### 7.7 Arabic shaping setup

- Determine joining behavior from Unicode joining data and project character definitions.
- Generate the appropriate isolated, initial, medial, and final substitution behavior where applicable.
- Provide a visual connection matrix explaining which forms are required for each character.
- Provide toggles for standard ligatures and optional stylistic substitutions.
- Support common lam-alef ligature artwork as an optional user-provided group; do not silently replace standard Unicode mappings with presentation-form codepoints.
- Generate Arabic script/language feature configuration internally.

### 7.8 Preview and validation

- Character preview: inspect a single glyph and all applicable forms.
- Word preview: enter Arabic text and inspect shaping.
- Paragraph preview: test mixed Arabic/Latin text, numbers, punctuation, and diacritics.
- Provide sample text presets and editable custom text.
- Use a shaping engine capable of Arabic text shaping for preview.
- Show validation findings with severity, glyph slot, explanation, and suggested correction.
- Distinguish hard build blockers from quality warnings.

### 7.9 Font build and export

- Generate OTF and TTF in MVP; WOFF2 can be enabled once validated in the build pipeline.
- Collect family name, style, version, designer, manufacturer, copyright, and license metadata.
- Generate `cmap`, horizontal metrics, naming, OS/2, head, hhea, maxp, GSUB, GPOS, and GDEF data as required.
- Produce a build report and retain the compiled artifacts in the project output folder.
- Never report a successful build unless the compiler exits successfully and post-build validation passes.
- Support install/open-folder actions after export.

## 8. UX quality requirements

- A first-time user should be able to import a single SVG into a visible slot without reading technical documentation.
- Every technical error must be translated into an actionable explanation.
- Common operations should be available from the slot card and workspace toolbar.
- Rulers and metric lines must remain legible at normal and high-DPI display scaling.
- Snapping must not feel sticky or unpredictable; provide visual feedback and a bypass modifier.
- The project must remain usable when only some glyphs have been imported.

## 9. MVP acceptance criteria

The MVP is accepted when all of the following are demonstrated:

1. A user can create and reopen a font project.
2. The application generates an Arabic glyph inventory with correct required forms for the selected preset.
3. A single SVG can be imported into a specific slot without relying on its filename.
4. Invalid or unsupported SVG content is detected and explained.
5. The workspace displays font-unit rulers, baseline, configurable metric lines, custom guides, grid, and snapping.
6. Artwork can be positioned and scaled proportionally while metrics remain editable.
7. Anchors can be visually created and assigned to supported mark/cursive classes.
8. The application generates Arabic contextual shaping behavior for supported characters.
9. A user can preview Arabic words and paragraphs using a real shaping engine.
10. OTF and TTF files compile and pass post-build checks for the supported MVP character set.
11. Replacing a glyph's SVG preserves its slot identity and unrelated settings.
12. The application produces a clear report of missing glyphs and blocking issues.

## 10. Success metrics

- Time from new project to first successful SVG import.
- Percentage of required glyph slots completed.
- Percentage of builds completed without technical assistance.
- Number of build blockers caught before compilation.
- Arabic shaping test pass rate for the supported test corpus.
- Rate of successful glyph replacement without loss of configuration.
