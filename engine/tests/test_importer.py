from pathlib import Path

from fontype_engine.commands import dispatch

SAMPLE = Path(__file__).parent / "samples" / "beh.svg"


def test_inspect_svg_returns_import_contract():
    events: list[tuple[str, dict]] = []
    dispatch(
        {
            "id": "inspect",
            "cmd": "inspect_svg",
            "params": {
                "svgPath": str(SAMPLE),
                "upm": 1000,
                "mode": "fit_to_em",
                "advanceWidth": 600,
            },
        },
        lambda job, kind, data: events.append((kind, data)),
    )
    result = [data for kind, data in events if kind == "result"][0]
    assert result["ok"]
    assert result["sourceFileName"] == "beh.svg"
    assert result["contentHash"].startswith("sha256:")
    assert result["contours"] == 1
    assert result["viewBox"] == [0.0, 0.0, 300.0, 500.0]
    assert result["previewPath"].startswith("M")
    assert result["bounds"][1] == 0.0  # baseline aligned


def test_inspect_missing_file_reports_error():
    errors: list[dict] = []
    dispatch(
        {"id": "x", "cmd": "inspect_svg", "params": {"svgPath": "missing.svg"}},
        lambda job, kind, data: errors.append(data) if kind == "error" else None,
    )
    assert errors and errors[0]["code"] == "SVG_NOT_FOUND"


def _inspect(params: dict) -> dict:
    events: list[tuple[str, dict]] = []
    dispatch(
        {"id": "inspect", "cmd": "inspect_svg", "params": params},
        lambda job, kind, data: events.append((kind, data)),
    )
    return [data for kind, data in events if kind == "result"][0]


def test_inspect_multiple_svgs_merges_into_one_reproducible_source(tmp_path):
    first = tmp_path / "main.svg"
    second = tmp_path / "dot.svg"
    first.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400">'
        '<path d="M20 0 H180 V400 H20 Z"/></svg>',
        encoding="utf-8",
    )
    second.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path d="M10 10 L90 10 L50 90 Z"/></svg>',
        encoding="utf-8",
    )

    combined = _inspect(
        {
            "svgPaths": [str(first), str(second)],
            "upm": 1000,
            "advanceWidth": 600,
        }
    )
    assert combined["ok"]
    assert combined["sourceFileName"] == "combined-2-shapes.svg"
    assert Path(combined["sourcePath"]).is_file()
    assert combined["contours"] == 2
    assert combined["bounds"][1] == 0.0
    assert any(item["code"] == "MULTI_SVG_COMBINED" for item in combined["findings"])

    reopened = _inspect(
        {
            "svgPath": combined["sourcePath"],
            "upm": 1000,
            "mode": "preserve_size",
            "advanceWidth": 600,
        }
    )
    assert reopened["previewPath"] == combined["previewPath"]
    assert reopened["bounds"] == combined["bounds"]
    assert reopened["contours"] == combined["contours"]
