"""UFO-compatible intermediate source generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fontTools.pens.basePen import BasePen
from fontTools.pens.recordingPen import RecordingPen
from ufoLib2 import Font

ANCHOR_CLASSES_LIB_KEY = "org.fontype.anchorClasses"
SOURCE_LIB_KEY = "org.fontype.source"


@dataclass
class SourceGlyph:
    """One resolved glyph ready for UFO serialization."""

    name: str
    pen: BasePen
    width: float
    unicode_value: int | None = None
    anchors: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


def _notdef_pen() -> RecordingPen:
    pen = RecordingPen()
    pen.moveTo((60, 0))
    pen.lineTo((60, 600))
    pen.lineTo((460, 600))
    pen.lineTo((460, 0))
    pen.closePath()
    return pen


def build_ufo(
    *,
    output_path: Path,
    upm: int,
    ascender: int,
    descender: int,
    family_name: str,
    style_name: str,
    glyphs: dict[str, tuple[Any, float, int | None]],
    features: str = "languagesystem arab dflt;\n",
) -> Path:
    font = Font()
    info = font.info
    info.familyName = family_name
    info.styleName = style_name
    info.unitsPerEm = upm
    info.ascender = ascender
    info.descender = descender
    info.capHeight = int(upm * 0.7)
    info.xHeight = int(upm * 0.5)
    info.versionMajor = 0
    info.versionMinor = 1
    info.openTypeNameDesigner = "FONTYPE"
    info.openTypeOS2TypoLineGap = 0

    for name, (pen, width, unicode_value) in glyphs.items():
        glyph = font.newGlyph(name)
        glyph.width = int(round(width))
        if unicode_value is not None:
            glyph.unicode = unicode_value
        pen.replay(glyph.getPen())

    if ".notdef" not in font:
        glyph = font.newGlyph(".notdef")
        glyph.width = int(upm * 0.5)
        _notdef_pen().replay(glyph.getPen())

    font.features.text = features
    output_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(output_path)
    return output_path


def build_source_ufo(
    *,
    output_path: Path,
    upm: int,
    metrics: dict[str, Any],
    family_name: str,
    style_name: str,
    glyphs: list[SourceGlyph],
    groups: dict[str, list[str]],
    metadata: dict[str, Any],
    features: str = "languagesystem arab dflt;\n",
) -> Path:
    """Write a project-derived UFO with metrics, anchors, groups and metadata.

    Anchor names are kept verbatim; attachment classes are preserved in the
    glyph lib so the shaping generator (Phase 4) does not have to guess them.
    """
    font = Font()
    info = font.info
    info.familyName = family_name
    info.styleName = style_name
    info.unitsPerEm = upm
    info.ascender = int(round(float(metrics.get("ascender") or upm * 0.8)))
    info.descender = int(round(float(metrics.get("descender") or -upm * 0.25)))
    cap_height = metrics.get("capHeight")
    if cap_height is not None:
        info.capHeight = int(round(float(cap_height)))
    else:
        info.capHeight = int(upm * 0.7)
    info.xHeight = int(upm * 0.5)
    info.versionMajor = 0
    info.versionMinor = 1
    info.openTypeNameDesigner = str(metadata.get("designer") or "FONTYPE")
    info.openTypeOS2TypoLineGap = 0

    for glyph_spec in glyphs:
        glyph = font.newGlyph(glyph_spec.name)
        glyph.width = int(round(glyph_spec.width))
        if glyph_spec.unicode_value is not None:
            glyph.unicode = glyph_spec.unicode_value
        glyph_spec.pen.replay(glyph.getPen())
        for anchor in glyph_spec.anchors:
            glyph.appendAnchor(
                {
                    "name": str(anchor["name"]),
                    "x": int(round(float(anchor["x"]))),
                    "y": int(round(float(anchor["y"]))),
                }
            )
        anchor_classes = {
            str(anchor["name"]): str(anchor.get("class") or anchor["name"])
            for anchor in glyph_spec.anchors
        }
        if anchor_classes:
            glyph.lib[ANCHOR_CLASSES_LIB_KEY] = anchor_classes
        if glyph_spec.metadata:
            glyph.lib[SOURCE_LIB_KEY] = dict(glyph_spec.metadata)

    if ".notdef" not in font:
        glyph = font.newGlyph(".notdef")
        glyph.width = int(upm * 0.5)
        _notdef_pen().replay(glyph.getPen())

    for group_name, members in groups.items():
        if members:
            font.groups[group_name] = list(dict.fromkeys(members))

    font.lib[SOURCE_LIB_KEY] = dict(metadata)
    font.features.text = features
    output_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(output_path)
    return output_path
