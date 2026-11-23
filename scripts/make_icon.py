"""Generate the source PNG used by `npx tauri icon` (stdlib only)."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 512


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def main() -> None:
    rows: list[bytes] = []
    for y in range(SIZE):
        row = bytearray([0])  # filter type 0
        for x in range(SIZE):
            # Simple diagonal gradient with a lighter inner square.
            t = (x + y) / (2 * SIZE)
            base = (int(24 + 40 * t), int(86 + 90 * t), int(92 + 70 * t))
            if SIZE * 0.2 < x < SIZE * 0.8 and SIZE * 0.2 < y < SIZE * 0.8:
                base = (236, 248, 244)
            row.extend(base)
        rows.append(bytes(row))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")

    destination = Path(__file__).resolve().parent.parent / "assets" / "icon.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(png)
    print(destination)


if __name__ == "__main__":
    main()
