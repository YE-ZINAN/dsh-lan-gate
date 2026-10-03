#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把示例截图拼成一张 2x2 网格图，供 README 使用。

用法：
    python tools/make-example.py <输出> <图1> <图2> <图3> <图4> [裁剪规格]

摆放顺序（左上 → 右上 → 左下 → 右下）：
    左上 = 手机主屏幕   右上 = iPad 主屏幕
    左下 = 手机上运行   右下 = iPad 上运行

裁剪规格（可选）：形如
    "220,830,760,760;;;"
分号分隔四张图，每段是 `x,y,w,h`；留空表示不裁。
两张主屏幕截图整幅留着的话，图标只占几个像素，所以默认裁到图标附近。

设计取舍：
  · 两行**不等高**：上排是图标特写（矮），下排是完整界面（高）。
    原先强制等高的做法会留出大片空白 —— 手机竖图约 9:19.5，
    iPad 横图约 1.44:1，两个比例差太多，等高必然一边留白。
  · 每格内按比例 contain 缩放居中，**不裁切内容、不变形**。
  · 白底 + 细边框，深浅色主题下都能看。
  · 图里不写字：加中文标签会让英文 README 别扭，说明交给图注。
"""

import os
import sys
from PIL import Image, ImageDraw

CELL_W = 660
ROW_H = [400, 880]          # 上排（图标特写）矮，下排（完整界面）高
GAP = 16
PAD = 24
BG = (255, 255, 255)
BORDER = (226, 229, 234)


def fit_contain(img, box_w, box_h):
    w, h = img.size
    scale = min(box_w / w, box_h / h)
    return img.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)


def main():
    if len(sys.argv) < 6:
        print(__doc__)
        return 1

    out_path = sys.argv[1]
    srcs = sys.argv[2:6]
    crop_spec = sys.argv[6] if len(sys.argv) > 6 else ""
    crops = (crop_spec.split(";") + [""] * 4)[:4]

    total_w = PAD * 2 + CELL_W * 2 + GAP
    total_h = PAD * 2 + sum(ROW_H) + GAP
    canvas = Image.new("RGB", (total_w, total_h), BG)
    draw = ImageDraw.Draw(canvas)

    for idx, src in enumerate(srcs):
        row, col = divmod(idx, 2)
        x0 = PAD + col * (CELL_W + GAP)
        y0 = PAD + (0 if row == 0 else ROW_H[0] + GAP)
        ch = ROW_H[row]

        draw.rectangle([x0, y0, x0 + CELL_W - 1, y0 + ch - 1], outline=BORDER, width=1)

        im = Image.open(src).convert("RGB")
        note = ""
        if crops[idx].strip():
            parts = [int(v) for v in crops[idx].split(",")]
            im = im.crop((parts[0], parts[1], parts[0] + parts[2], parts[1] + parts[3]))
            note = "  裁自 %s" % parts

        fitted = fit_contain(im, CELL_W - 2, ch - 2)
        canvas.paste(fitted, (x0 + (CELL_W - fitted.size[0]) // 2,
                              y0 + (ch - fitted.size[1]) // 2))
        print("  [%d] %-20s %sx%s -> %sx%s%s"
              % (idx + 1, os.path.basename(src), im.size[0], im.size[1],
                 fitted.size[0], fitted.size[1], note))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    ext = os.path.splitext(out_path)[1].lower()
    if ext in (".jpg", ".jpeg"):
        canvas.save(out_path, "JPEG", quality=92, optimize=True, progressive=True)
    else:
        canvas.save(out_path, "PNG", optimize=True)
    print("\n已生成: %s  %dx%d  %d 字节" % (out_path, total_w, total_h, os.path.getsize(out_path)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
