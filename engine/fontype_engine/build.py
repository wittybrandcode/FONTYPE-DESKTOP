"""Phase 4 font compilation orchestrator.

Resolves the persisted project into a UFO, injects generated Arabic features,
compiles OTF and TTF with fontmake, inspects the required tables, runs a
HarfBuzz smoke test, and writes a reproducible build report.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any

from fontTools.ttLib import TTFont

from . import features as feature_generator
from . import preview, source, ufo_writer
from .protocol import EngineError

Progress = Callable[[str, dict[str, Any]], None]

REQUIRED_TABLES = ("head", "hhea", "hmtx", "maxp", "name", "OS/2", "cmap")


def _progress(emit: Progress, value: float, message: str, **extra: Any) -> None:
    emit("progress", {"value": value, "message": message, **extra})


def _version(package: str) -> str:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return "unknown"


def _project_hash(params: dict[str, Any]) -> str:
    project_file = Path(str(params.get("projectPath") or "")) / "project.json"
    if project_file.is_file():
        digest = hashlib.sha256(project_file.read_bytes())
    else:
        payload = json.dumps(params, sort_keys=True, ensure_ascii=False).encode("utf-8")
        digest = hashlib.sha256(payload)
    return f"sha256:{digest.hexdigest()}"


def _find_artifacts(out_dir: Path) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for fmt, suffix in (("otf", "*.otf"), ("ttf", "*.ttf")):
        candidates = sorted(out_dir.rglob(suffix))
        if candidates:
            result[fmt] = candidates[0]
    return result


def _feature_tags(font: TTFont, table: str) -> list[str]:
    try:
        records = font[table].table.FeatureList.FeatureRecord
    except (KeyError, AttributeError):
        return []
    return sorted({str(record.FeatureTag) for record in records})


def _inspect(path: Path, model: source.ResolvedProject) -> dict[str, Any]:
    font = TTFont(path, lazy=True)
    try:
        cmap = font.getBestCmap() or {}
        tables = set(font.keys())
        expected = set(model.mapped_codepoints)
        mapped = all(codepoint in cmap for codepoint in expected)
        return {
            "file": path.name,
            "tables": sorted(tables),
            "unitsPerEm": font["head"].unitsPerEm if "head" in font else None,
            "hasCmap": "cmap" in tables,
            "hasOutlines": "glyf" in tables or "CFF " in tables or "CFF2" in tables,
            "hasGDEF": "GDEF" in tables,
            "missingTables": [name for name in REQUIRED_TABLES if name not in tables],
            "mappedCodepoints": len(expected.intersection(cmap)),
            "expectedCodepoints": len(expected),
            "allCodepointsMapped": mapped,
            "gsubFeatures": _feature_tags(font, "GSUB"),
            "gposFeatures": _feature_tags(font, "GPOS"),
        }
    finally:
        font.close()


def _checks(
    inspection: dict[str, dict[str, Any]],
    model: source.ResolvedProject,
    feature_result: feature_generator.FeatureResult,
) -> dict[str, bool]:
    values = list(inspection.values())
    expected_features = set(feature_result.stats.get("features") or [])
    gsub_tags = {tag for item in values for tag in item.get("gsubFeatures", [])}
    return {
        "artifactsPresent": set(inspection) == {"otf", "ttf"},
        "tablesPresent": all(not item["missingTables"] for item in values),
        "outlinesPresent": all(
            item["hasOutlines"] and item["hasCmap"] for item in values
        ),
        "unitsPerEmMatches": all(item["unitsPerEm"] == model.upm for item in values),
        "allCodepointsMapped": all(item["allCodepointsMapped"] for item in values),
        "formFeaturesPresent": expected_features.issubset(gsub_tags),
        "positioningTablesPresent": all(item["hasGDEF"] for item in values)
        and any(
            "curs" in item["gposFeatures"] or "mark" in item["gposFeatures"]
            for item in values
        )
        if model.anchor_count
        else all(item["hasGDEF"] for item in values),
        "shapingReturnsGlyphs": True,
    }


def build_font(params: dict[str, Any], emit: Progress) -> dict[str, Any]:
    out_text = str(params.get("outputDir") or "").strip()
    if not out_text:
        raise EngineError("NO_OUTPUT_DIR", "لم يتم تحديد مجلد الإخراج.")
    out_dir = Path(out_text)
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in list(out_dir.rglob("*.otf")) + list(out_dir.rglob("*.ttf")):
        stale.unlink(missing_ok=True)

    _progress(emit, 0.05, "قراءة بيانات المشروع")
    model = source.resolve_project(params)
    if not [glyph for glyph in model.glyphs if glyph.unicode_value is not None]:
        raise EngineError(
            "NO_MAPPED_GLYPHS",
            "لا توجد رسوم مستوردة لشكل مفرد يمكن ربطه بـ Unicode.",
        )

    _progress(emit, 0.16, "توليد قواعد التشكيل العربية")
    feature_result = feature_generator.generate(model, params.get("shaping") or {})

    _progress(emit, 0.26, "كتابة مصدر UFO")
    ufo_path = out_dir / "source" / "fontype.ufo"
    ufo_writer.build_source_ufo(
        output_path=ufo_path,
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

    _progress(emit, 0.38, "تجميع OTF و TTF")
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
    emit("log", {"lines": log_lines[-30:]})
    compiler_log = out_dir / "compiler.log"
    compiler_log.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
    if completed.returncode != 0:
        raise EngineError(
            "BUILD_FAILED",
            "فشل تجميع الخط. راجع سجل المترجم.",
            {"compilerLog": log_lines[-30:], "compilerLogPath": str(compiler_log)},
        )

    artifacts = _find_artifacts(out_dir)
    if set(artifacts) != {"otf", "ttf"}:
        raise EngineError("BUILD_ARTIFACTS_MISSING", "لم يُنتج المترجم ملفي OTF و TTF.")

    _progress(emit, 0.72, "فحص جداول الخط")
    inspection = {fmt: _inspect(path, model) for fmt, path in artifacts.items()}

    _progress(emit, 0.85, "اختبار التشكيل بـ HarfBuzz")
    smoke_text = "".join(chr(codepoint) for codepoint in model.mapped_codepoints[:6])
    shaping = preview.shape_preview(
        {
            "fontPath": str(artifacts["ttf"]),
            "text": smoke_text or " ",
            "mode": "paragraph",
            "glyphs": [],
        }
    )
    checks = _checks(inspection, model, feature_result)
    checks["shapingReturnsGlyphs"] = shaping["totalGlyphs"] > 0

    findings: list[dict[str, Any]] = list(feature_result.findings)
    for code, passed in checks.items():
        if not passed:
            findings.append(
                {
                    "severity": "error",
                    "code": f"BUILD_{code.upper()}",
                    "message": f"فحص البناء فشل: {code}",
                    "hint": "راجع سجل المترجم وتقرير البناء.",
                    "slotId": "",
                }
            )

    build_id = str(params.get("buildId") or "")
    if not build_id:
        build_id = datetime.now(timezone.utc).strftime("build-%Y%m%dT%H%M%SZ")
    report_path = (
        Path(str(params.get("reportPath") or "")) or out_dir / "build-report.json"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "schemaVersion": "0.1.0",
        "buildId": build_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "appVersion": str(params.get("appVersion") or "0.5.0"),
        "engineVersion": _version("fontype-engine"),
        "projectHash": _project_hash(params),
        "requestedFormats": ["otf", "ttf"],
        "toolchainVersions": {
            "python": sys.version.split()[0],
            "fontmake": _version("fontmake"),
            "fonttools": _version("fonttools"),
            "ufoLib2": _version("ufoLib2"),
            "uharfbuzz": _version("uharfbuzz"),
        },
        "source": {
            "ufoPath": str(ufo_path.resolve()),
            "glyphCount": len(model.glyphs),
            "anchorCount": model.anchor_count,
            "features": feature_result.stats,
            "featureText": feature_result.text,
        },
        "artifacts": {key: str(value.resolve()) for key, value in artifacts.items()},
        "inspection": inspection,
        "shaping": {"totalGlyphs": shaping["totalGlyphs"]},
        "checks": checks,
        "findings": findings,
        "compilerLogPath": str(compiler_log.resolve()),
        "success": all(checks.values()),
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    _progress(emit, 1.0, "اكتمل البناء")
    return {
        "ok": True,
        "success": report["success"],
        "buildId": build_id,
        "reportPath": str(report_path.resolve()),
        "compilerLogPath": str(compiler_log.resolve()),
        "sourcePath": str(ufo_path.resolve()),
        "artifacts": report["artifacts"],
        "inspection": inspection,
        "checks": checks,
        "findings": findings,
        "features": feature_result.stats,
        "featureText": feature_result.text,
        "projectHash": report["projectHash"],
        "toolchainVersions": report["toolchainVersions"],
    }
