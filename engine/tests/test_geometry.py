from fontype_engine import geometry


def test_transform_composition_and_point():
    translate = (1, 0, 0, 1, 10, 20)
    scale = (2, 0, 0, 2, 0, 0)
    combined = geometry.compose(translate, scale)
    assert geometry.transform_point(combined, 3, 4) == (16.0, 28.0)


def test_y_axis_inversion():
    matrix = (1, 0, 0, -1, 0, 500)
    assert geometry.transform_point(matrix, 0, 0) == (0.0, 500.0)
    assert geometry.transform_point(matrix, 0, 500) == (0.0, 0.0)


def test_parse_transform_scale():
    assert geometry.parse_transform("translate(5) scale(2)") == (
        2.0,
        0.0,
        0.0,
        2.0,
        5.0,
        0.0,
    )


def test_svg_to_outline_bounds(tmp_path):
    svg = tmp_path / "glyph.svg"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path d="M 0 0 L 100 0 L 100 100 L 0 100 Z"/></svg>',
        encoding="utf-8",
    )
    parsed = geometry.parse_svg_document(geometry.read_svg_bytes(svg.read_bytes()))
    base = geometry.base_matrix(parsed, 1000, "fit_to_em")
    outline = geometry.build_outline(parsed, base, advance_width=600)
    x_min, y_min, x_max, y_max = outline.bounds
    assert abs(y_min) < 0.001
    assert abs((x_min + x_max) / 2 - 300) < 0.001
    assert outline.contour_count == 1


def test_oversized_svg_is_rejected():
    try:
        geometry.read_svg_bytes(b"x" * (geometry.MAX_SVG_BYTES + 1))
    except Exception as exc:
        assert getattr(exc, "code", None) == "SVG_TOO_LARGE"
        return
    raise AssertionError("expected oversized SVG error")


def test_malformed_svg_is_rejected():
    try:
        geometry.parse_svg_document("<svg><path")
    except Exception as exc:
        assert getattr(exc, "code", None) == "SVG_MALFORMED"
        return
    raise AssertionError("expected malformed SVG error")


def test_unsupported_text_is_rejected():
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>abc</text></svg>'
    try:
        geometry.parse_svg_document(svg)
    except Exception as exc:
        assert getattr(exc, "code", None) == "SVG_UNSUPPORTED_CONTENT"
        return
    raise AssertionError("expected unsupported content error")
