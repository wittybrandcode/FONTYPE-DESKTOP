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
