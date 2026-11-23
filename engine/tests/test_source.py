from pathlib import Path

import pytest
from ufoLib2 import Font

from fontype_engine import source
from fontype_engine.protocol import EngineError
from fontype_engine.ufo_writer import ANCHOR_CLASSES_LIB_KEY, SOURCE_LIB_KEY


def _glyph(**overrides):
    record = {
        "slotId": "beh.initial",
        "glyphName": "beh.init",
        "unicode": "U+0628",
        "form": "initial",
        "joiningType": "D",
        "group": "letters",
        "previewPath": "M100 0 L100 400 L300 400 L300 0 Z",
        "placement": {"x": 10, "y": 20, "scaleX": 1.5, "scaleY": 0.8, "rotation": 0},
        "advanceWidth": 620,
        "anchors": [
            {"name": "top", "class": "top", "x": 200, "y": 420},
            {"name": "entry", "class": "cursive-entry", "x": 10, "y": 180},
        ],
    }
    record.update(overrides)
    return record


def _run(tmp_path: Path, **extra):
    params = {
        "outputPath": str(tmp_path / "source.ufo"),
        "upm": 1000,
        "familyName": "Arabic Spring",
        "styleName": "Regular",
        "metrics": {"ascender": 800, "descender": -250, "capHeight": 700},
        "presetId": "arabic-core",
        "unicodeVersion": "16.0.0",
        "projectId": "project-test",
        "glyphs": [_glyph()],
    }
    params.update(extra)
    return source.build_source(params)


def test_build_source_writes_metrics_anchors_and_groups(tmp_path):
    result = _run(tmp_path)

    assert result["ok"] is True
    assert result["glyphCount"] == 2  # beh.init + space
    assert result["anchorCount"] == 2
    assert result["mappedCodepoints"] == 1  # initial form is not a cmap entry
    assert Path(result["outputPath"]).is_dir()

    font = Font.open(result["outputPath"])
    glyph = font["beh.init"]
    assert glyph.width == 620
    assert [anchor.name for anchor in glyph.anchors] == ["top", "entry"]
    assert glyph.lib[ANCHOR_CLASSES_LIB_KEY] == {"top": "top", "entry": "cursive-entry"}
    assert glyph.lib[SOURCE_LIB_KEY]["slotId"] == "beh.initial"
    assert font.info.unitsPerEm == 1000
    assert font.info.ascender == 800
    assert font.groups["fontype.joiningType.D"] == ["beh.init"]
    assert font.groups["fontype.anchor.top"] == ["beh.init"]
    assert font["space"].width == 250


def test_placement_transform_is_applied(tmp_path):
    from fontTools.pens.boundsPen import BoundsPen

    _run(tmp_path)
    font = Font.open(tmp_path / "source.ufo")
    bounds = BoundsPen(None)
    font["beh.init"].draw(bounds)
    assert bounds.bounds[0] == pytest.approx(160.0, abs=1.5)  # 100*1.5 + 10
    assert bounds.bounds[1] == pytest.approx(20.0, abs=1.5)


def test_primary_form_receives_unicode(tmp_path):
    result = _run(
        tmp_path,
        glyphs=[
            _glyph(form="initial"),
            _glyph(slotId="beh.isolated", glyphName="beh.isol", form="isolated"),
        ],
    )
    font = Font.open(result["outputPath"])
    assert font["beh.init"].unicode is None
    assert font["beh.isol"].unicode == 0x0628
    assert result["mappedCodepoints"] == 2  # U+0628 + space


def test_duplicate_cmap_is_rejected(tmp_path):
    with pytest.raises(EngineError) as exc:
        _run(
            tmp_path,
            glyphs=[
                _glyph(form="isolated"),
                _glyph(
                    slotId="other.isolated", glyphName="other.isol", form="isolated"
                ),
            ],
        )
    assert exc.value.code == "DUPLICATE_CMAP"


def test_empty_artwork_is_skipped(tmp_path):
    result = _run(tmp_path, glyphs=[_glyph(previewPath="", slotId="empty.slot")])
    assert result["glyphCount"] == 1  # space only
    assert result["skippedSlots"] == ["empty.slot"]


def test_duplicate_glyph_names_are_rejected(tmp_path):
    with pytest.raises(EngineError) as exc:
        _run(tmp_path, glyphs=[_glyph(), _glyph()])
    assert exc.value.code == "DUPLICATE_GLYPH_NAMES"
