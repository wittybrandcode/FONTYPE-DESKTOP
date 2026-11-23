"""Phase 0B headless vertical slice.

One SVG -> normalized geometry -> UFO -> OTF/TTF -> table inspection -> HarfBuzz.
This deliberately uses a single glyph. Contextual shaping rules arrive in Phase 4;
the purpose here is to de-risk the compiler and coordinate pipeline.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

from . import geometry, ufo_writer
from .protocol import EngineError

Progress = Callable[[str, dict[str, Any]], None]


def _emit_progress(emit: Progress, value: float, message: str, **extra: Any) -> None:
    emit("progress", {"value": value, "message": message, **extra})


def _find_artifacts(out_dir: Path) -> dict[str, Path]:
    otf = sorted(out_dir.rglob("*.otf"))
    ttf = sorted(out_dir.rglob("*.ttf"))
    result: dict[str, Path] = {}
    if otf:
        result["otf"] = otf[0]
    if ttf:
        result["ttf"] = ttf[0]
    return result


def _inspect(path: Path, codepoint: int) -> dict[str, Any]:
    font = TTFont(path, lazy=True)
    try:
        cmap = font.getBestCmap() or {}
        tables = set(font.keys())
        return {
            "file": path.name,
            "tables": sorted(tables),
            "unitsPerEm": font["head"].unitsPerEm if "head" in font else None,
            "hasCmap": "cmap" in tables,
            "hasOutlines": "glyf" in tables or "CFF " in tables,
            "mapsCodepoint": codepoint in cmap,
            "mappedGlyph": cmap.get(codepoint),
            "hasGDEF": "GDEF" in tables,
        }
    finally:
        font.close()


def _shape(path: Path, text: str) -> dict[str, Any]:
    import uharfbuzz as hb

    face = hb.Face(path.read_bytes())
    font = hb.Font(face)
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(font, buffer)
    glyph_names: list[str] = []
    for info in buffer.glyph_infos:
        try:
            glyph_names.append(font.glyph_to_string(info.codepoint))
        except Exception:  # older uharfbuzz builds
            glyph_names.append(str(info.codepoint))
    return {"text": text, "glyphs": glyph_names, "count": len(glyph_names)}


def run_spike(job_id: str, params: dict[str, Any], emit: Progress) -> dict[str, Any]:
    del job_id  # the host already attaches the job id to every event
    svg_path = Path(str(params.get("svgPath") or ""))
    out_dir = Path(str(params.get("outputDir") or ""))
    if not svg_path.is_file():
        raise EngineError("SVG_NOT_FOUND", "لم يتم العثور على ملف SVG.")
    if not str(out_dir):
        raise EngineError("NO_OUTPUT_DIR", "لم يتم تحديد مجلد الإخراج.")

    upm = int(params.get("upm") or 1000)
    ascender = int(params.get("ascender") or round(upm * 0.8))
    descender = int(params.get("descender") or -round(upm * 0.25))
    advance_width = float(params.get("advanceWidth") or upm * 0.6)
    family_name = str(params.get("familyName") or "FONTYPE Test")
    style_name = str(params.get("styleName") or "Regular")
    unicode_value = int(str(params.get("unicode") or "U+0628").replace("U+", ""), 16)
    glyph_name = str(params.get("glyphName") or "beh.isol")
    mode = str(params.get("importMode") or "fit_to_em")
    fit_ratio = float(params.get("fitRatio") or 0.7)
    reference_height = params.get("referenceHeight")
    manual_scale = params.get("manualScale")

    _emit_progress(emit, 0.05, "قراءة ملف SVG")
    parsed = geometry.parse_svg_document(geometry.read_svg_bytes(svg_path.read_bytes()))

    _emit_progress(emit, 0.15, "تحويل الإحداثيات إلى وحدات الخط")
    base = geometry.base_matrix(
        parsed,
        upm,
        mode,
        fit_ratio=fit_ratio,
        reference_height=float(reference_height) if reference_height else None,
        manual_scale=float(manual_scale) if manual_scale else None,
    )
    outline = geometry.build_outline(parsed, base, advance_width=advance_width)

    _emit_progress(emit, 0.3, "كتابة مصدر UFO")
    ufo_path = out_dir / "source.ufo"
    ufo_writer.build_ufo(
        output_path=ufo_path,
        upm=upm,
        ascender=ascender,
        descender=descender,
        family_name=family_name,
        style_name=style_name,
        glyphs={
            "space": (RecordingPen(), advance_width, 0x0020),
            glyph_name: (outline.pen, advance_width, unicode_value),
        },
    )

    _emit_progress(emit, 0.42, "تجميع OTF و TTF")
    command = [
        sys.executable,
        "-m",
        "fontmake",
        "-u",
        str(ufo_path),
        "-o",
        "otf",
        "ttf",
        "--output-dir",
        str(out_dir),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        raise EngineError("COMPILER_START_FAILED", "تعذّر تشغيل fontmake.") from exc
    log_lines = (completed.stdout + "\n" + completed.stderr).splitlines()
    emit("log", {"lines": log_lines[-25:]})
    if completed.returncode != 0:
        raise EngineError(
            "BUILD_FAILED",
            "فشل تجميع الخط. راجع سجل المحرك.",
            {"compilerLog": log_lines[-25:]},
        )

    artifacts = _find_artifacts(out_dir)
    if set(artifacts) != {"otf", "ttf"}:
        raise EngineError("BUILD_ARTIFACTS_MISSING", "لم يُنتج المترجم ملفي OTF و TTF.")

    _emit_progress(emit, 0.75, "فحص جداول الخط")
    inspection = {fmt: _inspect(path, unicode_value) for fmt, path in artifacts.items()}

    _emit_progress(emit, 0.88, "اختبار التشكيل بـ HarfBuzz")
    text = chr(unicode_value)
    shaping = _shape(artifacts["ttf"], text)

    findings = list(outline.findings)
    checks = {
        "tablesPresent": all(
            item["hasCmap"] and item["hasOutlines"] for item in inspection.values()
        ),
        "codepointMapped": all(item["mapsCodepoint"] for item in inspection.values()),
        "unitsPerEmMatches": all(
            item["unitsPerEm"] == upm for item in inspection.values()
        ),
        "shapingReturnsGlyph": shaping["count"] > 0
        and shaping["glyphs"][0] == glyph_name,
    }
    success = all(checks.values())

    _emit_progress(emit, 1.0, "اكتمل الاختبار الرأسي")
    return {
        "success": success,
        "checks": checks,
        "artifacts": {key: str(value) for key, value in artifacts.items()},
        "geometry": {
            "bounds": list(outline.bounds),
            "contours": outline.contour_count,
            "segments": outline.segment_count,
            "matrix": list(outline.matrix),
        },
        "inspection": inspection,
        "shaping": shaping,
        "findings": findings,
        "compilerLog": log_lines[-25:],
    }
