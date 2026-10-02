# -*- coding: utf-8 -*-
"""
内置姿势管线第一步:Blender headless 批量产「姿势骨向 JSON」。

用法:
  Blender -b --python blender_dump.py -- <输出.json 绝对路径>

机制(spike 2026-10-02 验证,见记忆 blender-pose-import-spike):
  1. 建 human metarig 当源骨架,按姿势定义用「最短弧把骨骼 Y 轴摆到世界
     方向」(aim)摆姿——不用导入任何模型,与具体角色解耦
  2. 摆好后 dump 22 根映射源骨的世界 Y 轴方向(Blender 系:Z 上,-Y 前)
  3. 变换成 three.js 系(x, z, -y)写出,骨名直接用项目侧名(mixamorig*,
     FBXLoader 剥冒号后的形式)

姿势定义即数据:POSES 里每姿势是一串 (源骨, Blender 世界方向),按根到叶
顺序 aim。方向是粗近似,效果以冒烟为准,调姿势只改这张表。
产物经 build_seed_poses.mjs 换算成最终 PoseBones 后随包播种。
"""
import bpy, json, math, sys
from mathutils import Matrix, Quaternion, Vector

# 目标(项目侧骨名)→ 源(metarig 骨名)。顺序即根到叶。
MAP = [
    ('mixamorigHips',          'spine'),
    ('mixamorigSpine',         'spine.001'),
    ('mixamorigSpine1',        'spine.002'),
    ('mixamorigSpine2',        'spine.003'),
    ('mixamorigNeck',          'spine.004'),
    ('mixamorigHead',          'spine.006'),
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

# 方向速记:Blender 系(Z 上,-Y 前,角色左手在 +X 侧)
UP    = (0, 0, 1)
DOWN  = (0, 0, -1)
FWD   = (0, -1, 0)
BACK  = (0, 1, 0)

def v(x, y, z):
    return (x, y, z)

# 每姿势:显示名 + aim 序列(根到叶)。只列要动的骨,其余保持 metarig rest。
# metarig rest:直立,手臂 A 形斜下约 45°,腿并拢。
POSES = [
    ('stand-relaxed', '站立放松', [
        ('upper_arm.L', v(0.22, 0.02, -0.97)), ('forearm.L', v(0.18, -0.04, -0.98)),
        ('upper_arm.R', v(-0.22, 0.02, -0.97)), ('forearm.R', v(-0.18, -0.04, -0.98)),
        ('thigh.L', v(0.07, 0, -1)), ('thigh.R', v(-0.07, 0, -1)),
    ]),
    ('arms-akimbo', '叉腰', [
        ('upper_arm.L', v(0.55, -0.10, -0.82)), ('forearm.L', v(-0.30, -0.30, -0.90)),
        ('upper_arm.R', v(-0.55, -0.10, -0.82)), ('forearm.R', v(0.30, -0.30, -0.90)),
        ('thigh.L', v(0.10, 0, -0.99)), ('thigh.R', v(-0.10, 0, -0.99)),
    ]),
    ('wave-right', '挥手', [
        ('upper_arm.R', v(-0.35, -0.05, 0.93)), ('forearm.R', v(-0.10, -0.05, 0.99)),
        ('upper_arm.L', v(0.20, 0.02, -0.98)), ('forearm.L', v(0.16, -0.04, -0.99)),
    ]),
    ('cheer', '欢呼', [
        ('upper_arm.L', v(0.38, 0, 0.92)), ('forearm.L', v(0.20, 0, 0.98)),
        ('upper_arm.R', v(-0.38, 0, 0.92)), ('forearm.R', v(-0.20, 0, 0.98)),
        ('spine.002', v(0, 0.10, 0.99)),
    ]),
    ('point-forward', '前指', [
        ('upper_arm.R', v(-0.05, -0.98, 0.17)), ('forearm.R', v(0, -1, 0)),
        ('upper_arm.L', v(0.20, 0.02, -0.98)),
    ]),
    ('think', '思考', [
        ('upper_arm.R', v(-0.45, -0.55, -0.70)), ('forearm.R', v(0.35, 0.10, 0.93)),
        ('spine.006', v(0, -0.18, 0.98)),
        ('upper_arm.L', v(0.25, -0.05, -0.97)), ('forearm.L', v(0.45, -0.30, -0.84)),
    ]),
    ('sit-chair', '坐椅子', [
        ('thigh.L', v(0.06, -0.99, 0.05)), ('shin.L', v(0.04, -0.05, -0.99)),
        ('foot.L', v(0, -0.85, -0.53)),
        ('thigh.R', v(-0.06, -0.99, 0.05)), ('shin.R', v(-0.04, -0.05, -0.99)),
        ('foot.R', v(0, -0.85, -0.53)),
        ('upper_arm.L', v(0.18, -0.25, -0.95)), ('forearm.L', v(0.10, -0.65, -0.75)),
        ('upper_arm.R', v(-0.18, -0.25, -0.95)), ('forearm.R', v(-0.10, -0.65, -0.75)),
    ]),
    ('squat', '下蹲', [
        ('thigh.L', v(0.08, -0.96, -0.25)), ('shin.L', v(0.05, -0.15, -0.99)),
        ('thigh.R', v(-0.08, -0.96, -0.25)), ('shin.R', v(-0.05, -0.15, -0.99)),
        ('spine.001', v(0, -0.30, 0.95)), ('spine.006', v(0, 0.10, 0.99)),
        ('upper_arm.L', v(0.15, -0.55, -0.82)), ('forearm.L', v(0.05, -0.85, -0.52)),
        ('upper_arm.R', v(-0.15, -0.55, -0.82)), ('forearm.R', v(-0.05, -0.85, -0.52)),
    ]),
    ('kneel', '跪姿', [
        ('thigh.L', v(0.04, -0.15, -0.99)), ('shin.L', v(0.02, 0.96, -0.25)),
        ('foot.L', v(0, 0.90, -0.44)),
        ('thigh.R', v(-0.04, -0.15, -0.99)), ('shin.R', v(-0.02, 0.96, -0.25)),
        ('foot.R', v(0, 0.90, -0.44)),
        ('spine.001', v(0, 0.06, 1.0)),
    ]),
    ('walk-stride', '行走跨步', [
        ('thigh.L', v(0.05, -0.70, -0.71)), ('shin.L', v(0.03, -0.25, -0.97)),
        ('foot.L', v(0, -0.55, -0.84)),
        ('thigh.R', v(-0.05, 0.45, -0.89)), ('shin.R', v(-0.03, 0.25, -0.97)),
        ('foot.R', v(0, -0.20, -0.98)),
        ('upper_arm.L', v(0.22, 0.35, -0.91)), ('forearm.L', v(0.15, 0.25, -0.96)),
        ('upper_arm.R', v(-0.22, -0.35, -0.91)), ('forearm.R', v(-0.15, -0.50, -0.85)),
        ('spine.002', v(0, -0.06, 1.0)),
    ]),
    ('lie-down', '平躺', [
        ('spine', v(0, 0.99, 0.06)),
        ('spine.001', v(0, 0.99, 0.04)), ('spine.002', v(0, 0.99, 0.02)),
        ('spine.003', v(0, 0.99, 0.02)), ('spine.004', v(0, 0.99, 0.04)),
        ('spine.006', v(0, 0.97, 0.22)),
        ('thigh.L', v(0.05, 0.99, -0.06)), ('shin.L', v(0.04, 1.0, -0.02)),
        ('foot.L', v(0, 0.35, 0.94)),
        ('thigh.R', v(-0.05, 0.99, -0.06)), ('shin.R', v(-0.04, 1.0, -0.02)),
        ('foot.R', v(0, 0.35, 0.94)),
        ('upper_arm.L', v(0.25, 0.96, -0.10)), ('forearm.L', v(0.20, 0.98, -0.05)),
        ('upper_arm.R', v(-0.25, 0.96, -0.10)), ('forearm.R', v(-0.20, 0.98, -0.05)),
    ]),
    ('bow', '鞠躬', [
        ('spine.001', v(0, -0.45, 0.89)), ('spine.002', v(0, -0.55, 0.84)),
        ('spine.003', v(0, -0.55, 0.84)), ('spine.006', v(0, -0.35, 0.94)),
        ('upper_arm.L', v(0.20, -0.30, -0.93)), ('forearm.L', v(0.15, -0.40, -0.90)),
        ('upper_arm.R', v(-0.20, -0.30, -0.93)), ('forearm.R', v(-0.15, -0.40, -0.90)),
    ]),
]


def world_Y(arm, pb):
    return ((arm.matrix_world @ pb.matrix).to_3x3() @ Vector((0, 1, 0))).normalized()


def aim_Y(arm, pb, world_dir):
    """最短弧把骨骼 Y 轴摆到世界方向(保位置,roll 取弧的自然结果)"""
    cur = world_Y(arm, pb)
    q = cur.rotation_difference(Vector(world_dir).normalized())
    m = arm.matrix_world @ pb.matrix
    new_rot = (q.to_matrix().to_4x4() @ m).to_quaternion()
    pb.matrix = arm.matrix_world.inverted() @ (
        Matrix.Translation(m.to_translation()) @ new_rot.to_matrix().to_4x4()
    )
    bpy.context.view_layer.update()


def to_three(d):
    """Blender 世界(Z 上,-Y 前)→ three.js 世界(Y 上,+Z 前)"""
    return [round(d[0], 5), round(d[2], 5), round(-d[1], 5)]


def main():
    out_path = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/poses_directions.json'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.preferences.addon_enable(module='rigify')
    except Exception:
        pass
    bpy.ops.object.armature_human_metarig_add()
    meta = bpy.context.active_object
    bpy.context.view_layer.update()

    poses_out = []
    for key, name, aims in POSES:
        # 每姿势从 rest 重来
        for pb in meta.pose.bones:
            pb.matrix_basis.identity()
        bpy.context.view_layer.update()
        for bone_name, direction in aims:
            aim_Y(meta, meta.pose.bones[bone_name], direction)
        dirs = {}
        for three_name, src_name in MAP:
            dirs[three_name] = to_three(world_Y(meta, meta.pose.bones[src_name]))
        poses_out.append({'key': key, 'name': name, 'dirs': dirs})
        print('POSE_OK', key)

    doc = {
        'format': 'pose-directions-v1',
        'source': 'blender-metarig-procedural',
        'coordinate': 'three (y-up, +z-forward)',
        'poses': poses_out,
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print('DUMP_OK', out_path, len(poses_out))


main()
