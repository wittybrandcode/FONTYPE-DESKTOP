"""Phase 3 font source model: project data -> intermediate UFO.

The host supplies resolved glyph records (already normalized to font units).
This module owns transform application, glyph naming/cmap decisions and the
mapping of anchors and classes into UFO glyph lib and groups. Shaping features
remain a Phase 4 concern; only the languagesystem declaration is emitted here.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

from . import ufo_writer
from .protocol import EngineError

PRIMARY_FORMS = {"isolated", "base", "mark"}
ANCHOR_NAME_MAX = 63


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
        anchors.append(
            {
                "name": anchor_name,
                "class": str(raw.get("class") or anchor_name),
                "x": _number(raw.get("x")),
                "y": _number(raw.get("y")),
            }
        )

    metadata: dict[str, Any] = {
        "slotId": str(record.get("slotId") or name),
        "form": form,
    }
    for key in ("joiningType", "markClass", "group", "characterName"):
        if record.get(key) is not None:
            metadata[key] = str(record[key])

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


def build_source(params: dict[str, Any]) -> dict[str, Any]:
    output_text = str(params.get("outputPath") or "").strip()
    if not output_text:
        raise EngineError("NO_OUTPUT_PATH", "لم يتم تحديد مسار مصدر UFO.")
    output_path = Path(output_text)

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
        metadata = glyph.metadata
        for key, prefix in (
            ("group", "fontype.group."),
            ("joiningType", "fontype.joiningType."),
            ("markClass", "fontype.markClass."),
            ("form", "fontype.form."),
        ):
            value = metadata.get(key)
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
        "unicodeVersion": str(params.get("unicodeVersion") or ""),
        "projectId": str(params.get("projectId") or ""),
        "designer": str(params.get("designer") or ""),
    }
    families = {
        "family": str(params.get("familyName") or "FONTYPE"),
        "style": str(params.get("styleName") or "Regular"),
    }

    ufo_path = ufo_writer.build_source_ufo(
        output_path=output_path,
        upm=upm,
        metrics=metrics if isinstance(metrics, dict) else {},
        family_name=families["family"],
        style_name=families["style"],
        glyphs=resolved,
        groups=groups,
        metadata=metadata,
    )

    anchor_count = sum(len(glyph.anchors) for glyph in resolved)
    return {
        "ok": True,
        "outputPath": str(ufo_path.resolve()),
        "glyphCount": len(resolved),
        "mappedCodepoints": len(mapped),
        "anchorCount": anchor_count,
        "groupCount": len(groups),
        "skippedSlots": skipped,
        "glyphNames": names,
    }
