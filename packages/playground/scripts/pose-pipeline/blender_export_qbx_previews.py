# -*- coding: utf-8 -*-
"""QBX 预览图批量导出(2026-10-05,姿势缩略图方案 A)。

QBX 包的姿势资产(action)内嵌 128×128 资产浏览器预览图(作者渲好随
blend 保存),直接抽像素存 PNG,随包发布给手势选择框当缩略图。

用法:
  Blender -b <QBX .blend> --python blender_export_qbx_previews.py -- <blender_assets.cats.txt> <输出目录>

过滤/命名与 blender_dump_qbx.py 严格一致(同目录、Female 去重、同 key),
保证每张图能按 key 对上 seedPosesQbx 里的条目。产物:<out>/<key>.png。
"""
import bpy, sys
from pathlib import Path

# 与 blender_dump_qbx.py 同源的纯函数直接复用,避免两份过滤逻辑漂移
sys.path.insert(0, str(Path(__file__).parent))
from blender_dump_qbx import parse_cats, slug, split_name  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    cats_path, out_dir = argv[0], Path(argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    cats = parse_cats(cats_path)

    picked = []
    for act in bpy.data.actions:
        if not act.asset_data:
            continue
        cat = cats.get(str(act.asset_data.catalog_id), '')
        if '/03_Hands/' not in cat:
            continue
        if not act.name.endswith(' F'):
            continue
        picked.append((act, cat))
    picked.sort(key=lambda t: t[0].name)
    print('PICKED', len(picked), '个手势资产')

    exported, skipped = 0, []
    seen_keys = set()
    for act, cat in picked:
        subcat = cat.rsplit('/', 1)[-1]
        base, side = split_name(act.name[:-2])
        key = 'qbx-hands-' + slug(subcat) + '-' + slug(base)
        if side:
            key += '-' + side.lower()
        if key in seen_keys:
            skipped.append((act.name, 'key 冲突'))
            continue
        seen_keys.add(key)

        prev = act.preview
        if prev is None or prev.image_size[0] == 0:
            skipped.append((act.name, '无预览图'))
            print('SKIP', act.name, '无预览图')
            continue
        w, h = prev.image_size
        img = bpy.data.images.new(f'prev_{key}', width=w, height=h)
        img.pixels = prev.image_pixels_float[:]
        img.filepath_raw = str(out_dir / f'{key}.png')
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
        exported += 1

    print('EXPORT_OK', out_dir, exported, '张,', len(skipped), '个跳过')


main()
