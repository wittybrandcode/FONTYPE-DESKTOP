import json
import re
from pathlib import Path

from fontTools.ttLib import TTFont
from ufoLib2 import Font

from fontype_engine import build, preview


def glyph(
    name,
    form,
    unicode_value="",
    joining="D",
    anchors=None,
    group="letters",
    mark_class=None,
):
    record = {
        "slotId": name.replace(".", ".", 1),
        "glyphName": name,
        "unicode": unicode_value,
        "form": form,
        "joiningType": joining,
        "group": group,
        "characterName": name.split(".")[0],
        "previewPath": "M50 0 L250 0 L250 420 L50 420 Z",
        "placement": {},
        "advanceWidth": 600,
        "anchors": anchors or [],
    }
    if mark_class:
        record["markClass"] = mark_class
    return record


def base_anchors():
    return [
        {"name": "top", "class": "top", "x": 150, "y": 420},
        {"name": "bottom", "class": "bottom", "x": 150, "y": 0},
        {"name": "entry", "class": "cursive-entry", "x": 50, "y": 210},
        {"name": "exit", "class": "cursive-exit", "x": 250, "y": 210},
    ]


def params(tmp_path):
    glyphs = [
        glyph("beh.isol", "isolated", "U+0628", anchors=base_anchors()),
        glyph("beh.init", "initial", anchors=base_anchors()),
        glyph("beh.medi", "medial", anchors=base_anchors()),
        glyph("beh.fina", "final", anchors=base_anchors()),
        glyph(
            "fatha.isol",
            "isolated",
            "U+064E",
            joining="T",
            group="marks",
            mark_class="top",
            anchors=[{"name": "top-mark", "class": "top-mark", "x": 0, "y": 0}],
        ),
    ]
    return {
        "outputDir": str(tmp_path / "out"),
        "reportPath": str(tmp_path / "reports" / "build.json"),
        "upm": 1000,
        "familyName": "Test Arabic",
        "styleName": "Regular",
        "version": "1.025",
        "designer": "Test Designer",
        "copyright": "Copyright 2026 Test",
        "license": "OFL-1.1",
        "metrics": {"ascender": 800, "descender": -250, "capHeight": 700},
        "glyphs": glyphs,
        "shaping": {"lamAlefLigatures": False},
    }


def test_build_font_compiles_and_writes_report(tmp_path):
    events = []
    result = build.build_font(params(tmp_path), lambda kind, data: events.append(kind))

    assert result["success"] is True, result["checks"]
    assert set(result["artifacts"]) == {"otf", "ttf"}
    assert set(result["checks"].values()) == {True}
    assert result["features"]["features"] == ["init", "medi", "fina"]
    assert "progress" in events and "log" in events

    ufo = Font.open(result["sourcePath"])
    assert (ufo.info.versionMajor, ufo.info.versionMinor) == (1, 25)
    assert ufo.info.openTypeNameVersion == "1.025"
    assert ufo.info.openTypeNameDesigner == "Test Designer"
    assert ufo.info.copyright == "Copyright 2026 Test"
    assert ufo.info.openTypeNameLicense == "OFL-1.1"

    report_path = result["reportPath"]
    with open(report_path, encoding="utf-8") as handle:
        report = handle.read()
    assert '"buildId"' in report
    assert '"success": true' in report

    for path in result["artifacts"].values():
        font = TTFont(path, lazy=True)
        assert font["head"].unitsPerEm == 1000
        assert "GSUB" in font and "GPOS" in font and "GDEF" in font
        font.close()


def test_corpus_and_preview_use_compiled_font(tmp_path):
    result = build.build_font(params(tmp_path), lambda kind, data: None)
    ttf = result["artifacts"]["ttf"]
    glyphs = params(tmp_path)["glyphs"]

    shaped = preview.shape_preview(
        {"fontPath": ttf, "text": "بسب", "mode": "all", "glyphs": glyphs}
    )
    assert shaped["totalGlyphs"] >= 3
    assert [mode["mode"] for mode in shaped["modes"]] == [
        "character",
        "word",
        "paragraph",
    ]
    assert any(glyph["slotId"] for mode in shaped["modes"] for glyph in mode["glyphs"])

    connected = preview.shape_preview(
        {"fontPath": ttf, "text": "بب", "mode": "paragraph", "glyphs": glyphs}
    )
    connected_names = set(connected["modes"][0]["segments"][0]["names"])
    assert {"beh.init", "beh.fina"}.issubset(connected_names)

    corpus = preview.run_corpus({"fontPath": ttf, "glyphs": glyphs})
    beh_cases = [
        case
        for case in corpus["results"]
        if case["id"] in {"isolated_beh", "initial_beh", "medial_seen", "final_beh"}
    ]
    assert len(beh_cases) >= 2
    assert any(case["status"] != "skipped" for case in beh_cases)


def full_glyphs():
    """Synthesize artwork for every slot in the pinned Arabic core preset."""
    preset_path = Path(__file__).resolve().parent.parent / "data" / "arabic-core.json"
    preset = json.loads(preset_path.read_text(encoding="utf-8"))

    def slug(value):
        return re.sub(r"[^A-Za-z0-9]+", "", value).lower() or "glyph"

    def code(form):
        return {"initial": "init", "medial": "medi", "final": "fina"}.get(form, "isol")

    result = []
    for group in preset["groups"]:
        for character in group["characters"]:
            for form in preset["formsByJoiningType"][character["joiningType"]]:
                if group["id"] == "marks":
                    mark_class = (
                        "top" if character.get("markClass") == "top" else "bottom"
                    )
                    anchors = [
                        {
                            "name": f"{mark_class}-mark",
                            "class": f"{mark_class}-mark",
                            "x": 0,
                            "y": 0,
                        }
                    ]
                else:
                    anchors = base_anchors()
                result.append(
                    {
                        "slotId": f"{slug(character['name'])}.{form}",
                        "glyphName": f"{slug(character['name'])}.{code(form)}",
                        "unicode": (
                            character["u"]
                            if form in {"isolated", "base", "mark"}
                            else ""
                        ),
                        "form": form,
                        "joiningType": character["joiningType"],
                        "group": group["id"],
                        "markClass": character.get("markClass"),
                        "characterName": character["name"],
                        "previewPath": "M50 0 L250 0 L250 420 L50 420 Z",
                        "placement": {},
                        "advanceWidth": 600,
                        "anchors": anchors,
                    }
                )
    result.append(
        {
            "slotId": "lam_alef.ligature",
            "glyphName": "lam_alef.fina",
            "unicode": "",
            "form": "ligature",
            "joiningType": "D",
            "group": "letters",
            "characterName": "LamAlef",
            "previewPath": "M50 0 L350 0 L350 420 L50 420 Z",
            "placement": {},
            "advanceWidth": 800,
            "anchors": [],
        }
    )
    return result


def test_full_arabic_corpus_passes(tmp_path):
    options = params(tmp_path)
    options["familyName"] = "Full Arabic Test"
    options["glyphs"] = full_glyphs()
    options["shaping"]["lamAlefLigatures"] = True

    result = build.build_font(options, lambda kind, data: None)
    assert result["success"] is True, result["checks"]

    corpus = preview.run_corpus(
        {"fontPath": result["artifacts"]["ttf"], "glyphs": options["glyphs"]}
    )
    assert corpus["totals"] == {"pass": 11, "fail": 0, "skipped": 0}, corpus["results"]
    assert corpus["findings"] == []
