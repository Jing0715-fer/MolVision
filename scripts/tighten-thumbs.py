#!/usr/bin/env python3
"""tighten-thumbs.py — r89 缩略图内容感知收紧（打磨已有模板的管线级落地）

背景（r89 像素实测）：全部 37 张缩略图的分子内容包围盒仅占画布 24-76%
（引擎默认 fit 边距大 + 2:1 视口 vs 球形分子的几何现实）——画廊/分类行卡片
用 aspect-16/10 + object-cover 展示，源图内容不满幅 = 卡片里分子显小。

方案（零裁切风险）：截图后后处理——
  1. 内容包围盒检测（与四角背景色差 > 阈值 40）；
  2. 包围盒 + 8% 余量裁剪；
  3. 等比缩放放进 640×320（16:10）画布，内容覆盖率约 92%，居中；
  4. 背景用采样底色填充（深底/白底/雾底各自保真）。

不变项：不碰模板命令序列（相机零改动）、不碰卡片 CSS（object-cover 语义
不变）。全部 37 张原地重写（git 可回溯）。

用法：python3 scripts/tighten-thumbs.py [--dry]
"""
import sys
import os
import re
from PIL import Image
import numpy as np

PROJECT = '/home/z/my-project'
OUT_DIR = os.path.join(PROJECT, 'public/templates')
W, H = 640, 320          # 16:10 目标画布（与管线产出同尺寸）
MARGIN = 0.08            # 包围盒外余量（相对 max(bboxW, bboxH)）
COVERAGE = 0.92          # 内容在目标画布的覆盖率（留一点呼吸边）
DIFF_TH = 40             # 与背景色的总色差阈值（RGB 三通道和）
MIN_BOX = 24             # 最小包围盒（防全空图误裁）

BG_FALLBACK = (255, 255, 255)


def content_bbox(im: Image.Image):
    a = np.asarray(im.convert('RGB')).astype(int)
    h, w, _ = a.shape
    # 背景采样：四角 6×6 中位（抗局部水印/HUD 残影）
    corners = np.concatenate([
        a[:6, :6].reshape(-1, 3), a[:6, -6:].reshape(-1, 3),
        a[-6:, :6].reshape(-1, 3), a[-6:, -6:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0)
    diff = np.abs(a - bg).sum(axis=2)
    mask = diff > DIFF_TH
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None, tuple(int(v) for v in bg)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    if (x1 - x0) < MIN_BOX or (y1 - y0) < MIN_BOX:
        return None, tuple(int(v) for v in bg)
    return (x0, y0, x1, y1), tuple(int(v) for v in bg)


def tighten(path: str, dry: bool) -> str:
    im = Image.open(path).convert('RGB')
    bbox, bg = content_bbox(im)
    if bbox is None:
        return 'skip（无内容或过小）'
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    m = int(max(bw, bh) * MARGIN)
    # 余量扩展（钳制在画布内）
    x0, y0 = max(0, x0 - m), max(0, y0 - m)
    x1, y1 = min(im.width, x1 + m), min(im.height, y1 + m)
    crop = im.crop((x0, y0, x1, y1))
    # 等比缩放至目标覆盖率的内接框
    target_w, target_h = int(W * COVERAGE), int(H * COVERAGE)
    s = min(target_w / crop.width, target_h / crop.height)
    nw, nh = max(1, int(crop.width * s)), max(1, int(crop.height * s))
    content = crop.resize((nw, nh), Image.LANCZOS)
    # 16:10 底布（采样背景色）+ 内容居中
    canvas = Image.new('RGB', (W, H), bg or BG_FALLBACK)
    canvas.paste(content, ((W - nw) // 2, (H - nh) // 2))
    before = (bw / im.width, bh / im.height)
    if not dry:
        canvas.save(path, optimize=True)
    return f'bbox {before[0]*100:.0f}%×{before[1]*100:.0f}% → 收紧 {W}×{H}'


def main() -> None:
    dry = '--dry' in sys.argv
    # r104 作用域化：命令行传 id 列表则只处理指定项（增量管线模式——旧图免重采样
    # 漂移；每轮全量 tighten 对旧图做裁剪 + LANCZOS 往返，实测单轮 5-13% 边缘像素
    # 漂移累积为生成损失）。无参 = 全量（有意全量重生成的场合）。
    scope = [a for a in sys.argv[1:] if a != '--dry']
    # 从 figure-templates.ts 提取内置模板 id 序（与管线口径一致）
    src = open(os.path.join(PROJECT, 'src/lib/molecular/figure-templates.ts'), encoding='utf-8').read()
    ids = re.findall(r"id: '([a-z-]+)'", src)
    if scope:
        unknown = [a for a in scope if a not in ids]
        if unknown:
            print(f'ERROR: tighten 作用域含未知名 {unknown}（可用：见 figure-templates.ts）')
            sys.exit(1)
        ids = [i for i in ids if i in scope]
        print(f'作用域模式：仅处理 {len(ids)} 张（{"、".join(ids[:4])}{"…" if len(ids) > 4 else ""}）')
    files = [f'{i}.png' for i in ids if os.path.exists(os.path.join(OUT_DIR, f'{i}.png'))]
    print(f'内置模板 {len(ids)} · 存图 {len(files)} 张')
    changed = 0
    for f in files:
        p = os.path.join(OUT_DIR, f)
        size_before = os.path.getsize(p)
        msg = tighten(p, dry)
        if 'skip' not in msg:
            changed += 1
        print(f'  {f:26s} {msg}')
    print(f'{"[DRY] " if dry else ""}完成：{changed} 张收紧')


if __name__ == '__main__':
    main()
