# -*- coding: utf-8 -*-
"""探测:QBX blend 里姿势资产(action)的内嵌预览图能否导出。

用法:
  Blender -b <QBX .blend> --python blender_preview_probe.py -- <输出目录>

动作资产标记过(asset_data 非空)且在资产浏览器渲过预览的,action.preview
会带 image_size > 0 的像素数据,随 blend 保存;这里抽样导出 5 张 PNG
验证存在性、尺寸与观感。
"""
import bpy, sys
from pathlib import Path

out_dir = Path(sys.argv[sys.argv.index('--') + 1])
out_dir.mkdir(parents=True, exist_ok=True)

actions = [a for a in bpy.data.actions if a.asset_data is not None]
print('PROBE assets:', len(actions), '/', len(bpy.data.actions), 'actions')

with_preview = 0
exported = 0
for act in actions:
    prev = act.preview
    if prev is None or prev.image_size[0] == 0:
        continue
    with_preview += 1
    if exported >= 5:
        continue
    w, h = prev.image_size
    img = bpy.data.images.new(f'probe_{exported}', width=w, height=h)
    # image_pixels_float:RGBA 浮点,长度 = w*h*4
    img.pixels = prev.image_pixels_float[:]
    img.filepath_raw = str(out_dir / f'probe_{exported}_{act.name[:40]}.png')
    img.file_format = 'PNG'
    img.save()
    print('PROBE_OK', img.filepath_raw, f'{w}x{h}')
    bpy.data.images.remove(img)
    exported += 1

print('PROBE_DONE with_preview =', with_preview, ', exported =', exported)
