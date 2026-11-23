"""Project data -> resolved font source model.

The host supplies glyph records already normalized to font units. This module
owns transform application, glyph naming/cmap decisions and the mapping of
anchors and classes to UFO glyph lib and groups. Shaping features are produced
by :mod:`fontype_engine.features` from the resolved model.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

from . import ufo_writer
from .protocol import EngineError

PRIMARY_FORMS = {"isolated", "base", "mark"}
ANCHOR_NAME_MAX = 63
OT_CATEGORIES_KEY = "public.openTypeCategories"


def _is_mark(metadata: dict[str, Any]) -> bool:
    return bool(
        metadata.get("markClass")
        or metadata.get("group") == "marks"
        or metadata.get("form") == "mark"
    )


def _ufo_anchor_name(name: str, anchor_class: str, metadata: dict[str, Any]) -> str:
    """Translate a project anchor into ufo2ft's generated-GPOS naming."""
    if anchor_class == "top-mark" or (
        name.endswith("-mark") and name.startswith("top")
    ):
        return "_top"
    if anchor_class == "bottom-mark" or (
        name.endswith("-mark") and name.startswith("bottom")
    ):
        return "_bottom"
    if anchor_class in {"cursive-entry", "cursive-exit"}:
        return "entry" if "entry" in name or anchor_class == "cursive-entry" else "exit"
    return name


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _codepoint(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.upper().startswith("U+"):
            return int(text[2:], 16)
        return int(text, 16 if any(c in text.upper() for c in "ABCDEF") else 10)
    except ValueError:
        return None


def _placement_matrix(
    placement: dict[str, Any],
) -> tuple[float, float, float, float, float, float]:
    """Font-space transform matching the workspace preview.

    The preview path is already in final font units (Y grows upward). Scale and
    rotation are applied around the glyph origin, then translated by X/Y.
    """
    scale_x = _number(placement.get("scaleX"), 1.0)
    scale_y = _number(placement.get("scaleY"), 1.0)
    if scale_x == 0.0 or scale_y == 0.0:
        raise EngineError("INVALID_PLACEMENT", "مقياس الخانة صفري.")
    radians = math.radians(_number(placement.get("rotation")))
    cosine, sine = math.cos(radians), math.sin(radians)
    return (
        scale_x * cosine,
        scale_x * sine,
        -scale_y * sine,
        scale_y * cosine,
        _number(placement.get("x")),
        _number(placement.get("y")),
    )


def _pen_for_glyph(preview_path: str, placement: dict[str, Any]) -> RecordingPen:
    pen = RecordingPen()
    if preview_path.strip():
        try:
            parse_path(preview_path, pen)
        except Exception as exc:  # fontTools raises several parser errors
            raise EngineError(
                "INVALID_PREVIEW_PATH", f"مسار المعاينة غير صالح: {exc}"
            ) from exc
    transformed = RecordingPen()
    pen.replay(TransformPen(transformed, _placement_matrix(placement)))
    return transformed


def resolve_glyph(record: dict[str, Any]) -> ufo_writer.SourceGlyph:
    name = str(record.get("glyphName") or "").strip()
    if not name:
        raise EngineError("MISSING_GLYPH_NAME", "اسم Glyph مفقود لأحد السجلات.")
    if len(name) > ANCHOR_NAME_MAX:
        raise EngineError("GLYPH_NAME_TOO_LONG", f"اسم Glyph طويل جداً: {name}")

    form = str(record.get("form") or "isolated")
    unicode_value = _codepoint(record.get("unicode")) if form in PRIMARY_FORMS else None

    metadata: dict[str, Any] = {
        "slotId": str(record.get("slotId") or name),
        "form": form,
    }
    for key in ("joiningType", "markClass", "group", "characterName"):
        if record.get(key) is not None:
            metadata[key] = str(record[key])

    raw_anchors = record.get("anchors") or []
    if not isinstance(raw_anchors, list):
        raise EngineError("INVALID_ANCHORS", "قائمة المراسي غير صالحة.")

    anchors: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for raw in raw_anchors:
        if not isinstance(raw, dict):
            continue
        anchor_name = str(raw.get("name") or "").strip()
        if not anchor_name or anchor_name in seen_names:
            continue
        seen_names.add(anchor_name)
        anchor_class = str(raw.get("class") or anchor_name)
        anchors.append(
            {
                "name": anchor_name,
                "ufoName": _ufo_anchor_name(anchor_name, anchor_class, metadata),
                "class": anchor_class,
                "x": _number(raw.get("x")),
                "y": _number(raw.get("y")),
            }
        )

    return ufo_writer.SourceGlyph(
        name=name,
        pen=_pen_for_glyph(
            str(record.get("previewPath") or ""), record.get("placement") or {}
        ),
        width=max(0.0, _number(record.get("advanceWidth"), 600.0)),
        unicode_value=unicode_value,
        anchors=anchors,
        metadata=metadata,
    )


@dataclass
class ResolvedProject:
    """Everything the UFO writer, feature generator and compiler need."""

    upm: int
    metrics: dict[str, Any]
    glyphs: list[ufo_writer.SourceGlyph] = field(default_factory=list)
    groups: dict[str, list[str]] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    family: str = "FONTYPE"
    style: str = "Regular"
    skipped: list[str] = field(default_factory=list)
    mapped_codepoints: list[int] = field(default_factory=list)

    @property
    def names(self) -> list[str]:
        return [glyph.name for glyph in self.glyphs]

    @property
    def anchor_count(self) -> int:
        return sum(len(glyph.anchors) for glyph in self.glyphs)

    def anchor_map(self, glyph_name: str) -> dict[str, dict[str, Any]]:
        glyph = next((item for item in self.glyphs if item.name == glyph_name), None)
        return {
            str(anchor["name"]): anchor for anchor in (glyph.anchors if glyph else [])
        }

    def font_lib(self) -> dict[str, Any]:
        categories: dict[str, str] = {".notdef": "base"}
        for glyph in self.glyphs:
            if glyph.name == "space":
                categories[glyph.name] = "base"
            elif _is_mark(glyph.metadata):
                categories[glyph.name] = "mark"
            elif glyph.metadata.get("form") == "ligature" or glyph.name.startswith(
                "lam_"
            ):
                categories[glyph.name] = "ligature"
            else:
                categories[glyph.name] = "base"
        return {OT_CATEGORIES_KEY: categories}


def resolve_project(params: dict[str, Any]) -> ResolvedProject:
    upm = int(_number(params.get("upm"), 1000))
    if upm < 100 or upm > 4096:
        raise EngineError("INVALID_UPM", "قيمة UPM غير صالحة.")

    records = params.get("glyphs") or []
    if not isinstance(records, list):
        raise EngineError("INVALID_GLYPHS", "قائمة الحروف غير صالحة.")

    resolved: list[ufo_writer.SourceGlyph] = []
    skipped: list[str] = []
    for record in records:
        if (
            not isinstance(record, dict)
            or not str(record.get("previewPath") or "").strip()
        ):
            skipped.append(str(record.get("slotId") or record.get("glyphName") or "?"))
            continue
        resolved.append(resolve_glyph(record))

    names = [glyph.name for glyph in resolved]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        raise EngineError(
            "DUPLICATE_GLYPH_NAMES", "أسماء Glyph مكرّرة.", {"names": duplicates}
        )

    resolved.append(
        ufo_writer.SourceGlyph(
            name="space",
            pen=RecordingPen(),
            width=upm * 0.25,
            unicode_value=0x0020,
            metadata={"slotId": "space", "form": "base", "group": "space"},
        )
    )

    groups: dict[str, list[str]] = {}
    for glyph in resolved:
        for key, prefix in (
            ("group", "fontype.group."),
            ("joiningType", "fontype.joiningType."),
            ("markClass", "fontype.markClass."),
            ("form", "fontype.form."),
        ):
            value = glyph.metadata.get(key)
            if value:
                groups.setdefault(prefix + str(value), []).append(glyph.name)
        for anchor in glyph.anchors:
            groups.setdefault("fontype.anchor." + str(anchor["class"]), []).append(
                glyph.name
            )

    mapped = [
        glyph.unicode_value for glyph in resolved if glyph.unicode_value is not None
    ]
    if len(mapped) != len(set(mapped)):
        raise EngineError(
            "DUPLICATE_CMAP",
            "أكثر من خانة تطالب بنفس نقطة Unicode.",
        )

    metrics = params.get("metrics") or {}
    metadata = {
        "schemaVersion": str(params.get("schemaVersion") or "0.1.0"),
        "presetId": str(params.get("presetId") or "arabic-core"),
        "unicodeVersion": str(params.get("unicodeVersion") or "16.0.0"),
        "projectId": str(params.get("projectId") or ""),
        "designer": str(params.get("designer") or ""),
        "version": str(params.get("version") or "1.000"),
        "copyright": str(params.get("copyright") or ""),
        "license": str(params.get("license") or ""),
    }
    return ResolvedProject(
        upm=upm,
        metrics=metrics if isinstance(metrics, dict) else {},
        glyphs=resolved,
        groups=groups,
        metadata=metadata,
        family=str(params.get("familyName") or "FONTYPE"),
        style=str(params.get("styleName") or "Regular"),
        skipped=skipped,
        mapped_codepoints=mapped,
    )


def build_source(params: dict[str, Any]) -> dict[str, Any]:
    from . import features as feature_generator

    output_text = str(params.get("outputPath") or "").strip()
    if not output_text:
        raise EngineError("NO_OUTPUT_PATH", "لم يتم تحديد مسار مصدر UFO.")
    model = resolve_project(params)
    feature_result = feature_generator.generate(model, params.get("shaping") or {})
    ufo_path = ufo_writer.build_source_ufo(
        output_path=Path(output_text),
        upm=model.upm,
        metrics=model.metrics,
        family_name=model.family,
        style_name=model.style,
        glyphs=model.glyphs,
        groups=model.groups,
        metadata=model.metadata,
        features=feature_result.text,
        font_lib=model.font_lib(),
    )

    return {
        "ok": True,
        "outputPath": str(ufo_path.resolve()),
        "glyphCount": len(model.glyphs),
        "mappedCodepoints": len(model.mapped_codepoints),
        "anchorCount": model.anchor_count,
        "groupCount": len(model.groups),
        "skippedSlots": model.skipped,
        "glyphNames": model.names,
        "features": feature_result.stats,
        "findings": feature_result.findings,
    }
