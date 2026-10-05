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
  - 每手势 Female/Male 两份去重留 Female,L/R 手都保留
  - 方向是「手腕相对」(v2,2026-10-05 起):源包模型手臂下垂,按世界方向
    提取会把手臂姿态烤进手势,应用到 T 姿势骨架时手指相对手腕错位
    (拇指最显眼,实测最差 120°)。改为每姿势先取手腕骨(hand.L/R)的
    世界旋转 W,手指方向存 W⁻¹·dir;build 侧用目标骨架手腕 rest 还原
  - 按侧裁骨(2026-10-05 二轮):源包有的 action 名字没带侧(Peace Flipped
    其实是左手)或侧标在名字中间(Gun 03 L ...),运行时的列表过滤靠名字
    后缀,无后缀=双手手势会两侧都列——挂错侧应用就是「没效果」。
    提取时先录 rest 基准,逐姿势量每侧与 rest 的最大偏差(未动侧恒
    0.2°,动了的最小 14.5°,阈值 5°),未动侧的骨不写;恰好单侧动了
    且名字没带侧后缀的,补上「· 左手/右手」。两侧都没动的(base=
    rest 本体)保留双骨,当中立手势用
  - 源包漏帧补丁(2026-10-05 三轮):FU R / Peace Flipped R 的右小指
    三节完全没 key(Female/Male 版都恒等于 rest),左手对应姿势是蜷好
    的——把左小指方向经世界镜像(x 取反)换算进右手腕系补上
产物经 build_seed_poses.ts 换算成最终 PoseBones 后随包播种。
"""
import bpy, json, math, re, sys
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

# 手腕骨(方向参考系):three 侧 → 源侧
WRIST = {'Left': 'hand.L', 'Right': 'hand.R'}

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


def capture_dirs(arm):
    """当前 pose 下 30 根手指骨的手腕相对方向(向量,未转 three 系)+ 缺骨
    + 两手腕的世界旋转(漏帧补丁做镜像换算要用)"""
    wrist_rot = {}
    wrist_world = {}
    for side_t, src_name in WRIST.items():
        pb = arm.pose.bones.get(src_name)
        if pb is not None:
            wrist_world[side_t] = (arm.matrix_world @ pb.matrix).to_3x3()
            wrist_rot[side_t] = wrist_world[side_t].inverted()
    dirs, miss = {}, []
    for three_name, src_name in MAP:
        pb = arm.pose.bones.get(src_name)
        if pb is not None:
            side_t = 'Left' if three_name.startswith('mixamorigLeft') else 'Right'
            if side_t in wrist_rot:
                dirs[three_name] = (wrist_rot[side_t] @ world_Y(arm, pb)).normalized()
        else:
            miss.append(src_name)
    return dirs, miss, wrist_world


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

    # rest 基准:复位后采一遍,作「该侧动不动」的判定参照
    for pb in female.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    rest_dirs, rest_miss, _ = capture_dirs(female)
    assert not rest_miss, f'rest 缺骨: {rest_miss}'

    SIDE_OF = lambda b: 'Left' if b.startswith('mixamorigLeft') else 'Right'
    POSE_SIDE = {'Left': '左手', 'Right': '右手'}
    SIDE_THRESHOLD = math.radians(5)  # 未动侧恒 ~0.2°,动了的最小 14.5°

    poses_out, skipped = [], []
    raw = []
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

        dirs, miss, wrist_world = capture_dirs(female)
        if miss:
            skipped.append((act.name, f'缺骨 {len(miss)}: {miss[:3]}'))
            print('SKIP', act.name, f'缺 {len(miss)}/{len(MAP)} 骨')
            continue

        # 按侧裁骨:偏差超阈值才算动了;两侧都没动(base=rest)按名字侧
        # 留单骨(中立手势每侧有自己的条目),无名字侧才保留双骨
        dev = {}
        for side_t in ('Left', 'Right'):
            dev[side_t] = max(
                dirs[b].angle(rest_dirs[b])
                for b in dirs
                if SIDE_OF(b) == side_t
            )
        posed = [s for s in ('Left', 'Right') if dev[s] > SIDE_THRESHOLD]
        if not posed:
            posed = (
                ['Left' if side == 'L' else 'Right']
                if side
                else ['Left', 'Right']
            )
        dirs = {b: u for b, u in dirs.items() if SIDE_OF(b) in posed}

        disp = f'{CATEGORY.get(subcat, subcat)} · {base}'
        if side:
            disp += f' · {SIDE_NAME[side]}'
            # 名字侧与实测动侧不一致 → 告警(包作者标错)
            if len(posed) == 1 and posed[0] != ('Left' if side == 'L' else 'Right'):
                print('WARN_SIDE', act.name, '名字侧', side, '实测动侧', posed)
        elif len(posed) == 1:
            # 名字没带侧但实测单侧动了 → 补侧后缀(否则运行时按双手手势
            # 两侧都列,挂错侧应用无效果)
            disp += f' · {POSE_SIDE[posed[0]]}'
        raw.append({
            'key': key,
            'name': disp,
            'dirs': dirs,
            'wrist': wrist_world,
        })
        print('POSE_OK', key, f'({len(dirs)} 骨, 动侧 {"+".join(posed)})')

    # 源包漏帧补丁:这两条右手 action 的右小指三节完全没 key(Female/Male
    # 版都恒等于 rest,2026-10-05 探针实测),而左手对应姿势小指是蜷好的
    # (作者意图明确)。把左小指方向经世界镜像(x 取反,角色关于 x=0 平面
    # 对称)换算进右手腕系补上;其余 14 骨本就镜像一致,不动
    PINKY_PATCH = [
        ('qbx-hands-03-signs-fu-r', 'qbx-hands-03-signs-fu-l'),
        ('qbx-hands-03-signs-peace-flipped-r', 'qbx-hands-03-signs-peace-flipped'),
    ]
    by_key = {r['key']: r for r in raw}
    for dst_key, src_key in PINKY_PATCH:
        dst, src = by_key.get(dst_key), by_key.get(src_key)
        assert dst is not None and src is not None, f'补丁缺料: {dst_key}/{src_key}'
        wr_inv = dst['wrist']['Right'].inverted()
        for i in (1, 2, 3):
            u_l = src['dirs'][f'mixamorigLeftHandPinky{i}']
            world_l = (src['wrist']['Left'] @ u_l).normalized()
            mirrored = Vector((-world_l.x, world_l.y, world_l.z))
            dst['dirs'][f'mixamorigRightHandPinky{i}'] = (
                wr_inv @ mirrored
            ).normalized()
        print('PATCH_PINKY', dst_key, '<-', src_key)

    poses_out = [
        {'key': r['key'], 'name': r['name'],
         'dirs': {b: to_three(u) for b, u in r['dirs'].items()}}
        for r in raw
    ]

    doc = {
        'format': 'pose-directions-v2',
        'space': 'wrist',
        'wristBones': WRIST,
        'source': 'QBX Pose Asset Pack v1.1 (qbx.gumroad.com, 免费包)',
        'coordinate': 'three (y-up, +z-forward);方向为手腕骨(hand.L/R)系',
        'poses': poses_out,
    }
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    print('DUMP_OK', out_path, len(poses_out), '个手势,', len(skipped), '个跳过')


# --python 直接跑时是 __main__;blender_export_qbx_previews.py 会 import
# 本文件复用 parse_cats/slug/split_name,加守卫避免导入即执行
if __name__ == '__main__':
    main()
