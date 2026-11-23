# Arabic Font Engine & OpenType Behavior

## 1. Purpose

This document defines what the application must do internally so the designer can work through visual controls instead of writing font code.

## 2. Key concepts hidden from the user

- **Unicode character:** the underlying character typed by the user.
- **Glyph:** the drawn outline used to display a character or shaped sequence.
- **Contextual form:** the isolated, initial, medial, or final glyph form selected according to joining context.
- **GSUB:** OpenType glyph substitution data.
- **GPOS:** OpenType glyph positioning data.
- **GDEF:** glyph classification and attachment-related metadata.
- **Cursive attachment:** positioning behavior used to connect joining scripts.
- **Mark attachment:** positioning behavior used to place diacritics relative to base glyphs or other marks.

The application may show friendly labels, but it must generate the required data internally.

## 3. Unicode mapping and contextual forms

Arabic text is stored as normal Unicode characters. Contextual shapes are selected during shaping. The application should therefore:

- Map base Unicode characters to the appropriate default glyph in `cmap`.
- Store contextual artwork as internal glyphs with stable names.
- Generate the appropriate `isol`, `init`, `medi`, and `fina` substitution behavior where required.
- Use the Unicode Arabic joining properties to determine which forms are needed.
- Treat transparent combining marks correctly when resolving joining context.
- Handle right-joining, dual-joining, non-joining, and special joining behavior.

Do not solve Arabic shaping by mapping presentation-form codepoints as the primary text encoding. Presentation forms may be included only for a documented compatibility use case, not as the normal shaping strategy.

## 4. Joining data and glyph inventory

The application should ship with a pinned Unicode data version and generate the initial joining behavior from its Arabic joining properties. The character-set preset defines the supported codepoints; the joining data determines which contextual forms are applicable.

The glyph inventory should visually explain the forms required for each character. A character that does not join to the following character must not be treated as if it requires the same form set as a dual-joining character.

## 5. OpenType feature generation

The build system owns feature generation. At a high level it must generate:

- Arabic script and language-system declarations.
- Contextual substitutions for isolated, initial, medial, and final forms.
- Required ligature behavior where configured and supported.
- Mark-to-base positioning from approved anchor relationships.
- Mark-to-mark positioning where supported by the mark inventory.
- Cursive attachment positioning from entry/exit anchors for joining forms where required.
- Glyph classes and related definitions as needed by the generated features.

Users configure these behaviors through toggles, relationship pickers, and anchor tools. They never edit feature source directly in the normal workflow.

## 6. Mark attachment

The application should provide anchor presets and class relationships for common Arabic combining marks. The mark inventory must identify whether each mark attaches above, below, or to another mark. Base glyph anchors and mark anchors must be compatible by class.

The application should validate:

- Required base anchors for selected marks.
- Corresponding mark attachment anchors.
- Duplicate or conflicting anchor names.
- Anchors outside reasonable geometry bounds.
- Missing mark-to-mark relationships for configured stacked marks.

The designer can approve or override suggested anchor positions visually.

## 7. Cursive attachment

For joining glyphs, the application should provide entry and exit anchors on contextual forms and generate the required cursive positioning data. A connection preview should reveal likely gaps, overlaps, or mismatched anchor positions.

The application must distinguish between the designer's actual glyph outline and the positioning behavior used to connect it. Changing an anchor must not distort the glyph outline.

## 8. Ligatures and stylistic features

MVP should support a limited, explicit set of optional ligature groups, beginning with common lam-alef behavior where the required artwork is supplied and tested. Users may select a ligature group, import its artwork, and enable the corresponding behavior.

Later releases may add stylistic sets, contextual alternates, swashes, localized forms, and discretionary ligatures through visual feature-management panels.

## 9. Validation

### Blocking checks

- Missing required glyph artwork for the selected preset.
- Duplicate glyph names or invalid internal references.
- Invalid outlines that cannot be compiled.
- Missing mandatory substitution targets.
- Broken feature references.
- Compiler failure or invalid required tables.

### Quality warnings

- Unusually narrow or wide side bearings.
- Outlines exceeding global metrics unexpectedly.
- Missing optional anchors.
- Mark placement likely to collide with adjacent glyphs.
- Cursive connection gaps or excessive overlaps in test strings.
- Inconsistent visual scale across related forms.

Warnings should never be presented as objective design failures when they are subjective optical judgments.

## 10. Shaping test corpus

Create a versioned test corpus containing:

- Each supported Arabic character in isolation.
- Representative initial, medial, and final contexts.
- Right-joining and non-joining letter transitions.
- Words containing multiple joining transitions.
- Combining marks, including stacked marks.
- Lam-alef cases for enabled ligatures.
- Arabic punctuation and numerals.
- Mixed Arabic/Latin strings with punctuation and digits.

Run the corpus through HarfBuzz against the compiled font. Store expected glyph sequences or behavior-level assertions so regressions can be detected.

## 11. Compiler strategy

The application should build from an intermediate UFO-compatible source model and use a pinned FontTools/fontmake toolchain. The exact feature-generation and outline-conversion details should be isolated behind a compiler adapter.

OTF output may use cubic outlines in a CFF-based structure. TTF output requires TrueType-compatible quadratic outlines; implement and test a cubic-to-quadratic conversion path if the imported Illustrator paths are cubic Béziers. Do not assume that saving SVG alone makes the outlines directly valid for both formats.
