"""
Generate placeholder app icon for GoForKids iOS app.
1024x1024 PNG, cosmic dark theme to match the app's existing aesthetic.
Apple auto-scales this single master to all required sizes in Xcode 14+.
"""
from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 1024
OUT = "/Users/patrickdowell/Projects/GoForKids/ios/AppIcon-1024.png"


def radial_gradient(size, inner_color, outer_color):
    img = Image.new("RGB", (size, size), outer_color)
    cx, cy = size / 2, size / 2
    max_r = math.sqrt(2) * size / 2
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(d / max_r, 1.0)
            r = int(inner_color[0] * (1 - t) + outer_color[0] * t)
            g = int(inner_color[1] * (1 - t) + outer_color[1] * t)
            b = int(inner_color[2] * (1 - t) + outer_color[2] * t)
            pixels[x, y] = (r, g, b)
    return img


def draw_goban_corner(img, color, alpha):
    """Faint goban grid lines suggestive of a Go board, only in upper-left quadrant."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    grid_origin = SIZE * 0.18
    spacing = SIZE * 0.085
    line_width = 4
    for i in range(7):
        offset = grid_origin + i * spacing
        d.line([(grid_origin, offset), (SIZE * 0.78, offset)], fill=(*color, alpha), width=line_width)
        d.line([(offset, grid_origin), (offset, SIZE * 0.78)], fill=(*color, alpha), width=line_width)
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))


def draw_stone(img, cx, cy, radius, base_color, rim_color, highlight_color):
    """Stone with gradient + rim, matching the app's stone-rendering style."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    rim_width = max(int(radius * 0.06), 2)
    d.ellipse(
        [(cx - radius - rim_width, cy - radius - rim_width),
         (cx + radius + rim_width, cy + radius + rim_width)],
        fill=(*rim_color, 255),
    )
    steps = 80
    for i in range(steps, 0, -1):
        t = i / steps
        r = int(base_color[0] * t + highlight_color[0] * (1 - t))
        g = int(base_color[1] * t + highlight_color[1] * (1 - t))
        b = int(base_color[2] * t + highlight_color[2] * (1 - t))
        rr = int(radius * t)
        offset_y = int(radius * 0.35 * (1 - t))
        d.ellipse(
            [(cx - rr, cy - rr - offset_y), (cx + rr, cy + rr - offset_y)],
            fill=(r, g, b, 255),
        )
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def main():
    cosmic_inner = (45, 30, 75)
    cosmic_outer = (8, 5, 18)
    img = radial_gradient(SIZE, cosmic_inner, cosmic_outer)

    draw_goban_corner(img, color=(180, 140, 60), alpha=70)

    img = draw_stone(
        img,
        cx=SIZE * 0.55,
        cy=SIZE * 0.55,
        radius=int(SIZE * 0.28),
        base_color=(15, 15, 22),
        rim_color=(200, 160, 80),
        highlight_color=(70, 65, 90),
    )

    img.save(OUT, "PNG")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
