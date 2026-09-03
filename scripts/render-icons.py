#!/usr/bin/env python3
"""
Renders the extension icon from geometry to every size Chrome and the Web Store
ask for, plus an SVG for the store listing.

Why the geometry lives here rather than in a checked-in SVG that something else
rasterises: this repo cannot install an SVG rasteriser. `npm install` resolves
`@integral-productivity/glassfrog` from GitHub Packages and needs a
SAML-authorised token, so a contributor without one — or CI on a fork — cannot
run a node-based render step at all. Python's standard library can write a PNG
(zlib + struct) with no dependencies whatsoever, so the render always works.

That constraint turns out to be the better design anyway. The usual arrangement
is an `icon.svg` committed beside `icon128.png`, and the two drift the first time
someone edits one of them; nothing fails when they disagree, because nothing
compares them. Here the shapes are declared once, in `GLYPH` and `BACKGROUND`
below, and both outputs are generated from them. Editing the mark means editing
the geometry, and every output moves together or none do.

    python3 scripts/render-icons.py

Writes public/icon{16,32,48,128}.png and docs/store/icon.svg. Idempotent —
running it on an unchanged file produces byte-identical output, so it is safe to
run in a check that asserts the committed PNGs match the geometry.

The mark is an arrow filing into an open tray: "put this where it goes", which is
the product's whole claim. A bookmark was the other candidate and was rejected on
meaning rather than looks — a bookmark says "save this for later", and STRATEGY.md
is explicit that deferral is the thing the extension exists to avoid.
"""

import struct
import sys
import zlib
from pathlib import Path

# Everything below is expressed in a 128x128 design space and scaled at render
# time, so the mark is resolution-independent and the numbers stay readable.
DESIGN = 128

# The slate the placeholder icon already used, kept so the change reads as the
# mark arriving rather than a rebrand. Green is the frog, and carries enough
# contrast on this slate to survive a 16px toolbar slot.
SLATE = (0x1E, 0x29, 0x33)
GREEN = (0x4A, 0xDE, 0x80)

# 4x4 samples per output pixel. Nearest-neighbour edges look broken at 16px,
# which is the size that decides whether the toolbar button reads as a product
# or as a rendering accident.
SUPERSAMPLE = 4


def rounded_rect(x, y, x0, y0, x1, y1, r):
    """Point-in-rounded-rectangle."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    # Inside the cross formed by the straight edges, no corner test is needed.
    if x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r:
        return True
    cx = x0 + r if x < x0 + r else x1 - r
    cy = y0 + r if y < y0 + r else y1 - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def triangle(x, y, p0, p1, p2):
    """Point-in-triangle by consistent winding of the three edge cross products."""

    def side(a, b):
        return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])

    d0, d1, d2 = side(p0, p1), side(p1, p2), side(p2, p0)
    return not ((d0 < 0 or d1 < 0 or d2 < 0) and (d0 > 0 or d1 > 0 or d2 > 0))


# The tile. Radius 28 of 128 matches the squircle weight of the platform icons
# it sits beside.
BACKGROUND = ("rounded_rect", (0, 0, DESIGN, DESIGN, 28))

# The arrow filing into the tray. Kept to three primitives: any more detail
# dissolves into mush at 16px, where most of an extension icon's life is spent.
GLYPH = [
    # Arrow stem.
    ("rounded_rect", (54, 20, 74, 58, 6)),
    # Arrow head. Apex sits 12 units above the tray so the gap survives
    # downsampling to 16px, where 12 units is a little over one pixel.
    ("triangle", ((64, 76), (34, 46), (94, 46))),
    # Tray, drawn as three bars forming an open-topped container. An open tray
    # rather than a single baseline: a baseline plus a down arrow is the
    # universal "download" glyph, and this extension does the opposite.
    ("rounded_rect", (28, 88, 44, 116, 5)),
    ("rounded_rect", (84, 88, 100, 116, 5)),
    ("rounded_rect", (28, 100, 100, 116, 5)),
]


def covers(shapes, x, y):
    for kind, args in shapes:
        if kind == "rounded_rect" and rounded_rect(x, y, *args):
            return True
        if kind == "triangle" and triangle(x, y, *args):
            return True
    return False


def render(size):
    """Returns RGBA rows for one square icon of `size` pixels."""
    scale = DESIGN / size
    step = 1.0 / SUPERSAMPLE
    offset = step / 2.0
    samples = SUPERSAMPLE * SUPERSAMPLE
    rows = []

    for py in range(size):
        row = bytearray()
        for px in range(size):
            bg_hits = 0
            glyph_hits = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = (px + offset + sx * step) * scale
                    y = (py + offset + sy * step) * scale
                    if covers([BACKGROUND], x, y):
                        bg_hits += 1
                        if covers(GLYPH, x, y):
                            glyph_hits += 1

            if bg_hits == 0:
                row += bytes((0, 0, 0, 0))
                continue

            # Composite glyph over slate by coverage, then let background
            # coverage drive alpha so the rounded corners feather cleanly.
            t = glyph_hits / bg_hits
            colour = tuple(
                round(SLATE[i] + (GREEN[i] - SLATE[i]) * t) for i in range(3)
            )
            row += bytes(colour) + bytes((round(255 * bg_hits / samples),))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    """Minimal RGBA PNG writer. No filtering — these images are tiny."""
    size = len(rows)
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    return len(png)


def svg():
    """The same geometry as vectors, for the store listing and any print use."""

    def rect(x0, y0, x1, y1, r):
        return (
            f'  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" '
            f'rx="{r}" ry="{r}" fill="{{fill}}"/>'
        )

    slate = "#%02X%02X%02X" % SLATE
    green = "#%02X%02X%02X" % GREEN
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {DESIGN} {DESIGN}" '
        f'width="{DESIGN}" height="{DESIGN}" role="img" '
        f'aria-label="GlassFrog Clipper">',
        "  <title>GlassFrog Clipper</title>",
        rect(*BACKGROUND[1]).format(fill=slate),
    ]
    for kind, args in GLYPH:
        if kind == "rounded_rect":
            parts.append(rect(*args).format(fill=green))
        else:
            points = " ".join(f"{x},{y}" for x, y in args)
            parts.append(f'  <polygon points="{points}" fill="{green}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main():
    root = Path(__file__).resolve().parent.parent

    # `--out DIR` renders everything into one directory instead of the two the
    # repository uses. test/store-package.test.ts renders into a temporary
    # directory and byte-compares, which is what makes "the committed PNGs are
    # what this geometry produces" an assertion rather than a hope. Without it
    # the only way to check would be to overwrite the real icons and look at
    # `git status`, which is not something a test may do.
    out = None
    if "--out" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--out") + 1])
        out.mkdir(parents=True, exist_ok=True)

    written = []

    for size in (16, 32, 48, 128):
        path = (out or root / "public") / f"icon{size}.png"
        written.append((path, write_png(path, render(size))))

    svg_path = out / "icon.svg" if out else root / "docs" / "store" / "icon.svg"
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    svg_path.write_text(svg())
    written.append((svg_path, len(svg())))

    if out is None:
        # The container app's asset catalogue holds its own copy — Xcode reads
        # the catalogue, not public/. Written from the same geometry rather than
        # copied by hand, because a hand-copied icon is exactly the file that
        # still shows the old mark two releases later.
        apple = (
            root
            / "apple"
            / "GlassFrog Clipper"
            / "Shared (App)"
            / "Assets.xcassets"
            / "LargeIcon.imageset"
            / "icon128.png"
        )
        if apple.parent.is_dir():
            written.append((apple, write_png(apple, render(128))))

    for path, size in written:
        print(f"{path}  {size} bytes")


if __name__ == "__main__":
    sys.exit(main())
