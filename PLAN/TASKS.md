# Implementation Roadmap & Task Backlog

## Delivery strategy

Build a reliable end-to-end vertical slice first: create project → import one SVG into one slot → show it on a font metrics canvas → build a minimal font → shape a test string. Expand the character set and advanced editor tools only after that pipeline works.

## Phase 0 — Technical foundation ✅ مكتملة

- [x] Create repository and desktop application skeleton (Tauri + React + TypeScript).
- [x] Define project file extension and directory structure (`.afsp`).
- [x] Define versioned project schema and migration strategy.
- [x] Establish local font-engine adapter and process communication.
- [x] Pin toolchain versions and create CI build environment.
- [x] Define error/result contracts for import, preview, and build operations.
- [x] Headless spike: one SVG → normalized geometry → UFO → OTF/TTF → HarfBuzz check.

**Exit criteria:** app opens, creates a project, saves it, reopens it, and runs a local engine health check.

**Phase 0 notes (2026-11-23):** Implemented at repository root. UI is Arabic-first RTL. Engine is a
local Python 3.12 process using JSON-lines events over stdout (`engine/fontype_engine`). Toolchain is
pinned by `engine/uv.lock`, `package-lock.json` and `src-tauri/Cargo.lock`. The spike additionally
proved the automated cubic-to-quadratic conversion used by the TTF path. Next: Phase 1.

## Phase 1 — Glyph inventory and SVG import ✅ مكتملة

- [x] Define Arabic Core character-set preset.
- [x] Load pinned Unicode Arabic joining data.
- [x] Generate required character and contextual-form slots.
- [x] Build searchable glyph inventory UI.
- [x] Implement per-slot Import SVG action.
- [x] Implement drag-and-drop onto a selected slot.
- [x] Implement secure SVG parsing and sanitization.
- [x] Implement SVG path and transform normalization.
- [x] Implement Y-axis inversion and font-unit conversion.
- [x] Implement import preview, warnings, and placement presets.
- [x] Preserve original SVG and record content hash.
- [x] Implement Replace SVG with recoverable source revision.

**Exit criteria:** a designer can import and replace one SVG per slot; slot identity is independent of filename.

**Phase 1 notes (2026-11-23):** Slots are generated from `engine/data/arabic-core.json` using the pinned
`formsByJoiningType` map at project creation (D/R/U/T → 1–4 contextual forms, 140 slots total). The importer exposes
`inspect_svg` from Python with normalized font-unit geometry, a live SVG preview, structured findings,
four placement modes and a secure, defused XML parser. The host copies artwork to
`glyphs/<base>/<form>.svg`, records SHA-256, mode, matrix and bounds, and keeps timestamped
`.rev-*.svg` recoverable snapshots on replace/remove. Search, group/status filters, drag-and-drop
(Tauri webview events), approval and editable advance width are wired in the Arabic RTL UI.
Tests: Python 11, Rust 4, frontend 2; production build and compiled Tauri launch verified.

## Phase 2 — Professional glyph workspace ✅

- [x] Build scalable workspace viewport with zoom and pan.
- [x] Render outlines and calculate geometry bounds.
- [x] Implement horizontal and vertical font-unit rulers.
- [x] Implement baseline and global metric lines.
- [x] Implement custom horizontal/vertical guides.
- [x] Implement major/minor grid and subdivisions.
- [x] Implement snap target registry.
- [x] Implement screen-pixel snap tolerance and snap hysteresis.
- [x] Implement deterministic snap priority.
- [x] Implement Smart Guides and distance cues.
- [x] Implement temporary snap bypass and axis constraints.
- [x] Implement numeric X/Y and scale fields.
- [x] Implement advance width and side-bearing controls.
- [x] Implement undo/redo for workspace edits.
- [x] Implement guide/metric lock and visibility controls.

**Exit criteria:** imported glyph can be accurately positioned using rulers, metrics, guides, grid, snapping, and numeric entry.

Notes: pure workspace math lives in `src/core/workspace.ts` (viewport transforms, 1/2/5 ruler steps,
screen-pixel snap tolerance with hysteresis and deterministic priority) with 13 Vitest cases. The
`src-tauri/src/workspace.rs` commands persist placement, metrics, workspace preferences and guides
with 2 Rust round-trip tests. `ImportInfo.preview_path` is stored so outlines render directly from
the inspected SVG without re-reading the file. Tests: Python 11, Rust 6, frontend 15; production
build and compiled Tauri launch verified.

## Phase 3 — Anchors and font source model ✅

- [x] Define glyph model and internal glyph naming strategy.
- [x] Generate intermediate UFO-compatible source from project data.
- [x] Implement named anchor model.
- [x] Implement visual top/bottom mark anchor editor.
- [x] Implement entry/exit cursive anchors.
- [x] Implement anchor compatibility and snapping.
- [x] Implement anchor validation and review states.
- [x] Ensure source replacement preserves metrics and marks affected anchors for review.

**Exit criteria:** glyphs, metrics, and anchors can be persisted and represented in the intermediate font source.

Notes: slot-derived glyph names (`beh.init`, `beh.isol`) and UPM-normalized placement are resolved in
`engine/fontype_engine/source.py`; the new `build_source` engine command writes a UFO containing
outlines, widths, primary-form cmap entries, named anchors, anchor-class lib data, groups and project
metadata. Rust owns the typed anchor model and validation in `src-tauri/src/anchors.rs`: role-aware
suggestions from the pinned preset, duplicate/class/range/role checks, review flags, and derived
status. `src/core/anchors.ts` owns compatibility symbols and anchor snap targets. The workspace
renders draggable anchor handles with compatibility lines, numeric editing, lock/delete controls and
review badges. SVG replacement keeps slot metadata, metrics and anchors, and flags geometry-dependent
anchors when bounds change materially. Tests: Python 17, Rust 11, frontend 20; production build and
compiled Tauri launch verified.

## Phase 4 — Arabic shaping and font compilation

- [ ] Generate Unicode cmap mapping for supported base characters.
- [ ] Generate contextual glyph substitution data for applicable forms.
- [ ] Generate Arabic script/language feature configuration.
- [ ] Generate mark attachment positioning from anchors.
- [ ] Generate cursive attachment positioning from entry/exit anchors.
- [ ] Implement configurable common lam-alef ligature group.
- [ ] Compile OTF output.
- [ ] Compile TTF output with tested outline conversion.
- [ ] Inspect required font tables after compilation.
- [ ] Add post-build validation and reproducible build report.

**Exit criteria:** a test project produces OTF and TTF fonts that install and pass structural validation.

## Phase 5 — Preview and quality assurance

- [ ] Integrate HarfBuzz preview shaping.
- [ ] Implement character, word, and paragraph preview modes.
- [ ] Add Arabic test corpus.
- [ ] Add mixed-script, punctuation, digit, and diacritic tests.
- [ ] Add right-joining and non-joining transition tests.
- [ ] Link preview glyphs to their source slots where possible.
- [ ] Implement validation severity model (blocker/warning/info).
- [ ] Implement actionable validation report and navigation to affected slots.

**Exit criteria:** all supported shaping cases pass the defined test corpus and issues are understandable to a designer.

## Phase 6 — Release hardening

- [ ] Add project backup and recovery.
- [ ] Add import/build cancellation and progress reporting.
- [ ] Test high-DPI and multiple display scales.
- [ ] Test snap behavior across zoom levels.
- [ ] Test malformed and oversized SVG inputs.
- [ ] Test Windows packaging; assess macOS packaging.
- [ ] Add sample project and onboarding walkthrough.
- [ ] Add export metadata editor and output folder actions.
- [ ] Prepare release checklist and known limitations.

**Exit criteria:** stable MVP package with a documented supported character set and reproducible build process.

## Priority order

**P0:** Project model, glyph slots, one-by-one SVG import, coordinate conversion, metrics canvas, ruler/guide/snap system, basic OTF/TTF build.  
**P1:** Anchors, Arabic shaping coverage, HarfBuzz preview, validation quality.  
**P2:** Batch import, additional scripts, multiple weights, interpolation, variable fonts, advanced stylistic features.

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| SVG contains unsupported Illustrator effects | Publish a constrained SVG authoring profile and return actionable import warnings |
| Arabic contextual shaping is incomplete | Use pinned Unicode joining data and a versioned shaping test corpus |
| Cursive connections look incorrect | Provide visual entry/exit anchors and connection previews |
| Mark placement is inconsistent | Use named anchor classes and mark attachment tests |
| TTF conversion changes curve quality | Add tested cubic-to-quadratic conversion and visual regression samples |
| Snapping feels unpredictable | Screen-space tolerance, clear target indicators, deterministic priority, temporary bypass |
| Replacing artwork invalidates anchors | Preserve anchor data but flag geometry-dependent anchors for review |

## First vertical-slice milestone

Before expanding the full Arabic character inventory, prove this complete path with a small test set:

1. Create project.
2. Import one isolated glyph SVG into its slot.
3. Position it on the ruler/metrics canvas with snapping.
4. Set advance width and side bearings.
5. Compile a minimal font.
6. Open a preview and verify the glyph appears for its Unicode character.

Then add the contextual forms and Arabic shaping rules.
