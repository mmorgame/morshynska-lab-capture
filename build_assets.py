import os
import shutil
import math
from PIL import Image, ImageDraw, ImageFilter

BASE_DIR = r"C:\Users\Erik\.gemini\antigravity\scratch\morshynska_capture_studio"
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
BIN_DIR = os.path.join(BASE_DIR, "bin")
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(BIN_DIR, exist_ok=True)

# 1. Copy compresso_ffmpeg.exe into bin/ffmpeg.exe
src_ffmpeg = r"D:\backup work\VIDEO COMPRESSOR\compresso_ffmpeg.exe"
dst_ffmpeg = os.path.join(BIN_DIR, "ffmpeg.exe")
if os.path.exists(src_ffmpeg) and not os.path.exists(dst_ffmpeg):
    shutil.copy2(src_ffmpeg, dst_ffmpeg)
    print("Copied ffmpeg.exe:", os.path.getsize(dst_ffmpeg))


def draw_app_icon(size=512):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(size * 0.04)
    radius = int(size * 0.24)

    # Outer neon glow
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        outline=(0, 245, 212, 180),
        width=int(size * 0.045),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=size * 0.025))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # Dark obsidian body gradient
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(body)
    for y in range(pad, size - pad):
        t = (y - pad) / max(1, (size - 2 * pad))
        r = int(19 * (1 - t) + 6 * t)
        g = int(35 * (1 - t) + 11 * t)
        b = int(66 * (1 - t) + 22 * t)
        bdraw.line([(pad, y), (size - pad, y)], fill=(r, g, b, 255))

    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=255)
    body.putalpha(mask)
    img = Image.alpha_composite(img, body)
    draw = ImageDraw.Draw(img)

    # Rim border
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        outline=(0, 225, 235, 255),
        width=max(2, int(size * 0.038)),
    )

    # Viewfinder corner brackets
    bw = max(2, int(size * 0.038))
    c_min = int(size * 0.22)
    c_max = int(size * 0.78)
    arm = int(size * 0.10)
    col_cyan = (0, 245, 212, 255)
    col_blue = (0, 187, 249, 255)

    # Top-Left
    draw.line([(c_min, c_min + arm), (c_min, c_min), (c_min + arm, c_min)], fill=col_cyan, width=bw)
    # Top-Right
    draw.line([(c_max - arm, c_min), (c_max, c_min), (c_max, c_min + arm)], fill=col_cyan, width=bw)
    # Bottom-Left
    draw.line([(c_min, c_max - arm), (c_min, c_max), (c_min + arm, c_max)], fill=col_blue, width=bw)
    # Bottom-Right
    draw.line([(c_max - arm, c_max), (c_max, c_max), (c_max, c_max - arm)], fill=col_blue, width=bw)

    # Central lens circle
    cx, cy = size // 2, size // 2
    lr = int(size * 0.20)
    draw.ellipse(
        [cx - lr, cy - lr, cx + lr, cy + lr],
        fill=(5, 11, 22, 255),
        outline=(0, 230, 230, 255),
        width=bw,
    )

    # Central Hydro Drop inside lens
    drop_top = int(cy - size * 0.13)
    drop_bot = int(cy + size * 0.11)
    drop_r = int(size * 0.082)
    # Circle bottom of drop + triangle top
    draw.polygon(
        [
            (cx, drop_top),
            (cx - int(drop_r * 0.95), cy + int(size * 0.015)),
            (cx + int(drop_r * 0.95), cy + int(size * 0.015)),
        ],
        fill=(0, 245, 212, 255),
    )
    draw.ellipse(
        [cx - drop_r, drop_bot - 2 * drop_r, cx + drop_r, drop_bot],
        fill=(0, 215, 235, 255),
    )

    # Ruby REC dot at top-right of lens
    rx = int(size * 0.69)
    ry = int(size * 0.31)
    rr = int(size * 0.052)
    draw.ellipse([rx - rr, ry - rr, rx + rr, ry + rr], fill=(255, 42, 95, 255))

    return img


icon_512 = draw_app_icon(512)
icon_png_path = os.path.join(ASSETS_DIR, "icon.png")
icon_ico_path = os.path.join(ASSETS_DIR, "icon.ico")
icon_512.save(icon_png_path, format="PNG")
icon_512.save(
    icon_ico_path,
    format="ICO",
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
print("Generated icon.png and icon.ico successfully!")
