"""SVG inspection contract used by the slot-by-slot importer.

Identity comes from the destination slot in the host application; this module
only parses artwork, normalizes it into font units and returns a preview plus
structured findings. Several SVG files may be supplied as one inspection; they
are merged into a single normalized SVG so the project schema stays unchanged.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from typing import Any

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

from . import geometry
from .protocol import EngineError


def _payload(
    *,
    source_file_name: str,
    source_path: Path,
    data: bytes,
    view_box: list[float],
    width: float,
    height: float,
    outline: geometry.Outline,
    extra_findings: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    preview_pen = SVGPathPen(None)
    outline.pen.replay(preview_pen)
    findings = list(outline.findings)
    if extra_findings:
        findings.extend(extra_findings)
    has_error = any(item["severity"] == "error" for item in findings)
    return {
        "ok": not has_error,
        "sourceFileName": source_file_name,
        "sourcePath": str(source_path.resolve()),
        "contentHash": "sha256:" + hashlib.sha256(data).hexdigest(),
        "byteSize": len(data),
        "viewBox": list(view_box),
        "width": width,
        "height": height,
        "bounds": list(outline.bounds),
        "contours": outline.contour_count,
        "segments": outline.segment_count,
        "matrix": list(outline.matrix),
        "scale": outline.matrix[0],
        "findings": findings,
        "previewPath": preview_pen.getCommands(),
        "requiresManualReview": any(item["severity"] != "info" for item in findings),
    }


def _normalize_svg(outline: geometry.Outline, upm: int) -> tuple[bytes, float]:
    """Write the merged outline in font units using SVG y-down coordinates.

    A `preserve_size` re-inspection of the resulting viewBox reproduces the
    stored previewPath exactly, so no new project fields are needed.
    """
    svg_pen = SVGPathPen(None)
    outline.pen.replay(TransformPen(svg_pen, (1.0, 0.0, 0.0, -1.0, 0.0, float(upm))))
    path_data = svg_pen.getCommands()
    width = max(float(upm), float(outline.bounds[2]) + float(upm) * 0.05)
    text = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{upm:g}" '
        f'viewBox="0 0 {width:g} {upm:g}">'
        f'<path d="{path_data}"/>'
        "</svg>\n"
    )
    return text.encode("utf-8"), width


def _write_combined_svg(data: bytes, count: int) -> Path:
    digest = hashlib.sha256(data).hexdigest()[:16]
    path = Path(tempfile.gettempdir()) / f"fontype-combined-{count}-{digest}.svg"
    path.write_bytes(data)
    return path


def inspect_svg(params: dict[str, Any]) -> dict[str, Any]:
    raw_paths = params.get("svgPaths")
    if isinstance(raw_paths, list) and len(raw_paths) > 1:
        return _inspect_multiple([str(item) for item in raw_paths], params)

    svg_path = Path(str(params.get("svgPath") or ""))
    if not svg_path.is_file() and isinstance(raw_paths, list) and raw_paths:
        svg_path = Path(str(raw_paths[0]))
    if not svg_path.is_file():
        raise EngineError("SVG_NOT_FOUND", "لم يتم العثور على ملف SVG.")

    data = svg_path.read_bytes()
    parsed = geometry.parse_svg_document(geometry.read_svg_bytes(data))
    upm = int(params.get("upm") or 1000)
    mode = str(params.get("mode") or "fit_to_em")
    advance_width = float(params.get("advanceWidth") or upm * 0.6)
    fit_ratio = float(params.get("fitRatio") or 0.7)
    reference_height = params.get("referenceHeight")
    manual_scale = params.get("manualScale")

    matrix = geometry.base_matrix(
        parsed,
        upm,
        mode,
        fit_ratio=fit_ratio,
        reference_height=float(reference_height) if reference_height else None,
        manual_scale=float(manual_scale) if manual_scale else None,
    )
    outline = geometry.build_outline(parsed, matrix, advance_width=advance_width)

    return _payload(
        source_file_name=svg_path.name,
        source_path=svg_path,
        data=data,
        view_box=list(parsed.view_box),
        width=parsed.width,
        height=parsed.height,
        outline=outline,
    )


def _inspect_multiple(paths: list[str], params: dict[str, Any]) -> dict[str, Any]:
    upm = int(params.get("upm") or 1000)
    advance_width = float(params.get("advanceWidth") or upm * 0.6)
    fit_ratio = float(params.get("fitRatio") or 0.7)

    entries: list[tuple[geometry.ParsedSvg, geometry.Matrix]] = []
    names: list[str] = []
    for raw in paths:
        svg_path = Path(raw)
        if not svg_path.is_file():
            raise EngineError("SVG_NOT_FOUND", "لم يتم العثور على أحد ملفات SVG.")
        data = svg_path.read_bytes()
        parsed = geometry.parse_svg_document(geometry.read_svg_bytes(data))
        matrix = geometry.base_matrix(
            parsed,
            upm,
            "fit_to_em",
            fit_ratio=fit_ratio,
        )
        entries.append((parsed, matrix))
        names.append(svg_path.name)

    outline = geometry.build_outline_entries(entries, advance_width=advance_width)
    combined, width = _normalize_svg(outline, upm)
    destination = _write_combined_svg(combined, len(entries))
    finding = {
        "severity": "info",
        "code": "MULTI_SVG_COMBINED",
        "message": f"تم دمج {len(entries)} ملفات SVG في خانة واحدة: {', '.join(names)}.",
    }
    return _payload(
        source_file_name=f"combined-{len(entries)}-shapes.svg",
        source_path=destination,
        data=combined,
        view_box=[0.0, 0.0, width, float(upm)],
        width=width,
        height=float(upm),
        outline=outline,
        extra_findings=[finding],
    )
