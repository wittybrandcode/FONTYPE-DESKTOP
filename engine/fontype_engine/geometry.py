"""Defensive SVG parsing and conversion into font-unit outline geometry.

The slot, not the file name, supplies glyph identity. This module only returns
geometry plus structured findings; it never names or maps a glyph.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from defusedxml import ElementTree as SafeET
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

from .protocol import EngineError

MAX_SVG_BYTES = 10 * 1024 * 1024
MAX_PATHS = 256

Matrix = tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

_NUMBER = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
_TRANSFORM = re.compile(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)")
_UNIT = re.compile(r"([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)")

_SKIP_TAGS = {"defs", "clippath", "mask", "pattern", "symbol", "metadata", "style"}
_UNSUPPORTED_HARD = {
    "text": "النص الحي غير مدعوم؛ حوّله إلى مسارات (Outlines) في Illustrator.",
    "image": "الصور النقطية غير مدعومة داخل SVG الخط.",
    "script": "السكربتات مرفوضة لأسباب أمنية.",
    "foreignobject": "العناصر الخارجية غير مدعومة.",
    "use": "مراجع use غير مدعومة؛ انسخ المسار مباشرة.",
}
_UNSUPPORTED_SOFT = {
    "filter": "الفلاتر غير مدعومة؛ اسحب التأثيرات (Expand Appearance).",
    "mask": "الأقنعة غير مدعومة؛ استخدم مسارات مركّبة.",
    "pattern": "الأنماط غير مدعومة.",
    "rect": "الأشكال الأساسية غير مدعومة؛ حوّلها إلى مسار.",
    "circle": "الأشكال الأساسية غير مدعومة؛ حوّلها إلى مسار.",
    "ellipse": "الأشكال الأساسية غير مدعومة؛ حوّلها إلى مسار.",
    "polygon": "الأشكال الأساسية غير مدعومة؛ حوّلها إلى مسار.",
    "polyline": "الأشكال الأساسية غير مدعومة؛ حوّلها إلى مسار.",
    "line": "الأشكال الأساسية غير مدعومة؛ حوّلها إلى مسار.",
}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _finding(severity: str, code: str, message: str) -> dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def compose(left: Matrix, right: Matrix) -> Matrix:
    """Return left ∘ right (apply right first, then left)."""
    a1, b1, c1, d1, e1, f1 = left
    a2, b2, c2, d2, e2, f2 = right
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def transform_point(matrix: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def parse_transform(value: str | None) -> Matrix:
    if not value:
        return IDENTITY
    result = IDENTITY
    for name, raw_args in _TRANSFORM.findall(value):
        args = [float(n) for n in _NUMBER.findall(raw_args)]
        if name == "matrix" and len(args) >= 6:
            part = tuple(args[:6])
        elif name == "translate":
            part = (1.0, 0.0, 0.0, 1.0, args[0], args[1] if len(args) > 1 else 0.0)
        elif name == "scale":
            sx = args[0]
            sy = args[1] if len(args) > 1 else sx
            part = (sx, 0.0, 0.0, sy, 0.0, 0.0)
        elif name == "rotate" and args:
            angle = math.radians(args[0])
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            rotation = (cos_a, sin_a, -sin_a, cos_a, 0.0, 0.0)
            if len(args) >= 3:
                cx, cy = args[1], args[2]
                part = compose(
                    compose((1, 0, 0, 1, cx, cy), rotation), (1, 0, 0, 1, -cx, -cy)
                )
            else:
                part = rotation
        elif name == "skewX" and args:
            part = (1.0, 0.0, math.tan(math.radians(args[0])), 1.0, 0.0, 0.0)
        elif name == "skewY" and args:
            part = (1.0, math.tan(math.radians(args[0])), 0.0, 1.0, 0.0, 0.0)
        else:
            continue
        result = compose(result, part)
    return result


def _parse_length(value: str | None) -> float | None:
    if not value:
        return None
    match = _UNIT.fullmatch(value.strip())
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2)
    if unit and unit not in {"px", ""}:
        return None
    return number


@dataclass
class ParsedSvg:
    view_box: tuple[float, float, float, float]
    width: float
    height: float
    paths: list[tuple[str, str | None]] = field(default_factory=list)
    findings: list[dict[str, str]] = field(default_factory=list)


def read_svg_bytes(data: bytes) -> str:
    if len(data) > MAX_SVG_BYTES:
        raise EngineError(
            "SVG_TOO_LARGE",
            f"حجم الملف أكبر من الحد المسموح ({MAX_SVG_BYTES // 1024 // 1024} ميجابايت).",
        )
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise EngineError("SVG_ENCODING", "ترميز الملف ليس UTF-8 صالحاً.") from exc


def parse_svg_document(text: str) -> ParsedSvg:
    try:
        root = SafeET.fromstring(text)
    except Exception as exc:  # defusedxml raises several exception types
        raise EngineError(
            "SVG_MALFORMED", "تعذّر قراءة SVG؛ تأكد من سلامة الملف."
        ) from exc

    if _local(root.tag) != "svg":
        raise EngineError("SVG_NOT_SVG", "العنصر الجذري ليس SVG.")

    findings: list[dict[str, str]] = []
    view_box_raw = root.attrib.get("viewBox")
    view_box: tuple[float, float, float, float] | None = None
    if view_box_raw:
        parts = [float(n) for n in _NUMBER.findall(view_box_raw)]
        if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
            view_box = tuple(parts)
        else:
            findings.append(
                _finding(
                    "warning", "BAD_VIEWBOX", "viewBox غير صالح؛ سيُشتق من width/height."
                )
            )

    width = _parse_length(root.attrib.get("width"))
    height = _parse_length(root.attrib.get("height"))
    if view_box is None:
        if width and height:
            view_box = (0.0, 0.0, width, height)
        else:
            raise EngineError(
                "SVG_NO_VIEWBOX", "الملف لا يحتوي viewBox أو أبعاداً صالحة."
            )
    _, _, vb_width, vb_height = view_box
    if width is None:
        width = vb_width
    if height is None:
        height = vb_height
    if abs(width - vb_width) > 0.01 or abs(height - vb_height) > 0.01:
        findings.append(
            _finding(
                "warning",
                "VIEWBOX_MISMATCH",
                "أبعاد SVG لا تطابق viewBox؛ سيُعتمد viewBox.",
            )
        )

    paths: list[tuple[str, str | None]] = []

    def walk(element: Any, inherited_transform: str | None) -> None:
        for child in element:
            if not isinstance(child.tag, str):
                continue
            tag = _local(child.tag)
            if tag in _SKIP_TAGS:
                continue
            transform = child.attrib.get("transform")
            combined = (
                f"{inherited_transform} {transform}".strip()
                if inherited_transform and transform
                else (transform or inherited_transform)
            )
            if tag == "path":
                d = child.attrib.get("d")
                if d:
                    paths.append((d, combined))
                else:
                    findings.append(
                        _finding("warning", "EMPTY_PATH", "مسار فارغ تجاهلته.")
                    )
            elif tag in _UNSUPPORTED_HARD:
                findings.append(
                    _finding(
                        "error", f"UNSUPPORTED_{tag.upper()}", _UNSUPPORTED_HARD[tag]
                    )
                )
            elif tag in _UNSUPPORTED_SOFT:
                findings.append(
                    _finding(
                        "warning", f"UNSUPPORTED_{tag.upper()}", _UNSUPPORTED_SOFT[tag]
                    )
                )
            if child.attrib.get("stroke") and child.attrib.get("stroke") != "none":
                findings.append(
                    _finding(
                        "warning",
                        "UNEXPANDED_STROKE",
                        "يوجد stroke غير موسّع؛ قد لا يظهر في الخط.",
                    )
                )
            walk(child, combined)

    walk(root, None)

    if any(f["severity"] == "error" for f in findings):
        raise EngineError(
            "SVG_UNSUPPORTED_CONTENT",
            "المحتوى يحتوي عناصر غير مدعومة؛ راجع قائمة الملاحظات.",
            {"findings": findings},
        )
    if not paths:
        raise EngineError("SVG_NO_PATHS", "لم يتم العثور على أي مسار متجهي في الملف.")
    if len(paths) > MAX_PATHS:
        raise EngineError(
            "SVG_TOO_MANY_PATHS", f"عدد المسارات يتجاوز الحد ({MAX_PATHS})."
        )

    return ParsedSvg(view_box, width, height, paths, findings)


def base_matrix(
    parsed: ParsedSvg,
    upm: int,
    mode: str = "fit_to_em",
    *,
    fit_ratio: float = 0.7,
    reference_height: float | None = None,
    manual_scale: float | None = None,
) -> Matrix:
    """Map viewBox space to font space, baseline at viewBox bottom."""
    min_x, min_y, _, vb_height = parsed.view_box
    if vb_height <= 0:
        raise EngineError("SVG_BAD_HEIGHT", "ارتفاع viewBox غير صالح.")
    if mode == "fit_to_em":
        scale = (upm * fit_ratio) / vb_height
    elif mode == "fit_to_reference_height":
        if not reference_height or reference_height <= 0:
            raise EngineError("NO_REFERENCE_HEIGHT", "لم يتم تحديد ارتفاع مرجعي.")
        scale = reference_height / vb_height
    elif mode == "manual_scale":
        if not manual_scale or manual_scale <= 0:
            raise EngineError("NO_MANUAL_SCALE", "مقياس Manual Scale غير صالح.")
        scale = manual_scale
    elif mode == "preserve_size":
        scale = upm / vb_height
    else:
        raise EngineError("UNKNOWN_IMPORT_MODE", f"وضع استيراد غير معروف: {mode}")
    return (scale, 0.0, 0.0, -scale, -min_x * scale, (min_y + vb_height) * scale)


@dataclass
class Outline:
    pen: RecordingPen
    bounds: tuple[float, float, float, float]
    contour_count: int
    segment_count: int
    findings: list[dict[str, str]]
    matrix: Matrix


def build_outline_entries(
    entries: list[tuple[ParsedSvg, Matrix]],
    *,
    advance_width: float,
    align_baseline: bool = True,
    center_in_advance: bool = True,
) -> Outline:
    """Merge several parsed sources into one baseline-aligned font outline.

    Each source keeps its own viewBox-to-font transform; a single global shift
    then centers the union of all shapes in the advance width. The first source
    matrix is reported for informational import metadata.
    """
    if not entries:
        raise EngineError("SVG_NO_PATHS", "لم يتم العثور على أي مسار متجهي في الملف.")

    merged = RecordingPen()
    findings: list[dict[str, str]] = []
    contour_count = 0
    segment_count = 0
    representative_matrix: Matrix = IDENTITY

    for index, (parsed, matrix) in enumerate(entries):
        if index == 0:
            representative_matrix = matrix
        findings.extend(parsed.findings)
        for d, transform in parsed.paths:
            local_pen = RecordingPen()
            effective = compose(matrix, parse_transform(transform))
            try:
                parse_path(d, TransformPen(local_pen, effective))
            except Exception as exc:
                raise EngineError(
                    "SVG_BAD_PATH", "أحد المسارات غير صالح أو يحتوي أمراً غير مدعوم."
                ) from exc

            open_contour = False
            local_contours = 0
            for operation, _args in local_pen.value:
                if operation == "moveTo":
                    if open_contour:
                        findings.append(
                            _finding(
                                "warning",
                                "OPEN_CONTOUR",
                                "مسار مفتوح؛ سيُغلق عند التحويل.",
                            )
                        )
                    open_contour = True
                    local_contours += 1
                elif operation == "closePath":
                    open_contour = False
                elif operation in {"lineTo", "curveTo", "qCurveTo"}:
                    segment_count += 1
            if open_contour:
                findings.append(
                    _finding(
                        "warning", "OPEN_CONTOUR", "مسار مفتوح؛ سيُغلق عند التحويل."
                    )
                )
            contour_count += local_contours
            merged.value.extend(local_pen.value)

    bounds_pen = BoundsPen(None)
    merged.replay(bounds_pen)
    if bounds_pen.bounds is None:
        raise EngineError("SVG_EMPTY_GEOMETRY", "المسارات لا تنتج هندسة مرئية.")
    x_min, y_min, x_max, y_max = bounds_pen.bounds

    dx = advance_width / 2 - (x_min + x_max) / 2 if center_in_advance else 0.0
    dy = -y_min if align_baseline else 0.0
    if dx or dy:
        shifted = RecordingPen()
        for operation, args in merged.value:
            if operation == "moveTo":
                point = args[0]
                args = ((point[0] + dx, point[1] + dy),)
            elif operation in {"lineTo", "curveTo", "qCurveTo"}:
                args = tuple(
                    (point[0] + dx, point[1] + dy)
                    if isinstance(point, tuple)
                    else point
                    for point in args
                )
            shifted.value.append((operation, args))
        merged = shifted
        final_matrix = compose((1, 0, 0, 1, dx, dy), representative_matrix)
        x_min += dx
        x_max += dx
        y_min += dy
        y_max += dy
    else:
        final_matrix = representative_matrix

    return Outline(
        pen=merged,
        bounds=(x_min, y_min, x_max, y_max),
        contour_count=contour_count,
        segment_count=segment_count,
        findings=findings,
        matrix=final_matrix,
    )


def build_outline(
    parsed: ParsedSvg,
    matrix: Matrix,
    *,
    advance_width: float,
    align_baseline: bool = True,
    center_in_advance: bool = True,
) -> Outline:
    return build_outline_entries(
        [(parsed, matrix)],
        advance_width=advance_width,
        align_baseline=align_baseline,
        center_in_advance=center_in_advance,
    )
