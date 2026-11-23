from fontTools.feaLib.parser import Parser
from ufoLib2 import Font

from fontype_engine import features, source


def glyph(
    name, slot, form, joining, character, anchors=None, group="letters", mark_class=None
):
    record = {
        "slotId": slot,
        "glyphName": name,
        "unicode": "U+0628" if form == "isolated" and character == "Beh" else "",
        "form": form,
        "joiningType": joining,
        "group": group,
        "characterName": character,
        "previewPath": "M0 0 L100 0 L100 500 L0 500 Z",
        "placement": {},
        "advanceWidth": 600,
        "anchors": anchors or [],
    }
    if mark_class:
        record["markClass"] = mark_class
    return record


def base_glyphs():
    return [
        glyph("beh.isol", "beh.isolated", "isolated", "D", "Beh"),
        glyph("beh.init", "beh.initial", "initial", "D", "Beh"),
        glyph("beh.medi", "beh.medial", "medial", "D", "Beh"),
        glyph("beh.fina", "beh.final", "final", "D", "Beh"),
        glyph("alef.isol", "alef.isolated", "isolated", "R", "Alef"),
        glyph("alef.fina", "alef.final", "final", "R", "Alef"),
    ]


def _parse(text, path):
    path.write_text(text, encoding="utf-8")
    Parser(str(path)).parse()


def test_generates_init_medi_fina_rules(tmp_path):
    model = source.resolve_project({"upm": 1000, "glyphs": base_glyphs()})
    result = features.generate(model)

    assert result.stats["features"] == ["init", "medi", "fina"]
    assert "sub beh.isol' lookup FT_INIT @JOIN_NEXT;" in result.text
    assert "sub @JOIN_PREV beh.isol' lookup FT_MEDI @JOIN_NEXT;" in result.text
    assert "sub @JOIN_PREV alef.isol' lookup FT_FINA;" in result.text
    _parse(result.text, tmp_path / "forms.fea")


def test_incomplete_form_sets_do_not_create_broken_rules(tmp_path):
    records = [
        glyph("beh.isol", "beh.isolated", "isolated", "D", "Beh"),
        glyph("beh.fina", "beh.final", "final", "D", "Beh"),
    ]
    model = source.resolve_project({"upm": 1000, "glyphs": records})
    result = features.generate(model)

    assert result.stats["initRules"] == 0
    assert result.stats["mediRules"] == 0
    assert result.stats["finaRules"] == 1
    _parse(result.text, tmp_path / "partial.fea")


def test_lam_alef_ligature_requires_artwork(tmp_path):
    records = base_glyphs()
    records.extend(
        [
            glyph("lam.isol", "lam.isolated", "isolated", "D", "Lam"),
            glyph("lam.fina", "lam.final", "final", "D", "Lam"),
        ]
    )
    model = source.resolve_project({"upm": 1000, "glyphs": records})
    missing = features.generate(model, {"lamAlefLigatures": True})
    assert missing.findings[0]["code"] == "SHAPING_LIGATURE_ARTWORK_MISSING"
    assert "ccmp" not in missing.text

    ligature = glyph("lam_alef.fina", "lam_alef.ligature", "ligature", "D", "LamAlef")
    ligature["unicode"] = ""
    present = features.generate(
        source.resolve_project({"upm": 1000, "glyphs": records + [ligature]}),
        {"lamAlefLigatures": True},
    )
    assert present.stats["ligatureRules"] == 1
    assert "sub lam.isol alef.isol by lam_alef.fina;" in present.text
    assert "ccmp" in present.stats["features"]
    _parse(present.text, tmp_path / "ligature.fea")


def test_mark_anchors_are_mapped_for_ufo2ft(tmp_path):
    records = [
        glyph(
            "beh.isol",
            "beh.isolated",
            "isolated",
            "D",
            "Beh",
            [
                {"name": "top", "class": "top", "x": 50, "y": 500},
                {"name": "bottom", "class": "bottom", "x": 50, "y": 0},
                {"name": "entry", "class": "cursive-entry", "x": 0, "y": 200},
                {"name": "exit", "class": "cursive-exit", "x": 600, "y": 200},
            ],
        ),
        glyph(
            "fatha.isol",
            "fatha.isolated",
            "isolated",
            "T",
            "Fatha",
            [{"name": "top-mark", "class": "top-mark", "x": 0, "y": 0}],
            group="marks",
            mark_class="top",
        ),
    ]
    result = source.build_source(
        {
            "outputPath": str(tmp_path / "source.ufo"),
            "upm": 1000,
            "glyphs": records,
        }
    )
    font = Font.open(result["outputPath"])

    assert [anchor.name for anchor in font["beh.isol"].anchors] == [
        "top",
        "bottom",
        "entry",
        "exit",
    ]
    assert [anchor.name for anchor in font["fatha.isol"].anchors] == ["_top"]
    assert font.lib["public.openTypeCategories"]["fatha.isol"] == "mark"
    assert font.lib["public.openTypeCategories"]["beh.isol"] == "base"
