#!/usr/bin/env python3
"""Generate the raster app-icon assets for PCIE.

The single source of truth for the icon design is ``public/favicon.svg``.
This script re-implements the same vector geometry with Pillow so the
legacy/Apple raster assets stay pixel-consistent with the SVG master:

- ``public/favicon.ico``          multi-resolution 16 / 32 / 48
- ``public/apple-touch-icon.png`` 180 x 180 (iOS home screen)

Run it after editing ``public/favicon.svg`` so the same design change is
reflected in the raster fallbacks:

    python scripts/generate-app-icons.py

Requires Pillow (``pip install pillow``). Preview PNGs used for visual
inspection are written to ``.local/icon-preview/`` (git-ignored).
"""

from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(REPO_ROOT, "public")
PREVIEW_DIR = os.path.join(REPO_ROOT, ".local", "icon-preview")

# Design space: the SVG uses a 64x64 viewBox. Render a large master and
# downscale so every raster asset is derived from the same geometry.
UNIT = 64
SCALE = 16  # master is 1024 x 1024

# Palette (mirrors the SVG and src/index.css design tokens).
TILE = (45, 95, 126, 255)        # #2d5f7e  --home-accent
CREAM = (245, 239, 231, 255)     # #f5efe7  --home-page-bg
WHITE = (255, 255, 255, 255)
FLAP = (220, 235, 245, 255)      # #dcebf5
CREASE = (169, 203, 224, 255)    # #a9cbe0


def scaled(points):
    return [(x * SCALE, y * SCALE) for x, y in points]


def render_master(full_bleed: bool = False) -> Image.Image:
    """Render the icon at 1024x1024.

    ``full_bleed`` extends the brand tile to the canvas edges. iOS masks
    ``apple-touch-icon`` with its own rounded rect, so that asset must not
    carry transparent corners; browser favicons keep the rounded tile.
    """
    image = Image.new("RGBA", (UNIT * SCALE, UNIT * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Brand tile: rounded square, x/y 1.5..62.5, radius 13.
    # ``full_bleed`` covers the whole canvas as an opaque square because iOS
    # applies its own squircle mask to apple-touch-icon; supplying rounded
    # transparent corners would double-round the icon.
    if full_bleed:
        tile_box = [0, 0, UNIT * SCALE, UNIT * SCALE]
        tile_radius = 0
    else:
        tile_box = [1.5 * SCALE, 1.5 * SCALE, 62.5 * SCALE, 62.5 * SCALE]
        tile_radius = 13 * SCALE
    draw.rounded_rectangle(tile_box, radius=tile_radius, fill=TILE)

    # Processing orbit around the document: center (32, 30), radius 20.5,
    # stroke 2.8. The arc spans 345 deg -> 285 deg (300 deg sweep) leaving a
    # 60 deg gap in the top-right quadrant. PIL angles run clockwise from
    # 3 o'clock, matching the SVG's y-down convention.
    cx, cy, r = 32 * SCALE, 30 * SCALE, 20.5 * SCALE
    bbox = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(bbox, start=345, end=360, fill=CREAM, width=round(2.8 * SCALE))
    draw.arc(bbox, start=0, end=285, fill=CREAM, width=round(2.8 * SCALE))
    # Round cap at the arc start (345 deg) so it matches stroke-linecap.
    start_angle = math.radians(345)
    cap_x = cx + r * math.cos(start_angle)
    cap_y = cy + r * math.sin(start_angle)
    cap_r = 1.4 * SCALE
    draw.ellipse(
        [cap_x - cap_r, cap_y - cap_r, cap_x + cap_r, cap_y + cap_r],
        fill=CREAM,
    )

    # Arrowhead at the arc end (285 deg), pointing clockwise into the gap.
    theta = math.radians(285)
    tangent = (-math.sin(theta), math.cos(theta))
    normal = (-tangent[1], tangent[0])
    px, py = cx + r * math.cos(theta), cy + r * math.sin(theta)
    tip = (px + 3.2 * tangent[0], py + 3.2 * tangent[1])
    base = (px - 2.0 * tangent[0], py - 2.0 * tangent[1])
    corner_a = (base[0] + 2.4 * normal[0], base[1] + 2.4 * normal[1])
    corner_b = (base[0] - 2.4 * normal[0], base[1] - 2.4 * normal[1])
    draw.polygon(scaled([tip, corner_a, corner_b]), fill=CREAM)

    # Document body: top-right corner cut by the fold (diagonal 32,13 -> 39,20),
    # bottom corners rounded with radius 2.
    body = [
        (23, 13), (32, 13), (39, 20), (39, 39),
        (37, 41), (25, 41), (23, 39),
    ]
    draw.polygon(scaled(body), fill=WHITE)
    for corner in [(25, 39), (37, 39)]:
        corner_x, corner_y = corner[0] * SCALE, corner[1] * SCALE
        radius = 2 * SCALE
        draw.ellipse(
            [corner_x - radius, corner_y - radius, corner_x + radius, corner_y + radius],
            fill=WHITE,
        )

    # Folded corner flap and its crease.
    draw.polygon(scaled([(32, 13), (39, 13), (39, 20)]), fill=FLAP)
    draw.line(
        scaled([(32, 13), (39, 20)]),
        fill=CREASE,
        width=round(1.1 * SCALE),
    )

    # Text lines inside the document.
    for x1, y1, x2, y2 in [
        (25.5, 23.5, 37.5, 25.7),
        (25.5, 29.0, 34.5, 31.2),
        (25.5, 34.5, 36.5, 36.7),
    ]:
        draw.rounded_rectangle(
            [x1 * SCALE, y1 * SCALE, x2 * SCALE, y2 * SCALE],
            radius=1.1 * SCALE,
            fill=TILE,
        )

    return image


def write_previews(master: Image.Image, full_bleed_master: Image.Image) -> None:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    for size in (16, 32, 48, 180):
        small = master.resize((size, size), Image.LANCZOS)
        zoomed = small.resize((size * 8, size * 8), Image.NEAREST)
        zoomed.save(os.path.join(PREVIEW_DIR, f"preview-{size}x{size}.png"))
        small.save(os.path.join(PREVIEW_DIR, f"exact-{size}x{size}.png"))
    full_bleed_master.resize((180, 180), Image.LANCZOS).save(
        os.path.join(PREVIEW_DIR, "apple-touch-180x180.png")
    )


def main() -> int:
    try:
        master = render_master()
        full_bleed_master = render_master(full_bleed=True)
    except ImportError:
        print("Pillow is required: pip install pillow", file=sys.stderr)
        return 1

    os.makedirs(PUBLIC_DIR, exist_ok=True)
    full_bleed_master.resize((180, 180), Image.LANCZOS).save(
        os.path.join(PUBLIC_DIR, "apple-touch-icon.png")
    )
    master.save(
        os.path.join(PUBLIC_DIR, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    write_previews(master, full_bleed_master)
    print("Wrote public/apple-touch-icon.png (180x180, full bleed)")
    print("Wrote public/favicon.ico (16/32/48)")
    print(f"Wrote previews to {PREVIEW_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
