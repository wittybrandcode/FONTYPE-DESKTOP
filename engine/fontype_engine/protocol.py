"""JSON-lines protocol shared with the Tauri host.

One request per line in, zero or more events per line out.
Every event carries the originating job id so the UI can multiplex jobs.
"""

from __future__ import annotations

import json
import sys
from typing import Any

VALID_EVENTS = {"progress", "result", "error", "log"}


def encode(message: dict[str, Any]) -> str:
    # ASCII-only output keeps the JSON-lines channel safe on Windows consoles
    # whose default code page cannot encode Arabic.
    return json.dumps(message, ensure_ascii=True, separators=(",", ":"))


def decode(line: str) -> dict[str, Any]:
    value = json.loads(line)
    if not isinstance(value, dict):
        raise ValueError("الطلب يجب أن يكون كائناً JSON")
    return value


def emit(job_id: str, event: str, data: dict[str, Any]) -> None:
    if event not in VALID_EVENTS:
        raise ValueError(f"unknown event type: {event}")
    sys.stdout.write(encode({"jobId": job_id, "type": event, "data": data}) + "\n")
    sys.stdout.flush()


class EngineError(Exception):
    """A user-facing engine failure with a stable code."""

    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}
