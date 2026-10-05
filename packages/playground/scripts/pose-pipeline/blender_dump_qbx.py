# -*- coding: utf-8 -*-
"""
内置姿势管线第一步(QBX 手势变体):读 QBX Pose Asset Pack 单文件 .blend
里的姿势资产(action),批量产「仅手指骨向 JSON」。

用法:
  Blender -b <QBX .blend> --python blender_dump_qbx.py -- <blender_assets.cats.txt> <输出.json>

合集来源:Gumroad 免费包 QBX Pose Asset Pack v1.1(qbx.gumroad.com/l/qbxpap)。
文件结构(2026-10-05 探明):单文件 198MB,内嵌 Female/Male 两具标准 Rigify
metarig(各 159 骨),481 个姿势以 asset 标记的 action 存放;目录归属靠
blender_assets.cats 的 UUID → catalog 路径(如 Female/03_Hands/01_Base)。

与 blender_dump_dpl.py 的差异:
  - 姿势不在当前 pose,而在 asset action 里:逐个赋给骨架、frame_set 后读
    pose 骨世界 Y;赋前全骨 matrix_basis 复位(未 key 的骨保持上一姿势的坑)
  - 只取 */03_Hands/* 目录(01_Base/02_Other/03_Signs/04_Weapons),
    且只输出 30 根手指骨(不含手腕)——产物是叠加用的纯手势片段
  - 每手势 Female/Male 两份去重留 Female(骨向是世界系,性别差由
    retarget 吸收),L/R 手都保留
产物经 build_seed_poses.ts 换算成最终 PoseBones 后随包播种。
"""
import bpy, json, re, sys
from pathlib import Path
from mathutils import Matrix, Vector

# 目标(项目侧骨名)→ 源(Rigify metarig 骨名):每指 3 节 × 5 指 × 双手。
# 纯手势:不含手腕(hand.L/R),应用时手臂保持当前姿势
MAP = []
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

# 目录末段 → 显示名前缀
CATEGORY = {
    '01_Base': '基础', '02_Other': '其他', '03_Signs': '手势',
    '04_Weapons': '持握',
}
SIDE_NAME = {'L': '左手', 'R': '右手'}


def parse_cats(path):
    """blender_assets.cats:UUID → catalog 路径(如 Female/03_Hands/01_Base)"""
    cats = {}
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('VERSION'):
            continue
        uuid, cat_path, _name = line.split(':', 2)
        cats[uuid] = cat_path
    return cats


def to_three(d):
    """Blender 世界(Z 上,-Y 前)→ three.js 世界(Y 上,+Z 前)"""
    return [round(d[0], 5), round(d[2], 5), round(-d[1], 5)]


def world_Y(arm, pb):
    return ((arm.matrix_world @ pb.matrix).to_3x3() @ Vector((0, 1, 0))).normalized()


def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')


def split_name(action_name):
    """'Claw L F' → ('Claw', 'L');无侧名的 → (名, None)。
    末尾 F/M 是骨架性别标记,已在过滤阶段剥掉。"""
    m = re.match(r'^(.*?)\s+([LR])$', action_name)
    if m:
        return m.group(1), m.group(2)
    return action_name, None


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    cats_path, out_path = argv[0], argv[1]
    cats = parse_cats(cats_path)

    arms = {o.name: o for o in bpy.data.objects if o.type == 'ARMATURE'}
    female = arms.get('Female')
    assert female is not None, '未找到 Female 骨架'
    # 手势按目录挑;Female/Male 去重只留 F 尾
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

    if female.animation_data is None:
        female.animation_data_create()

    poses_out, skipped = [], []
    seen_keys = set()
    for act, cat in picked:
        subcat = cat.rsplit('/', 1)[-1]
        base, side = split_name(act.name[:-2])  # 剥 ' F'
        key = 'qbx-hands-' + slug(subcat) + '-' + slug(base)
        if side:
            key += '-' + side.lower()
        if key in seen_keys:
            skipped.append((act.name, 'key 冲突'))
            continue
        seen_keys.add(key)

        # 复位全骨再赋 action:未 key 的骨不能带上一姿势的残留
        female.animation_data.action = None
        for pb in female.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        female.animation_data.action = act
        frame = int(round(act.frame_range[0]))
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()

        dirs, miss = {}, []
        for three_name, src_name in MAP:
            pb = female.pose.bones.get(src_name)
            if pb is not None:
                dirs[three_name] = to_three(world_Y(female, pb))
            else:
                miss.append(src_name)
        if miss:
            skipped.append((act.name, f'缺骨 {len(miss)}: {miss[:3]}'))
            print('SKIP', act.name, f'缺 {len(miss)}/{len(MAP)} 骨')
            continue
        disp = f'{CATEGORY.get(subcat, subcat)} · {base}'
        if side:
            disp += f' · {SIDE_NAME[side]}'
        poses_out.append({'key': key, 'name': disp, 'dirs': dirs})
        print('POSE_OK', key, f'({len(dirs)} 骨)')

    doc = {
        'format': 'pose-directions-v1',
        'source': 'QBX Pose Asset Pack v1.1 (qbx.gumroad.com, 免费包)',
        'coordinate': 'three (y-up, +z-forward)',
        'poses': poses_out,
    }
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    print('DUMP_OK', out_path, len(poses_out), '个手势,', len(skipped), '个跳过')


# --python 直接跑时是 __main__;blender_export_qbx_previews.py 会 import
# 本文件复用 parse_cats/slug/split_name,加守卫避免导入即执行
if __name__ == '__main__':
    main()
