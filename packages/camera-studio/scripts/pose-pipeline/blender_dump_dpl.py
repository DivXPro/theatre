# -*- coding: utf-8 -*-
"""
内置姿势管线第一步(DPL 变体):读 Dynamic Pose Library 的 .blend 姿势文件,
批量产「姿势骨向 JSON」。

用法:
  Blender -b --python blender_dump_dpl.py -- <合集根目录> <输出.json>

合集来源:Gumroad 免费包 Dynamic Pose Library Free(BlendAtlas),解压后
poses/ 下每主题一目录、每姿势一个 .blend。文件结构(2026-10-03 探明):
单骨架 HG_Pose(metarig 命名,125 骨),姿势直接烘在当前 pose 上,无 action、
无资产标记——打开文件读 pose 骨世界 Y 轴即可,不用 generate rig。

与 blender_dump.py 的差异:
  - 源骨架是各文件自带的 HG metarig(脖子/头叫 neck/head,不是默认 metarig
    的 spine.004/spine.006),映射表独立
  - 映射含 30 根手指骨(thumb/f_index/f_middle/f_ring/f_pinky .01-.03,
    对应 Mixamo 每指 3 节;metacarpal 类的 palm.01-04 无对应,跳过)
  - 「DPL Base Retargeting」目录是 A/T 等基准参考,过滤不入库
产物经 build_seed_poses.ts 换算成最终 PoseBones 后随包播种。
"""
import bpy, json, re, sys
from pathlib import Path
from mathutils import Vector

# 目标(项目侧骨名)→ 源(HG metarig 骨名)。顺序即根到叶。
MAP = [
    ('mixamorigHips',          'spine'),
    ('mixamorigSpine',         'spine.001'),
    ('mixamorigSpine1',        'spine.002'),
    ('mixamorigSpine2',        'spine.003'),
    ('mixamorigNeck',          'neck'),
    ('mixamorigHead',          'head'),
    ('mixamorigLeftShoulder',  'shoulder.L'),
    ('mixamorigLeftArm',       'upper_arm.L'),
    ('mixamorigLeftForeArm',   'forearm.L'),
    ('mixamorigLeftHand',      'hand.L'),
    ('mixamorigRightShoulder', 'shoulder.R'),
    ('mixamorigRightArm',      'upper_arm.R'),
    ('mixamorigRightForeArm',  'forearm.R'),
    ('mixamorigRightHand',     'hand.R'),
    ('mixamorigLeftUpLeg',     'thigh.L'),
    ('mixamorigLeftLeg',       'shin.L'),
    ('mixamorigLeftFoot',      'foot.L'),
    ('mixamorigLeftToeBase',   'toe.L'),
    ('mixamorigRightUpLeg',    'thigh.R'),
    ('mixamorigRightLeg',      'shin.R'),
    ('mixamorigRightFoot',     'foot.R'),
    ('mixamorigRightToeBase',  'toe.R'),
]
# 手指:每指 3 节 × 5 指 × 双手
for side_t, side_s in [('Left', 'L'), ('Right', 'R')]:
    for three_f, src_f in [
        ('Thumb', 'thumb'), ('Index', 'f_index'), ('Middle', 'f_middle'),
        ('Ring', 'f_ring'), ('Pinky', 'f_pinky'),
    ]:
        for i in (1, 2, 3):
            MAP.append((
                f'mixamorig{side_t}Hand{three_f}{i}',
                f'{src_f}.0{i}.{side_s}',
            ))

# 主题目录 → 显示名前缀(不入库的目录映射到 None)
CATEGORY = {
    'DPL Celebration': '庆祝', 'DPL Combat': '打斗', 'DPL Couples': '双人',
    'DPL Dancing': '跳舞', 'DPL Exercise': '健身', 'DPL Falling': '坠落',
    'DPL Horror': '恐怖', 'DPL PinUps': '海报', 'DPL Pool': '泳池',
    'DPL Sitting': '坐姿', 'DPL Standing': '站立', 'DPL Super Heroes': '超级英雄',
    'DPL Urban': '街头', 'DPL Yoga': '瑜伽', 'Sitting': '坐姿',
    'Socializing': '社交', 'Sporting': '运动', 'Standing around': '随意站',
    'DPL Base Retargeting': None,  # A/T 等基准参考,过滤
}


def world_Y(arm, pb):
    return ((arm.matrix_world @ pb.matrix).to_3x3() @ Vector((0, 1, 0))).normalized()


def to_three(d):
    """Blender 世界(Z 上,-Y 前)→ three.js 世界(Y 上,+Z 前)"""
    return [round(d[0], 5), round(d[2], 5), round(-d[1], 5)]


def clean_name(stem):
    """文件名→姿势名:优先取末对括号内容,否则去 HG_ 前缀、下划线换空格"""
    m = re.search(r'\(([^()]*)\)[^()]*$', stem)
    if m:
        return m.group(1).strip()
    return re.sub(r'_+', ' ', re.sub(r'^HG_', '', stem)).strip()


def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')


def dedup_cat(cat_slug, name):
    """名称以主题词开头的剥掉(sitting/Sitting legs...→Legs...),防 key 叠字"""
    s = slug(name)
    if s == cat_slug:
        return 'pose'
    if s.startswith(cat_slug + '-'):
        return s[len(cat_slug) + 1:]
    return s


def pick_armature():
    """选映射命中率最高的骨架(防个别文件多骨架/带道具)"""
    best, best_hit = None, 0
    src_names = [s for _, s in MAP]
    for o in bpy.data.objects:
        if o.type != 'ARMATURE':
            continue
        hit = sum(1 for n in src_names if n in o.pose.bones)
        if hit > best_hit:
            best, best_hit = o, hit
    return best, best_hit


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    root, out_path = Path(argv[0]), argv[1]

    files = sorted(root.rglob('*.blend'))
    poses_out, skipped = [], []
    seen_keys = set()
    for f in files:
        cat = CATEGORY.get(f.parent.name, '未分类')
        if cat is None:
            continue  # 基准参考目录
        bpy.ops.wm.open_mainfile(filepath=str(f))
        arm, hit = pick_armature()
        if arm is None or hit < len(MAP) * 0.9:
            skipped.append((str(f), hit))
            print('SKIP', f.name, f'命中 {hit}/{len(MAP)}')
            continue
        name = clean_name(f.stem)
        cat_slug = slug(re.sub(r'^DPL\s+', '', f.parent.name))
        key = 'dpl-' + cat_slug + '-' + dedup_cat(cat_slug, name)
        assert key not in seen_keys, f'key 冲突: {key} ({f})'
        seen_keys.add(key)
        dirs = {}
        for three_name, src_name in MAP:
            pb = arm.pose.bones.get(src_name)
            if pb is not None:
                dirs[three_name] = to_three(world_Y(arm, pb))
        poses_out.append({'key': key, 'name': f'{cat} · {name}', 'dirs': dirs})
        print('POSE_OK', key, f'({len(dirs)} 骨)')

    doc = {
        'format': 'pose-directions-v1',
        'source': 'dynamic-pose-library-free (BlendAtlas, gumroad)',
        'coordinate': 'three (y-up, +z-forward)',
        'poses': poses_out,
    }
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    print('DUMP_OK', out_path, len(poses_out), '个姿势,', len(skipped), '个跳过')


main()
