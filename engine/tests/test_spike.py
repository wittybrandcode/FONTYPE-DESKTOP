from pathlib import Path

from fontype_engine.commands import dispatch

SAMPLE = Path(__file__).parent / "samples" / "beh.svg"


def test_vertical_slice_produces_otf_and_ttf(tmp_path):
    events = []

    def collect(job_id, kind, data):
        events.append((job_id, kind, data))

    dispatch(
        {
            "id": "spike-test",
            "cmd": "spike",
            "params": {
                "svgPath": str(SAMPLE),
                "outputDir": str(tmp_path),
                "upm": 1000,
                "unicode": "U+0628",
                "glyphName": "beh.isol",
            },
        },
        collect,
    )

    kinds = [kind for _, kind, _ in events]
    assert "progress" in kinds
    result = [data for _, kind, data in events if kind == "result"][0]
    assert result["success"], result
    assert all(result["checks"].values()), result["checks"]
    assert Path(result["artifacts"]["otf"]).is_file()
    assert Path(result["artifacts"]["ttf"]).is_file()
    assert result["shaping"]["glyphs"] == ["beh.isol"]


def test_health_check_reports_toolchain():
    events = []
    dispatch(
        {"id": "h", "cmd": "health", "params": {}},
        lambda j, k, d: events.append((k, d)),
    )
    result = [data for kind, data in events if kind == "result"][0]
    assert result["ok"], result
