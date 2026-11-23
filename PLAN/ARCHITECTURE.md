# Technical Architecture

## 1. Architecture overview

Arabic Font Studio is a desktop application with a React interface, a Tauri host, and a local font-engine service. The application stores editable SVG sources and project metadata, transforms artwork into font outlines, generates OpenType tables and features, shapes preview text, and validates exported fonts.

```text
┌────────────────────────────── Desktop Application ──────────────────────────┐
│                                                                             │
│  React UI                                                                   │
│  ├─ Project / Glyph Inventory                                               │
│  ├─ Glyph Workspace (rulers, guides, grid, snap, anchors, metrics)         │
│  ├─ SVG Import Dialog                                                      │
│  ├─ Arabic Shaping Setup                                                   │
│  ├─ Text Preview                                                           │
│  └─ Build / Validation                                                     │
│                 │ Tauri command boundary                                  │
│                 ▼                                                          │
│  Application Services                                                      │
│  ├─ Project Service                                                        │
│  ├─ Glyph Slot Service                                                     │
│  ├─ SVG Import and Sanitization Service                                    │
│  ├─ Metrics and Anchor Service                                             │
│  ├─ Character Set / Unicode Service                                       │
│  ├─ Arabic Shaping Rule Generator                                          │
│  ├─ Font Build Orchestrator                                                │
│  └─ Validation and Report Service                                         │
│                 │                                                          │
│                 ▼                                                          │
│  Font Engine Adapter (local process / embedded worker)                    │
│  ├─ SVG path normalization                                                 │
│  ├─ UFO source generation                                                  │
│  ├─ OpenType feature generation                                            │
│  ├─ Font compilation                                                      │
│  └─ Post-build inspection                                                  │
│                 │                                                          │
│                 ▼                                                          │
│  Toolchain: FontTools · ufoLib2 · fontmake · HarfBuzz                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Recommended technology stack

| Layer | Recommendation | Responsibility |
|---|---|---|
| Desktop shell | Tauri | Native packaging, file access, commands, app lifecycle |
| UI | React + TypeScript | Project UI, glyph canvas, forms, preview, settings |
| Canvas rendering | SVG-based scene or Canvas/WebGL layer | Render outlines, rulers, guides, snap cues, anchors |
| Project persistence | JSON metadata + individual SVG assets | Reopenable, versioned source project |
| Geometry processing | Python service or Rust geometry module | SVG normalization and coordinate conversion |
| Font source model | UFO-compatible intermediate model | Represent glyphs, metrics, anchors, groups, and features |
| Font build | FontTools + ufoLib2 + fontmake | Generate OTF/TTF and inspect font tables |
| Arabic preview | HarfBuzz | Shape preview text using OpenType rules |

Keep toolchain versions pinned and tested in CI. Do not allow the UI to depend on undocumented internal behavior of a command-line tool; isolate tools behind adapters.

## 3. Application modules

### 3.1 Project Service

- Creates and opens project folders.
- Manages project schema versions and migrations.
- Autosaves metadata safely using atomic writes.
- Tracks source assets and build artifacts.

### 3.2 Glyph Inventory Service

- Loads the selected character-set preset.
- Creates glyph slots and required form slots.
- Associates each slot with stable internal IDs, Unicode codepoints where applicable, glyph names, and shaping roles.
- Uses Unicode Arabic joining data to determine which contextual forms are needed.

### 3.3 SVG Import Service

Pipeline:

1. Read SVG and enforce file-size/resource limits.
2. Parse XML safely; disable external entities and external resource loading.
3. Resolve supported transforms and simple presentation attributes.
4. Extract supported vector paths.
5. Reject or warn on unsupported content such as raster images, text objects, filters, unresolved external references, and unexpanded strokes.
6. Normalize path geometry into internal curves.
7. Convert SVG coordinates into font coordinates (including Y-axis inversion).
8. Apply user-selected scale and placement transform.
9. Store original SVG unchanged plus normalized geometry and import report.

The user-facing importer must return structured warnings rather than crashing on malformed input.

### 3.4 Glyph Workspace Service

- Maintains viewport transform, zoom, pan, and ruler scaling.
- Renders outline geometry and metric references.
- Calculates outline bounds and extrema.
- Handles guides, grid, snap candidates, snap priority, and smart-guide feedback.
- Stores artwork transforms and glyph metrics separately.
- Exposes a geometry abstraction so the rendering layer can change without changing font data.

Snapping must be calculated in screen space for tolerance, while stored positions remain in font units.

### 3.5 Metrics and Anchor Service

- Stores global font metrics and per-glyph horizontal metrics.
- Stores anchors as named font-coordinate points.
- Validates anchor class compatibility.
- Generates normalized anchor data for the font source model.

### 3.6 Arabic Shaping Rule Generator

- Consumes Unicode codepoints, joining types, glyph names, user-approved forms, and optional ligature definitions.
- Generates Arabic script/language feature data and contextual substitutions.
- Creates required isolated/initial/medial/final behavior for supported joining characters.
- Generates mark attachment data from anchor classes.
- Generates cursive attachment positioning from entry/exit anchors where supported.
- Does not require users to edit feature syntax.

### 3.7 Font Build Orchestrator

- Creates an intermediate UFO-compatible source.
- Adds glyph outlines, cmap mappings, metrics, naming, groups, anchors, and generated features.
- Invokes the compiler adapter for OTF/TTF output.
- Captures compiler logs and versions.
- Runs post-build checks and stores a reproducible build report.

### 3.8 Preview and Validation Service

- Uses HarfBuzz for Arabic shaping tests.
- Reports which glyphs are used for a test string and links them to source slots when possible.
- Separates technical correctness from visual quality suggestions.
- Provides blocking and non-blocking findings.

## 4. Data flow

```text
Illustrator artwork
       │ Save as individual SVG
       ▼
Selected Glyph Slot
       │ slot ID supplies identity
       ▼
SVG parser + sanitizer
       │
       ▼
Normalized vector geometry ───── Original SVG retained
       │
       ▼
Glyph Workspace
       ├─ placement transform
       ├─ horizontal metrics
       ├─ global/local guides
       └─ anchors
       │
       ▼
Font source model (UFO-compatible)
       ├─ glyph outlines and names
       ├─ Unicode cmap
       ├─ hmtx metrics
       ├─ anchors and groups
       └─ generated GSUB/GPOS/GDEF features
       │
       ▼
Font compilation
       │
       ├─ OTF
       └─ TTF
       │
       ▼
HarfBuzz preview + font validation + build report
```

## 5. Coordinate and metrics model

- Project UPM defaults to 1000; 2048 may be offered as an alternative at project creation.
- Baseline is Y = 0.
- Font coordinates use positive Y upward.
- SVG coordinates are transformed from positive Y downward.
- Glyph outlines, anchors, guides, and metric values are stored in font units.
- Viewport coordinates are only a rendering concern and never become source data.
- Horizontal advance width is stored independently from outline bounds.
- Left and right side bearings are derived from outline bounds and advance width, but the user can edit the underlying values explicitly.

## 6. Font source and compilation strategy

Use an intermediate source model compatible with UFO conventions rather than attempting to write binary font tables directly in the UI. The build adapter should own the mapping from application data to UFO source and compiler inputs.

Potential internal flow:

- Application project model → normalized glyph geometry and metrics.
- Normalized model → UFO source.
- Generated feature data → feature source compiled by the font toolchain.
- UFO + features → OTF/TTF via fontmake/FontTools.
- Compiled output → HarfBuzz shaping tests and font table validation.

Choose an outline representation and conversion strategy deliberately. Cubic curves may be retained for CFF-based OTF output; TrueType output requires quadratic outlines or a tested cubic-to-quadratic conversion step. This conversion must be automated and quality-checked.

## 7. Arabic shaping architecture

The application must distinguish:

- Unicode character identity (what the user types).
- Internal glyph identity (which outline is stored).
- Contextual glyph role (isolated, initial, medial, final).
- Shaping behavior (when a form is selected and how it connects).

Do not map Arabic presentation-form codepoints as the normal solution for contextual shaping. Use standard Unicode characters in `cmap`, with OpenType substitution and positioning behavior for contextual forms.

The shaping generator should use a pinned Unicode data version for joining properties and a tested Arabic shaping corpus. It must account for characters that do not connect to the following character, dual-joining characters, transparent marks, and characters with special joining behavior.

## 8. Persistence and project structure

```text
<ProjectName>.afsp/
├── project.json
├── glyphs/
│   ├── beh/
│   │   ├── isolated.svg
│   │   ├── initial.svg
│   │   ├── medial.svg
│   │   └── final.svg
│   └── ...
├── normalized/
├── previews/
├── reports/
└── output/
```

The file names above are storage conventions only. Slot IDs and project metadata are authoritative.

## 9. Error handling and reliability

- Imports and builds run in cancellable background tasks.
- The UI remains responsive during parsing and compilation.
- Each task reports progress and a structured result.
- Failed builds preserve the previous successful output.
- Temporary files are written to a staging directory and promoted only after success.
- Project migrations create backups before changing schema.
- Malformed SVG input is treated as untrusted input and parsed defensively.

## 10. Testing strategy

- Unit tests: coordinate transforms, metrics, snap candidate ranking, guide persistence, anchor compatibility, glyph naming, and Unicode joining classification.
- Import tests: supported/unsupported SVG samples, malformed input, large files, transforms, fill rules, and path bounds.
- Integration tests: SVG → project model → UFO → OTF/TTF.
- Shaping tests: isolated/initial/medial/final forms, right-joining letters, non-joining letters, transparent marks, lam-alef behavior, and mixed Arabic/Latin text.
- Regression tests: replace SVG without loss of metrics or anchors.
- Visual tests: ruler/guide rendering at multiple zoom levels and display scaling.

## 11. Security and privacy

- Local-first processing; no artwork upload is required.
- Disable network loading from SVG content.
- Sanitize XML and reject external file references.
- Restrict file paths to the active project or explicit user-selected locations.
- Keep compiler execution isolated and pass arguments safely without shell interpolation.
