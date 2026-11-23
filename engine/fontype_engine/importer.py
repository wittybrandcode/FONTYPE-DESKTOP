"""SVG inspection contract used by the slot-by-slot importer.

Identity comes from the destination slot in the host application; this module
only parses artwork, normalizes it into font units and returns a preview plus
structured findings.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from fontTools.pens.svgPathPen import SVGPathPen

from . import geometry
from .protocol import EngineError


def inspect_svg(params: dict[str, Any]) -> dict[str, Any]:
    svg_path = Path(str(params.get("svgPath") or ""))
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

    preview_pen = SVGPathPen(None)
    outline.pen.replay(preview_pen)
    findings = outline.findings
    has_error = any(item["severity"] == "error" for item in findings)

    return {
        "ok": not has_error,
        "sourceFileName": svg_path.name,
        "sourcePath": str(svg_path.resolve()),
        "contentHash": "sha256:" + hashlib.sha256(data).hexdigest(),
        "byteSize": len(data),
        "viewBox": list(parsed.view_box),
        "width": parsed.width,
        "height": parsed.height,
        "bounds": list(outline.bounds),
        "contours": outline.contour_count,
        "segments": outline.segment_count,
        "matrix": list(outline.matrix),
        "scale": outline.matrix[0],
        "findings": findings,
        "previewPath": preview_pen.getCommands(),
        "requiresManualReview": any(item["severity"] != "info" for item in findings),
    }
