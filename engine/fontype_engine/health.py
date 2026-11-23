"""Toolchain and data-file health check for Phase 0 exit criteria."""

from __future__ import annotations

import sys
from importlib import metadata
from pathlib import Path
from typing import Any

from . import __version__

TOOLCHAIN = ("fonttools", "ufoLib2", "fontmake", "uharfbuzz", "defusedxml")


def _version(package: str) -> str | None:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return None


def check() -> dict[str, Any]:
    data_dir = Path(__file__).resolve().parent.parent / "data"
    required_files = ("arabic-core.json", "anchor-classes.json")
    toolchain = {name: _version(name) for name in TOOLCHAIN}
    files = {name: (data_dir / name).is_file() for name in required_files}
    ok = all(value is not None for value in toolchain.values()) and all(files.values())
    return {
        "ok": ok,
        "engineVersion": __version__,
        "python": sys.version.split()[0],
        "toolchain": toolchain,
        "dataFiles": files,
        "dataDir": str(data_dir),
        "message": (
            "المحرك جاهز"
            if ok
            else "المحرك غير مكتمل: تحقق من تبعيات Python أو ملفات البيانات"
        ),
    }
