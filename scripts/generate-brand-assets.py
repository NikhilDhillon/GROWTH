"""Regenerates the GROWTH logo assets from one geometry definition.

The mark is the end of a loaded barbell seen side-on: plates go on from the
collar outward, the newest in green, with a faint slot for the next one. It is
drawn on a 120-unit grid that matches assets/logo.svg and
src/components/LogoMark.tsx. Run from the repo root:

    python3 scripts/generate-brand-assets.py
"""
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

TILE = "#0d0d0d"
BAR = "#8a8a8a"
PLATE = "#ececec"
GREEN = "#7bcf9a"
SUPERSAMPLE = 4
ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
PUBLIC = ROOT / "public"  # copied to the web root by `expo export`

# (x, y, width, height, corner radius, colour) in 120-unit space, drawn in order.
SHAPES = [
    (12, 57, 20, 6, 3, BAR),     # shaft
    (30, 56, 76, 8, 4, BAR),     # sleeve
    (26, 48, 7, 24, 2.5, BAR),   # collar
    (36, 25, 14, 70, 4, PLATE),  # loaded plate
    (53, 25, 14, 70, 4, GREEN),  # newest plate
]
# The next plate is translucent so the sleeve shows through it.
NEXT_PLATE = (70, 25, 14, 70, 4, GREEN)
NEXT_PLATE_OPACITY = 0.3


def draw_shape(draw, shape, scale, center, alpha=255):
    x, y, width, height, radius, colour = shape
    left = center[0] + (x - 60) * scale
    top = center[1] + (y - 60) * scale
    box = [round(left), round(top), round(left + width * scale) - 1, round(top + height * scale) - 1]
    draw.rounded_rectangle(box, radius=round(radius * scale), fill=(*ImageColor.getrgb(colour), alpha))


def render(size, *, tile, corner_ratio=0.0, tile_fraction=1.0):
    """Draws the mark so the 120-unit tile spans `tile_fraction` of the image."""
    big = size * SUPERSAMPLE
    scale = big * tile_fraction / 120
    center = (big / 2, big / 2)
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if tile:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * corner_ratio), fill=TILE)
    for shape in SHAPES:
        draw_shape(draw, shape, scale, center)
    # Drawing replaces pixels, so the translucent plate is blended from its own layer.
    next_plate = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_shape(ImageDraw.Draw(next_plate), NEXT_PLATE, scale, center, round(255 * NEXT_PLATE_OPACITY))
    image.alpha_composite(next_plate)
    return image.resize((size, size), Image.LANCZOS)


def svg_rect(shape, extra=""):
    x, y, width, height, radius, colour = shape
    return f'  <rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{colour}"{extra}/>'


def svg():
    rects = [svg_rect(shape) for shape in SHAPES] + [svg_rect(NEXT_PLATE, f' fill-opacity="{NEXT_PLATE_OPACITY}"')]
    return "\n".join([
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">',
        f'  <rect width="120" height="120" rx="28" fill="{TILE}"/>',
        *rects,
        "</svg>",
        "",
    ])


def main():
    ASSETS.mkdir(exist_ok=True)
    (ASSETS / "logo.svg").write_text(svg())
    # iOS masks the corners itself, so the store icon is a full-bleed square.
    render(1024, tile=True).convert("RGB").save(ASSETS / "icon.png")
    # Android adaptive foreground: a 108dp canvas whose middle 72dp is visible, so the
    # mark keeps the same proportions as on iOS and stays inside the 66dp safe zone.
    render(1024, tile=False, tile_fraction=72 / 108).save(ASSETS / "adaptive-icon.png")
    render(48, tile=True, corner_ratio=28 / 120).save(ASSETS / "favicon.png")
    # Home-screen icons for the website, linked from public/index.html and
    # public/manifest.webmanifest. iOS masks apple-touch-icon itself, so it is full-bleed.
    PUBLIC.mkdir(exist_ok=True)
    render(180, tile=True).convert("RGB").save(PUBLIC / "apple-touch-icon.png")
    for size in (192, 512):
        render(size, tile=True, corner_ratio=28 / 120).save(PUBLIC / f"icon-{size}.png")
    # Maskable: Android crops it to its own shape, keeping at least the middle 80% circle.
    render(512, tile=True, tile_fraction=0.84).convert("RGB").save(PUBLIC / "icon-maskable-512.png")
    print("Wrote", ", ".join(sorted(path.name for path in ASSETS.iterdir())), "and the public/ home-screen icons")


if __name__ == "__main__":
    main()
