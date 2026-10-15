"""Writes icons/icon-<size>.png: three stacked bars on a rounded green square.

The 128 pixel icon keeps 16 pixels of transparent padding, as the Chrome Web Store asks."""
import struct
import sys
import zlib
from pathlib import Path

GREEN = (31, 136, 61)
WHITE = (255, 255, 255)
SUPERSAMPLE = 4


def inside_rounded(x, y, left, top, right, bottom, radius):
    if x < left or x > right or y < top or y > bottom:
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def color_at(u, v):
    if not inside_rounded(u, v, 0, 0, 1, 1, 0.22):
        return None
    bars = [(0.24, 0.20, 0.76, 0.33), (0.18, 0.43, 0.82, 0.56), (0.24, 0.66, 0.76, 0.79)]
    for index, (left, top, right, bottom) in enumerate(bars):
        if inside_rounded(u, v, left, top, right, bottom, 0.065):
            return WHITE if index != 1 else (220, 255, 228)
    return GREEN


def render(size, padding=0.0):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            totals = [0, 0, 0, 0]
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    u = ((x + (sx + 0.5) / SUPERSAMPLE) / size - padding) / (1 - 2 * padding)
                    v = ((y + (sy + 0.5) / SUPERSAMPLE) / size - padding) / (1 - 2 * padding)
                    color = color_at(u, v)
                    if color:
                        totals[0] += color[0]
                        totals[1] += color[1]
                        totals[2] += color[2]
                        totals[3] += 255
            samples = SUPERSAMPLE * SUPERSAMPLE
            alpha = totals[3] / samples
            if alpha:
                coverage = totals[3] / 255
                row += bytes([round(totals[0] / coverage), round(totals[1] / coverage), round(totals[2] / coverage), round(alpha)])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


output = Path(sys.argv[1])
for size in (16, 32, 48, 128):
    (output / f'icon-{size}.png').write_bytes(render(size, 16 / 128 if size == 128 else 0.0))
