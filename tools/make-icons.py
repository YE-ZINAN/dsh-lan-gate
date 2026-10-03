#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从一张母图生成 PWA / App 所需的全套图标。

用法：
    python tools/make-icons.py <母图路径>

产出（写入 assets/）：
    icon-512.png           标准图标（含完整图案与文字）
    icon-192.png           安卓中等尺寸
    icon-180.png           iOS apple-touch-icon
    icon-maskable-512.png  安卓自适应图标（内容收在中心 80% 安全区内）
    icon-source.png        裁掉多余留白后的母图（备查）

设计取舍：
  · 背景用不透明近白（与母图底色一致）。iOS 对带透明通道的 apple-touch-icon
    合成行为不确定，必须不透明。
  · 先按「与背景差异」自动裁掉母图四周多余留白，再等比缩放居中，
    这样图标里的图案能尽量大。
  · maskable 版把内容压到中心 80%，避免安卓圆形/方形裁切切掉鲸鱼。
"""

import os
import sys
from PIL import Image, ImageChops

# 母图底色（实测四角均值），用作画布填充色
BG = (249, 250, 249)
# 判定「属于图案」的阈值：与底色差异超过这个值才算内容
TOL = 14


def content_bbox(im, bg=BG, tol=TOL):
    """算出图案的紧致外接框（自动去掉四周留白）。"""
    bg_im = Image.new("RGB", im.size, bg)
    diff = ImageChops.difference(im, bg_im).convert("L")
    mask = diff.point(lambda v: 255 if v > tol else 0)
    box = mask.getbbox()
    return box or (0, 0, im.size[0], im.size[1])


def make_icon(src, out_path, size, fill_ratio=1.0):
    """
    生成方形图标。
    fill_ratio：内容占画布比例上限（1.0 = 尽量充满；0.8 = 留出 10% 边距给裁切）。
    """
    canvas = Image.new("RGB", (size, size), BG)
    target = int(round(size * fill_ratio))
    w, h = src.size
    scale = min(target / w, target / h)
    new = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    resized = src.resize(new, Image.LANCZOS)
    canvas.paste(resized, ((size - new[0]) // 2, (size - new[1]) // 2))
    canvas.save(out_path, "PNG", optimize=True)
    return new


def main():
    if len(sys.argv) < 2:
        print("用法: python tools/make-icons.py <母图路径>")
        return 1

    src_path = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    proj = os.path.dirname(here)
    assets = os.path.join(proj, "assets")
    os.makedirs(assets, exist_ok=True)

    im = Image.open(src_path).convert("RGB")
    print("母图: %s  尺寸 %s" % (src_path, im.size))

    box = content_bbox(im)
    print("自动去留白: %s -> %s" % (im.size, box))
    trimmed = im.crop(box)
    # 裁完再补一点点对称边距，避免图案顶到边缘
    pad = int(round(max(trimmed.size) * 0.02))
    padded = Image.new("RGB", (trimmed.size[0] + pad * 2, trimmed.size[1] + pad * 2), BG)
    padded.paste(trimmed, (pad, pad))

    padded.save(os.path.join(assets, "icon-source.png"), "PNG", optimize=True)

    jobs = [
        ("icon-512.png", 512, 1.0),
        ("icon-192.png", 192, 1.0),
        ("icon-180.png", 180, 1.0),
        ("icon-maskable-512.png", 512, 0.80),
    ]
    for name, size, ratio in jobs:
        out = os.path.join(assets, name)
        new = make_icon(padded, out, size, ratio)
        # 控制台可能是不支持中文的 GBK 编码，这里只用 ASCII 输出
        print("  [ok] %-24s %dx%d  art=%dx%d  fill=%.2f  %d bytes"
              % (name, size, size, new[0], new[1], ratio, os.path.getsize(out)))

    print("\n全部写入: %s" % assets)
    return 0


if __name__ == "__main__":
    sys.exit(main())
