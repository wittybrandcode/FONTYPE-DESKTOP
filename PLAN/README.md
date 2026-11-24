# Arabic Font Studio — Project Starter Pack

**Document set:** 0.1 · **Status:** Initial product definition  
**Product type:** Desktop application for authoring Arabic fonts from individual SVG glyph drawings  
**Primary workflow:** Adobe Illustrator → SVG → Glyph Slot → Font Engineering → OTF / TTF / WOFF2

## Product vision

Arabic Font Studio enables a graphic designer to create a production-ready Arabic typeface without needing to understand font programming, Unicode mapping, OpenType feature syntax, or font compilation. The designer draws each glyph in Adobe Illustrator, saves it as an individual SVG file, and imports it into the corresponding glyph slot. The application manages the technical work through visual controls, presets, validation, and an automated build pipeline.

The application is a **designer-facing Arabic font authoring environment**, not a general-purpose replacement for every professional font editor in its first release.

## Foundational product decisions

1. **One SVG per glyph form.** No master Illustrator document is required. Every slot accepts its own SVG file.
2. **The destination slot defines glyph identity.** The application must not depend on the SVG filename to identify the character or its Unicode mapping.
3. **Illustrator is the drawing tool.** The user does not need a dedicated Illustrator plug-in for the MVP.
4. **The glyph canvas is a font-metrics workspace.** It includes professional rulers, metric lines, guides, grids, snapping, anchors, and alignment tools.
5. **Font engineering is visual and preset-driven.** The application generates the required internal mappings and OpenType rules; users do not write feature code.
6. **SVG files remain editable source assets.** Imports must be replaceable without losing the slot's metrics, anchors, or configuration.
7. **The project is persistent and reproducible.** All drawings, metadata, metrics, settings, and build reports are retained in a reopenable project.

## Documents

| File | Purpose |
|---|---|
| `PRD.md` | Product requirements, scope, workflows, and acceptance criteria |
| `DESIGN.md` | Interface model and detailed ruler, guide, grid, snapping, and positioning behavior |
| `UI_UX_MASTER_PLAN.md` | Phase 7 visual, component, accessibility, usability, and UX elevation plan |
| `PHASE7_QA_REPORT.md` | Phase 7 M1–M8 verification results, screenshots, and accessibility sign-off |
| `ARCHITECTURE.md` | Application architecture, modules, services, and technical pipeline |
| `DATA_MODEL.md` | Project, glyph-slot, metric, anchor, and build data structures |
| `SVG_IMPORT_SPEC.md` | SVG import contract and Illustrator authoring rules |
| `FONT_ENGINE.md` | Arabic shaping, OpenType generation, and validation responsibilities |
| `TASKS.md` | Implementation roadmap and engineering backlog |

## Proposed MVP definition of done

A designer can create a project, open the generated glyph inventory, draw glyphs in Illustrator, import each SVG into its intended slot, position it using font-aware rulers and snapping, configure Arabic shaping through visual controls, preview real Arabic text, resolve validation issues, and export an installable OTF and TTF font.

## Important technical principle

Arabic contextual glyph forms are not independent Unicode characters in normal text encoding. A font maps the underlying Unicode characters and uses OpenType shaping substitutions and positioning to display the appropriate glyph forms. The application may ask the designer to draw isolated, initial, medial, and final artwork where needed, but it must manage the character-to-glyph mapping and shaping rules internally.
