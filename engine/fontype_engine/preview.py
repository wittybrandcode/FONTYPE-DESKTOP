"""Local HarfBuzz preview and shaping test corpus runner."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .protocol import EngineError


def _data_file(name: str) -> Path:
    return Path(__file__).resolve().parent.parent / "data" / name


def slot_map(params: dict[str, Any]) -> dict[str, str]:
    supplied = params.get("glyphMap")
    if isinstance(supplied, dict):
        return {str(key): str(value) for key, value in supplied.items()}
    result: dict[str, str] = {}
    for record in params.get("glyphs") or []:
        if isinstance(record, dict) and record.get("glyphName"):
            result[str(record["glyphName"])] = str(
                record.get("slotId") or record["glyphName"]
            )
    return result


def _shape(face_data: bytes, text: str, mapping: dict[str, str]) -> dict[str, Any]:
    import uharfbuzz as hb

    face = hb.Face(face_data)
    font = hb.Font(face)
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(font, buffer)

    glyphs: list[dict[str, Any]] = []
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        try:
            name = font.glyph_to_string(info.codepoint)
        except Exception:  # older uharfbuzz builds
            name = str(info.codepoint)
        glyphs.append(
            {
                "name": name,
                "slotId": mapping.get(name),
                "cluster": info.cluster,
                "xAdvance": position.x_advance,
                "yAdvance": position.y_advance,
                "xOffset": position.x_offset,
                "yOffset": position.y_offset,
            }
        )
    return {
        "text": text,
        "glyphs": glyphs,
        "names": [glyph["name"] for glyph in glyphs],
        "count": len(glyphs),
        "direction": str(getattr(buffer, "direction", "") or ""),
    }


def shape_preview(params: dict[str, Any]) -> dict[str, Any]:
    font_path = Path(str(params.get("fontPath") or ""))
    if not font_path.is_file():
        raise EngineError("FONT_NOT_FOUND", "لم يتم العثور على ملف الخط المجمّع.")
    text = str(params.get("text") or "")
    if not text.strip():
        return {"ok": True, "text": text, "modes": [], "totalGlyphs": 0}

    mapping = slot_map(params)
    mode = str(params.get("mode") or "all")
    modes = ["character", "word", "paragraph"] if mode == "all" else [mode]
    data = font_path.read_bytes()
    results: list[dict[str, Any]] = []
    for selected in modes:
        if selected == "character":
            chunks = [character for character in text if not character.isspace()]
        elif selected == "word":
            chunks = text.split()
        else:
            chunks = [text]
        segments = [_shape(data, chunk, mapping) for chunk in chunks]
        results.append(
            {
                "mode": selected,
                "segments": segments,
                "glyphs": [
                    glyph for segment in segments for glyph in segment["glyphs"]
                ],
            }
        )
    return {
        "ok": True,
        "text": text,
        "modes": results,
        "totalGlyphs": sum(len(mode_result["glyphs"]) for mode_result in results),
    }


def _contains_sequence(haystack: list[str], needle: list[str]) -> bool:
    if not needle:
        return True
    for index in range(len(haystack) - len(needle) + 1):
        if haystack[index : index + len(needle)] == needle:
            return True
    return False


def run_corpus(params: dict[str, Any]) -> dict[str, Any]:
    font_path = Path(str(params.get("fontPath") or ""))
    if not font_path.is_file():
        raise EngineError("FONT_NOT_FOUND", "لم يتم العثور على ملف الخط المجمّع.")
    corpus_text = str(params.get("corpusPath") or "").strip()
    corpus_path = (
        Path(corpus_text) if corpus_text else _data_file("shaping-corpus.json")
    )
    if not corpus_path.is_file():
        raise EngineError(
            "CORPUS_NOT_FOUND", "لم يتم العثور على مجموعة اختبار التشكيل."
        )
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    mapping = slot_map(params)
    available = set(mapping)
    font_data = font_path.read_bytes()

    results: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    for case in corpus.get("cases", []):
        required = list(case.get("expectGlyphs") or [])
        alternate = list(case.get("alternateGlyphs") or [])
        # Only the required forms decide whether a case can run at all.
        # Alternate glyphs (for example an optional lam-alef ligature) are a
        # valid outcome when present, but their absence must not skip a case
        # that can pass with the base forms.
        missing_artwork = [name for name in required if name not in available]
        if missing_artwork:
            if case.get("optional"):
                status = "skipped"
                reason = "رسوم هذه الحالة غير مستوردة بعد."
            else:
                status = "skipped"
                reason = "الخطوط المطلوبة لهذه الحالة غير مستوردة بعد."
            results.append(
                {
                    "id": case.get("id"),
                    "label": case.get("label"),
                    "text": case.get("text"),
                    "status": status,
                    "reason": reason,
                    "missingGlyphs": missing_artwork,
                }
            )
            continue

        shaped = _shape(font_data, str(case.get("text") or ""), mapping)
        names = shaped["names"]
        missing = [name for name in required if name not in names]
        forbidden = [
            name for name in case.get("expectNotGlyphs") or [] if name in names
        ]
        sequence = list(case.get("expectSequence") or [])
        sequence_ok = _contains_sequence(names, sequence)
        alternate_ok = bool(alternate) and any(name in names for name in alternate)
        passed = not missing and not forbidden and sequence_ok
        if alternate and missing and alternate_ok:
            missing = []
            passed = True
        if not passed:
            findings.append(
                {
                    "severity": "warning",
                    "code": "SHAPING_CORPUS_CASE_FAILED",
                    "message": f"اختبار «{case.get('label') or case.get('id')}» لم يُنتج الشكل المتوقع.",
                    "hint": (
                        "الترتيب بصري من اليمين لليسار: "
                        + (" ".join(names) or "(فارغ)")
                    ),
                    "slotId": "",
                }
            )
        results.append(
            {
                "id": case.get("id"),
                "label": case.get("label"),
                "text": case.get("text"),
                "status": "pass" if passed else "fail",
                "expected": required,
                "actual": names,
                "missing": missing,
                "forbidden": forbidden,
            }
        )

    totals = {
        "pass": sum(1 for item in results if item["status"] == "pass"),
        "fail": sum(1 for item in results if item["status"] == "fail"),
        "skipped": sum(1 for item in results if item["status"] == "skipped"),
    }
    return {
        "ok": totals["fail"] == 0,
        "corpusId": corpus.get("corpusId"),
        "results": results,
        "totals": totals,
        "findings": findings,
    }
