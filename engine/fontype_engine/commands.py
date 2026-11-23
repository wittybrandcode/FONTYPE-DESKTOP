"""JSON-lines request loop used by the Rust engine bridge."""

from __future__ import annotations

import sys
from typing import Any, Callable

from . import build, health, importer, preview, source, spike
from .protocol import EngineError, decode, emit

Emitter = Callable[[str, str, dict[str, Any]], None]


def dispatch(request: dict[str, Any], send: Emitter) -> None:
    job_id = str(request.get("id") or "unknown")
    command = request.get("cmd")
    params = request.get("params") or {}

    try:
        if command == "health":
            send(job_id, "result", health.check())
        elif command == "spike":
            result = spike.run_spike(
                job_id, params, lambda kind, data: send(job_id, kind, data)
            )
            send(job_id, "result", result)
        elif command == "inspect_svg":
            send(job_id, "result", importer.inspect_svg(params))
        elif command == "build_source":
            send(job_id, "result", source.build_source(params))
        elif command == "build_font":
            result = build.build_font(
                params, lambda kind, data: send(job_id, kind, data)
            )
            send(job_id, "result", result)
        elif command == "shape_preview":
            send(job_id, "result", preview.shape_preview(params))
        elif command == "run_corpus":
            send(job_id, "result", preview.run_corpus(params))
        elif command == "ping":
            send(job_id, "result", {"pong": True})
        else:
            raise EngineError("UNKNOWN_COMMAND", f"أمر غير معروف: {command}")
    except EngineError as exc:
        send(job_id, "error", {"code": exc.code, "message": exc.message, **exc.detail})
    except Exception as exc:  # never let a worker die silently
        send(job_id, "error", {"code": "INTERNAL", "message": str(exc)})


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = decode(line)
        except Exception:
            emit(
                "unknown",
                "error",
                {"code": "BAD_REQUEST", "message": "طلب JSON غير صالح."},
            )
            continue
        dispatch(request, emit)


if __name__ == "__main__":
    main()
