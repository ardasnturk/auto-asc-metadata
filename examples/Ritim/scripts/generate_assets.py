#!/usr/bin/env python3
"""Generates Ritim's asset catalog: color sets and the 1024x1024 app icon.

Usage: python3 scripts/generate_assets.py   (requires Pillow)
"""
import json
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Ritim", "Resources", "Assets.xcassets")


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def comps(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return {"alpha": "1.000", "blue": f"{b / 255:.3f}", "green": f"{g / 255:.3f}", "red": f"{r / 255:.3f}"}


def colorset(name, light, dark):
    write_json(os.path.join(ROOT, f"{name}.colorset", "Contents.json"), {
        "colors": [
            {"color": {"color-space": "srgb", "components": comps(light)}, "idiom": "universal"},
            {"appearances": [{"appearance": "luminosity", "value": "dark"}],
             "color": {"color-space": "srgb", "components": comps(dark)}, "idiom": "universal"},
        ],
        "info": {"author": "xcode", "version": 1},
    })


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def icon(path):
    size = 1024
    scale = 4
    big = size * scale
    start, end = (0x5B, 0x4B, 0xE8), (0xF2, 0x5F, 0x8C)
    # Diagonal gradient background.
    grad = Image.new("RGB", (256, 256))
    px = grad.load()
    for y in range(256):
        for x in range(256):
            px[x, y] = lerp(start, end, (x + y) / 510)
    img = grad.resize((big, big), Image.BICUBIC).convert("RGBA")

    overlay = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    c = big / 2
    rings = [  # radius, width, sweep (degrees), alpha
        (0.34, 0.075, 300, 255),
        (0.235, 0.075, 230, 210),
        (0.13, 0.075, 160, 165),
    ]
    for r, w, sweep, alpha in rings:
        rad, wid = r * big, w * big
        box = [c - rad, c - rad, c + rad, c + rad]
        d.arc(box, 0, 360, fill=(255, 255, 255, 34), width=int(wid))
        d.arc(box, -90, -90 + sweep, fill=(255, 255, 255, alpha), width=int(wid))
        for angle in (-90, -90 + sweep):  # round caps
            a = math.radians(angle)
            mid = rad - wid / 2
            x, y = c + mid * math.cos(a), c + mid * math.sin(a)
            d.ellipse([x - wid / 2, y - wid / 2, x + wid / 2, y + wid / 2], fill=(255, 255, 255, alpha))
    img = Image.alpha_composite(img, overlay).convert("RGB").resize((size, size), Image.LANCZOS)
    img.save(path, "PNG")


def main():
    write_json(os.path.join(ROOT, "Contents.json"), {"info": {"author": "xcode", "version": 1}})
    colorset("AccentColor", "5B4BE8", "8A7DFF")
    colorset("BrandStart", "5B4BE8", "6D5EF0")
    colorset("BrandEnd", "F25F8C", "E0527F")
    colorset("BrandCoral", "FF6B5E", "FF7A6E")
    colorset("BrandMint", "2BC79B", "3BD6A9")
    colorset("CardBackground", "FFFFFF", "1E1E26")

    iconset = os.path.join(ROOT, "AppIcon.appiconset")
    os.makedirs(iconset, exist_ok=True)
    icon(os.path.join(iconset, "AppIcon-1024.png"))
    write_json(os.path.join(iconset, "Contents.json"), {
        "images": [{"filename": "AppIcon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
        "info": {"author": "xcode", "version": 1},
    })


if __name__ == "__main__":
    main()
