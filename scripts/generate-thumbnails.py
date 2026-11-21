#!/usr/bin/env python3
"""Generate lightweight, animated GIF artwork for every game in games.json."""
from pathlib import Path
import json, math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "thumbs"
OUT.mkdir(parents=True, exist_ok=True)
W, H, FRAMES = 320, 180, 10
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT = ImageFont.truetype(FONT_PATH, 17)
SMALL = ImageFont.truetype(FONT_PATH, 10)

def color(hex_value):
    value = hex_value.lstrip("#")
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

def draw_art(game):
    glow = color(game.get("glow", "#927cff"))
    shade = color(game.get("shade", "#17213a"))
    title = game["title"][:24]
    frames = []
    for frame in range(FRAMES):
        image = Image.new("RGB", (W, H))
        pixels = image.load()
        phase = frame * math.tau / FRAMES
        for y in range(H):
            for x in range(W):
                wave = (math.sin(x / W * math.tau + phase) + math.cos(y / H * math.tau - phase) + 2) / 4
                radial = max(0, 1 - math.sqrt(((x - (W * .28 + frame * 5) % W) / (W * .85)) ** 2 + ((y - H * .28) / H) ** 2))
                pixels[x, y] = tuple(max(0, min(255, int(shade[c] * (0.75 + wave * .28) + glow[c] * radial * .34))) for c in range(3))
        draw = ImageDraw.Draw(image, "RGBA")
        # Animated orbit rings give each thumbnail motion without distracting from its title.
        cx, cy = int(W * .72 + math.sin(phase) * 8), 72
        for radius, alpha in ((30, 65), (48, 42), (67, 25)):
            draw.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), outline=(*glow, alpha), width=2)
        draw.rounded_rectangle((18, 17, 54, 21), radius=2, fill=(*glow, 220))
        draw.text((18, 112), title, font=FONT, fill=(250, 250, 255, 255), stroke_width=1, stroke_fill=(8, 10, 18, 180))
        draw.text((19, 139), game.get("category", "ARCADE").upper(), font=SMALL, fill=(210, 220, 240, 220))
        frames.append(image)
    frames[0].save(OUT / (game["id"] + ".gif"), save_all=True, append_images=frames[1:],
                   duration=115, loop=0, optimize=True, disposal=2)

manifest = json.loads((ROOT / "games.json").read_text(encoding="utf-8"))
for game in manifest["games"]:
    draw_art(game)
print(f"Generated {len(manifest['games'])} animated game thumbnails in {OUT}")
