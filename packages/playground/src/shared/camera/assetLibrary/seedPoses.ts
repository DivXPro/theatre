// 本文件由 scripts/pose-pipeline/build_seed_poses.ts 生成,勿手改。
// 重新生成:npx tsx scripts/pose-pipeline/build_seed_poses.ts
// (骨向来源:scripts/pose-pipeline/blender_dump.py → poses_directions.json)
import type {PoseBones} from '../poseMode/poseOverride'

export type SeedPose = {key: string; name: string; bones: PoseBones}

export const seedPoses: SeedPose[] = [
  {
    key: 'stand-relaxed',
    name: '站立放松',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.07746, 0, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.35844, -0.62368, 0.60379, -0.34348],
      },
      mixamorigLeftArm: {
        rotation: [-0.60102, -0.16109, -0.1952, -0.75811],
      },
      mixamorigLeftForeArm: {
        rotation: [0.02042, 0.02451, 0.03028, 0.99903],
      },
      mixamorigLeftHand: {
        rotation: [0.03087, -0.01908, -0.02166, 0.99911],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.35846, -0.62369, 0.60378, 0.34346],
      },
      mixamorigRightArm: {
        rotation: [0.60101, -0.16106, -0.19522, 0.75811],
      },
      mixamorigRightForeArm: {
        rotation: [0.02042, -0.02451, -0.03028, 0.99903],
      },
      mixamorigRightHand: {
        rotation: [0.03087, 0.01908, 0.02166, 0.99911],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [0.00419, 0.12574, 0.99145, -0.03468],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00402, -0.00063, 0.99615],
      },
      mixamorigLeftFoot: {
        rotation: [0.52736, -0.01069, -0.00075, 0.84957],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27532, -0.03549, -0.01404, 0.96059],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [-0.0042, 0.12574, 0.99145, 0.03468],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00402, 0.00063, 0.99615],
      },
      mixamorigRightFoot: {
        rotation: [0.52736, 0.01069, 0.00075, 0.84957],
      },
      mixamorigRightToeBase: {
        rotation: [0.27533, 0.03509, 0.01393, 0.96061],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'arms-akimbo',
    name: '叉腰',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.07746, 0, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.35844, -0.62368, 0.60379, -0.34348],
      },
      mixamorigLeftArm: {
        rotation: [-0.45083, -0.12001, -0.2885, -0.83613],
      },
      mixamorigLeftForeArm: {
        rotation: [0.39767, 0.07583, 0.19111, 0.89419],
      },
      mixamorigLeftHand: {
        rotation: [0.02947, -0.04319, -0.02352, 0.99836],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.35846, -0.62369, 0.60378, 0.34346],
      },
      mixamorigRightArm: {
        rotation: [0.45082, -0.11998, -0.28851, 0.83614],
      },
      mixamorigRightForeArm: {
        rotation: [0.39768, -0.0758, -0.1911, 0.8942],
      },
      mixamorigRightHand: {
        rotation: [0.02947, 0.04318, 0.02353, 0.99836],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [0.00603, 0.12565, 0.9908, -0.04995],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00564, -0.00089, 0.99614],
      },
      mixamorigLeftFoot: {
        rotation: [0.52733, -0.02354, -0.00628, 0.84931],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27482, -0.03795, -0.02178, 0.9605],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [-0.00604, 0.12565, 0.9908, 0.04995],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00565, 0.00089, 0.99614],
      },
      mixamorigRightFoot: {
        rotation: [0.52733, 0.02354, 0.00628, 0.84931],
      },
      mixamorigRightToeBase: {
        rotation: [0.27483, 0.03755, 0.02167, 0.96052],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'wave-right',
    name: '挥手',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.07746, 0, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.35844, -0.62368, 0.60379, -0.34348],
      },
      mixamorigLeftArm: {
        rotation: [-0.60918, -0.16333, -0.19339, -0.75155],
      },
      mixamorigLeftForeArm: {
        rotation: [0.02028, 0.02491, 0.03009, 0.99903],
      },
      mixamorigLeftHand: {
        rotation: [0.03094, -0.0194, -0.02155, 0.9991],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.35846, -0.62369, 0.60378, 0.34346],
      },
      mixamorigRightArm: {
        rotation: [-0.54968, 0.15237, -0.24343, 0.78446],
      },
      mixamorigRightForeArm: {
        rotation: [-0.12901, -0.00124, -0.00515, 0.99163],
      },
      mixamorigRightHand: {
        rotation: [0.02406, -0.02513, 0.02904, 0.99897],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [-0.0001, 0.16367, 0.98651, -0.00002],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00012, -0.00003, 0.99616],
      },
      mixamorigLeftFoot: {
        rotation: [0.52723, 0.01894, 0.01198, 0.84943],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27566, -0.03063, 0.00363, 0.96076],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [0.00009, 0.16367, 0.98651, 0.00002],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00012, 0.00003, 0.99616],
      },
      mixamorigRightFoot: {
        rotation: [0.52723, -0.01894, -0.01198, 0.84943],
      },
      mixamorigRightToeBase: {
        rotation: [0.27566, 0.03023, -0.00374, 0.96077],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'cheer',
    name: '欢呼',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.11173, -0.00001, 0, 0.99374],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.37791, -0.63453, 0.5918, -0.32299],
      },
      mixamorigLeftArm: {
        rotation: [0.55079, 0.14764, -0.17993, -0.80153],
      },
      mixamorigLeftForeArm: {
        rotation: [-0.09482, 0, -0.00654, 0.99547],
      },
      mixamorigLeftHand: {
        rotation: [0.02515, 0.0243, -0.02809, 0.99899],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.37793, -0.63454, 0.59179, 0.32298],
      },
      mixamorigRightArm: {
        rotation: [-0.5508, 0.14766, -0.1799, 0.80153],
      },
      mixamorigRightForeArm: {
        rotation: [-0.09482, 0, 0.00654, 0.99547],
      },
      mixamorigRightHand: {
        rotation: [0.02515, -0.0243, 0.02809, 0.99899],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [-0.0001, 0.16367, 0.98651, -0.00002],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00012, -0.00003, 0.99616],
      },
      mixamorigLeftFoot: {
        rotation: [0.52723, 0.01894, 0.01198, 0.84943],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27566, -0.03063, 0.00363, 0.96076],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [0.00009, 0.16367, 0.98651, 0.00002],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00012, 0.00003, 0.99616],
      },
      mixamorigRightFoot: {
        rotation: [0.52723, -0.01894, -0.01198, 0.84943],
      },
      mixamorigRightToeBase: {
        rotation: [0.27566, 0.03023, -0.00374, 0.96077],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'point-forward',
    name: '前指',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.07746, 0, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.35844, -0.62368, 0.60379, -0.34348],
      },
      mixamorigLeftArm: {
        rotation: [-0.60918, -0.16333, -0.19339, -0.75155],
      },
      mixamorigLeftForeArm: {
        rotation: [-0.00518, 0.15194, 0.1862, 0.97068],
      },
      mixamorigLeftHand: {
        rotation: [0.03551, -0.02092, -0.01268, 0.99907],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.35846, -0.62369, 0.60378, 0.34346],
      },
      mixamorigRightArm: {
        rotation: [-0.11704, 0.03276, -0.84511, 0.52059],
      },
      mixamorigRightForeArm: {
        rotation: [0.08329, 0.08329, -0.03228, 0.99251],
      },
      mixamorigRightHand: {
        rotation: [0.03287, 0.03287, 0.01848, 0.99875],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [-0.0001, 0.16367, 0.98651, -0.00002],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00012, -0.00003, 0.99616],
      },
      mixamorigLeftFoot: {
        rotation: [0.52723, 0.01894, 0.01198, 0.84943],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27566, -0.03063, 0.00363, 0.96076],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [0.00009, 0.16367, 0.98651, 0.00002],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00012, 0.00003, 0.99616],
      },
      mixamorigRightFoot: {
        rotation: [0.52723, -0.01894, -0.01198, 0.84943],
      },
      mixamorigRightToeBase: {
        rotation: [0.27566, 0.03023, -0.00374, 0.96077],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'think',
    name: '思考',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.07746, 0, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.09787, 0, 0, 0.9952],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.35844, -0.62368, 0.60379, -0.34348],
      },
      mixamorigLeftArm: {
        rotation: [-0.58922, -0.15794, -0.24034, -0.75506],
      },
      mixamorigLeftForeArm: {
        rotation: [-0.1309, 0.09232, 0.11249, 0.98066],
      },
      mixamorigLeftHand: {
        rotation: [0.03484, -0.01558, -0.01442, 0.99917],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.35846, -0.62369, 0.60378, 0.34346],
      },
      mixamorigRightArm: {
        rotation: [0.39516, -0.10552, -0.53762, 0.73735],
      },
      mixamorigRightForeArm: {
        rotation: [-0.93069, -0.22825, 0.25927, 0.12044],
      },
      mixamorigRightHand: {
        rotation: [-0.02347, 0.04593, -0.02951, 0.99823],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [-0.0001, 0.16367, 0.98651, -0.00002],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00012, -0.00003, 0.99616],
      },
      mixamorigLeftFoot: {
        rotation: [0.52723, 0.01894, 0.01198, 0.84943],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27566, -0.03063, 0.00363, 0.96076],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [0.00009, 0.16367, 0.98651, 0.00002],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00012, 0.00003, 0.99616],
      },
      mixamorigRightFoot: {
        rotation: [0.52723, -0.01894, -0.01198, 0.84943],
      },
      mixamorigRightToeBase: {
        rotation: [0.27566, 0.03023, -0.00374, 0.96077],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'sit-chair',
    name: '坐椅子',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.07746, 0, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.35844, -0.62368, 0.60379, -0.34348],
      },
      mixamorigLeftArm: {
        rotation: [-0.59579, -0.16011, -0.36133, -0.69917],
      },
      mixamorigLeftForeArm: {
        rotation: [-0.06986, 0.18941, 0.2166, 0.95516],
      },
      mixamorigLeftHand: {
        rotation: [0.03725, -0.02607, -0.00586, 0.99895],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.35846, -0.62369, 0.60378, 0.34346],
      },
      mixamorigRightArm: {
        rotation: [0.59579, -0.16008, -0.36134, 0.69917],
      },
      mixamorigRightForeArm: {
        rotation: [-0.06985, -0.18938, -0.2166, 0.95517],
      },
      mixamorigRightHand: {
        rotation: [0.03725, 0.02607, 0.00586, 0.99895],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [0.0034, 0.80415, 0.5926, -0.04636],
      },
      mixamorigLeftLeg: {
        rotation: [-0.70548, 0.01131, -0.03279, 0.70788],
      },
      mixamorigLeftFoot: {
        rotation: [0.46322, 0.00973, -0.00698, 0.88616],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27568, -0.02979, 0.00057, 0.96079],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [-0.0034, 0.80415, 0.5926, 0.04637],
      },
      mixamorigRightLeg: {
        rotation: [-0.70548, -0.01131, 0.03279, 0.70788],
      },
      mixamorigRightFoot: {
        rotation: [0.46322, -0.00973, 0.00698, 0.88616],
      },
      mixamorigRightToeBase: {
        rotation: [0.27568, 0.02939, -0.00069, 0.9608],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'squat',
    name: '下蹲',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [0.02678, 0, 0, 0.99964],
      },
      mixamorigSpine1: {
        rotation: [-0.07747, -0.00001, 0, 0.997],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0.00001, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.32451, -0.00001, 0, 0.94588],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.30497, -0.59169, 0.63248, -0.39605],
      },
      mixamorigLeftArm: {
        rotation: [-0.55354, -0.11742, -0.55116, -0.61321],
      },
      mixamorigLeftForeArm: {
        rotation: [-0.11954, 0.18767, 0.1827, 0.95766],
      },
      mixamorigLeftHand: {
        rotation: [0.03716, -0.03333, -0.0064, 0.99873],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.30499, -0.59171, 0.63247, 0.39603],
      },
      mixamorigRightArm: {
        rotation: [0.55355, -0.11738, -0.55116, 0.61322],
      },
      mixamorigRightForeArm: {
        rotation: [-0.11952, -0.18765, -0.18272, 0.95766],
      },
      mixamorigRightHand: {
        rotation: [0.03716, 0.03332, 0.0064, 0.99873],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [0.00446, 0.7043, 0.70796, -0.05233],
      },
      mixamorigLeftLeg: {
        rotation: [-0.5484, 0.00955, -0.03262, 0.83553],
      },
      mixamorigLeftFoot: {
        rotation: [0.52713, -0.00646, 0.01562, 0.84962],
      },
      mixamorigLeftToeBase: {
        rotation: [0.2756, -0.04406, -0.00657, 0.96024],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [-0.00447, 0.7043, 0.70796, 0.05233],
      },
      mixamorigRightLeg: {
        rotation: [-0.5484, -0.00955, 0.03262, 0.83553],
      },
      mixamorigRightFoot: {
        rotation: [0.52713, 0.00646, -0.01562, 0.84962],
      },
      mixamorigRightToeBase: {
        rotation: [0.27561, 0.04366, 0.00646, 0.96026],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'kneel',
    name: '跪姿',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.15548, -0.00001, 0, 0.98784],
      },
      mixamorigSpine1: {
        rotation: [-0.07747, 0, 0, 0.99699],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.40934, -0.65106, 0.57051, -0.28822],
      },
      mixamorigLeftArm: {
        rotation: [-0.20459, -0.06514, -0.18603, -0.9588],
      },
      mixamorigLeftForeArm: {
        rotation: [0.00768, 0.05073, 0.18611, 0.98119],
      },
      mixamorigLeftHand: {
        rotation: [0.03302, -0.00952, -0.01822, 0.99924],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.40937, -0.65107, 0.57049, 0.28821],
      },
      mixamorigRightArm: {
        rotation: [0.20459, -0.06512, -0.18604, 0.9588],
      },
      mixamorigRightForeArm: {
        rotation: [0.00768, -0.05072, -0.18611, 0.98119],
      },
      mixamorigRightHand: {
        rotation: [0.03302, 0.00952, 0.01822, 0.99924],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [0.00219, 0.19991, 0.97961, -0.01993],
      },
      mixamorigLeftLeg: {
        rotation: [-0.66897, 0.01493, -0.00514, 0.74312],
      },
      mixamorigLeftFoot: {
        rotation: [0.09975, 0.00346, -0.01061, 0.99495],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27564, -0.01241, 0.0046, 0.96117],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [-0.00219, 0.19991, 0.97961, 0.01993],
      },
      mixamorigRightLeg: {
        rotation: [-0.66897, -0.01493, 0.00514, 0.74312],
      },
      mixamorigRightFoot: {
        rotation: [0.09975, -0.00346, 0.01061, 0.99495],
      },
      mixamorigRightToeBase: {
        rotation: [0.27564, 0.01203, -0.00471, 0.96117],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'walk-stride',
    name: '行走跨步',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [-0.06448, -0.00001, 0, 0.99792],
      },
      mixamorigSpine1: {
        rotation: [-0.03166, 0, 0, 0.9995],
      },
      mixamorigSpine2: {
        rotation: [0.00163, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20174, 0.00001, 0, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.18773, -0.00001, 0, 0.98222],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.3319, -0.60818, 0.61878, -0.37023],
      },
      mixamorigLeftArm: {
        rotation: [-0.55912, -0.14801, 0.05902, -0.81363],
      },
      mixamorigLeftForeArm: {
        rotation: [0.05463, 0.04568, 0.03674, 0.99678],
      },
      mixamorigLeftHand: {
        rotation: [0.02658, -0.01388, -0.02675, 0.99919],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.33192, -0.6082, 0.61877, 0.37021],
      },
      mixamorigRightArm: {
        rotation: [0.59606, -0.14886, -0.372, 0.69582],
      },
      mixamorigRightForeArm: {
        rotation: [0.00485, -0.06667, -0.08803, 0.99387],
      },
      mixamorigRightHand: {
        rotation: [0.03322, 0.02604, 0.01785, 0.99895],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [0.00218, 0.49236, 0.86995, -0.02755],
      },
      mixamorigLeftLeg: {
        rotation: [-0.25964, 0.00103, -0.01328, 0.96561],
      },
      mixamorigLeftFoot: {
        rotation: [0.16327, 0.01522, -0.01121, 0.9864],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27568, -0.02444, -0.00075, 0.96094],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [-0.00381, -0.1075, 0.99387, 0.0256],
      },
      mixamorigRightLeg: {
        rotation: [0.10757, -0.00111, 0.01084, 0.99414],
      },
      mixamorigRightFoot: {
        rotation: [0.22502, -0.01456, 0.01094, 0.97418],
      },
      mixamorigRightToeBase: {
        rotation: [0.27568, 0.01929, 0.00063, 0.96106],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'lie-down',
    name: '平躺',
    bones: {
      mixamorigHips: {
        rotation: [-0.68538, -0.00003, 0.00003, 0.72818],
      },
      mixamorigSpine: {
        rotation: [-0.01008, -0.00001, 0, 0.99995],
      },
      mixamorigSpine1: {
        rotation: [-0.01009, 0.00001, 0, 0.99995],
      },
      mixamorigSpine2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.01009, 0, 0, 0.99995],
      },
      mixamorigHead: {
        rotation: [0.0912, 0.00001, -0.00001, 0.99583],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.66993, -0.69366, 0.21033, 0.16061],
      },
      mixamorigLeftArm: {
        rotation: [0.16157, 0.13823, 0.57342, -0.79119],
      },
      mixamorigLeftForeArm: {
        rotation: [-0.02363, -0.02044, -0.02809, 0.99912],
      },
      mixamorigLeftHand: {
        rotation: [0.03385, 0.0283, 0.01661, 0.99889],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.66995, -0.69367, 0.21026, -0.16055],
      },
      mixamorigRightArm: {
        rotation: [-0.16152, 0.13819, 0.57343, 0.79119],
      },
      mixamorigRightForeArm: {
        rotation: [-0.02362, 0.02044, 0.02809, 0.99912],
      },
      mixamorigRightHand: {
        rotation: [0.03385, -0.0283, -0.01661, 0.99889],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [-0.02354, -0.99747, 0.06112, -0.02766],
      },
      mixamorigLeftLeg: {
        rotation: [-0.02045, 0.01135, -0.00434, 0.99972],
      },
      mixamorigLeftFoot: {
        rotation: [0.57759, -0.06817, 0.03822, -0.81258],
      },
      mixamorigLeftToeBase: {
        rotation: [0.02231, -0.46701, -0.27478, 0.84018],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [0.02354, -0.99747, 0.06112, 0.02775],
      },
      mixamorigRightLeg: {
        rotation: [-0.02045, -0.01135, 0.00434, 0.99972],
      },
      mixamorigRightFoot: {
        rotation: [0.57759, 0.06818, -0.03822, -0.81258],
      },
      mixamorigRightToeBase: {
        rotation: [0.02243, 0.46663, 0.27477, 0.84039],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
  {
    key: 'bow',
    name: '鞠躬',
    bones: {
      mixamorigHips: {
        rotation: [0.12582, 0, 0, 0.99205],
      },
      mixamorigSpine: {
        rotation: [0.1077, 0, 0, 0.99418],
      },
      mixamorigSpine1: {
        rotation: [0.05576, 0, 0, 0.99844],
      },
      mixamorigSpine2: {
        rotation: [0, 0.00001, 0, 1],
      },
      mixamorigNeck: {
        rotation: [0.20173, 0.00001, 0.00001, 0.97944],
      },
      mixamorigHead: {
        rotation: [-0.3096, -0.00001, -0.00001, 0.95087],
      },
      mixamorigHeadTop_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftShoulder: {
        rotation: [-0.17143, -0.49986, 0.68092, -0.50705],
      },
      mixamorigLeftArm: {
        rotation: [-0.68994, -0.08918, -0.36753, -0.61721],
      },
      mixamorigLeftForeArm: {
        rotation: [0.005, 0.04367, 0.05784, 0.99736],
      },
      mixamorigLeftHand: {
        rotation: [0.02312, -0.03146, -0.02979, 0.99879],
      },
      mixamorigLeftHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandRing4: {
        rotation: [0.00001, 0.0074, 0.00077, 0.99997],
      },
      mixamorigLeftHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandMiddle4: {
        rotation: [0, 0.00458, -0.00065, 0.99999],
      },
      mixamorigLeftHandThumb1: {
        rotation: [0.25189, -0.05946, 0.22192, 0.94009],
      },
      mixamorigLeftHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigLeftHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandThumb4: {
        rotation: [0.00915, 0.12564, 0.07207, 0.98941],
      },
      mixamorigLeftHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex2: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigLeftHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigLeftHandIndex4: {
        rotation: [0, 0.004, 0.00002, 0.99999],
      },
      mixamorigLeftHandPinky1: {
        rotation: [0, 0, 0.00014, 1],
      },
      mixamorigLeftHandPinky2: {
        rotation: [-0.00001, 0, -0.00037, 1],
      },
      mixamorigLeftHandPinky3: {
        rotation: [0, 0, 0.00023, 1],
      },
      mixamorigLeftHandPinky4: {
        rotation: [0, 0.0041, -0.00058, 0.99999],
      },
      mixamorigRightShoulder: {
        rotation: [0.17144, -0.49989, 0.68092, 0.50702],
      },
      mixamorigRightArm: {
        rotation: [0.68993, -0.08915, -0.36754, 0.61722],
      },
      mixamorigRightForeArm: {
        rotation: [0.00501, -0.04367, -0.05784, 0.99736],
      },
      mixamorigRightHand: {
        rotation: [0.02312, 0.03146, 0.02979, 0.99879],
      },
      mixamorigRightHandThumb1: {
        rotation: [0.25189, 0.05946, -0.22192, 0.94009],
      },
      mixamorigRightHandThumb2: {
        rotation: [0.00001, 0, 0, 1],
      },
      mixamorigRightHandThumb3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandThumb4: {
        rotation: [0.00923, -0.12713, -0.07233, 0.9892],
      },
      mixamorigRightHandIndex1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandIndex3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandIndex4: {
        rotation: [-0.00007, -0.00671, 0.00137, 0.99998],
      },
      mixamorigRightHandMiddle1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle2: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandMiddle4: {
        rotation: [-0.00005, -0.0067, -0.00171, 0.99998],
      },
      mixamorigRightHandRing1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandRing3: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandRing4: {
        rotation: [-0.00006, -0.00761, -0.0003, 0.99997],
      },
      mixamorigRightHandPinky1: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightHandPinky2: {
        rotation: [0, 0, 0.00001, 1],
      },
      mixamorigRightHandPinky3: {
        rotation: [0, 0, -0.00001, 1],
      },
      mixamorigRightHandPinky4: {
        rotation: [-0.00008, -0.0085, 0.00221, 0.99996],
      },
      mixamorigLeftUpLeg: {
        rotation: [-0.0001, 0.16367, 0.98651, -0.00002],
      },
      mixamorigLeftLeg: {
        rotation: [-0.08754, 0.00012, -0.00003, 0.99616],
      },
      mixamorigLeftFoot: {
        rotation: [0.52723, 0.01894, 0.01198, 0.84943],
      },
      mixamorigLeftToeBase: {
        rotation: [0.27566, -0.03063, 0.00363, 0.96076],
      },
      mixamorigLeftToe_End: {
        rotation: [0, 0, 0, 1],
      },
      mixamorigRightUpLeg: {
        rotation: [0.00009, 0.16367, 0.98651, 0.00002],
      },
      mixamorigRightLeg: {
        rotation: [-0.08754, -0.00012, 0.00003, 0.99616],
      },
      mixamorigRightFoot: {
        rotation: [0.52723, -0.01894, -0.01198, 0.84943],
      },
      mixamorigRightToeBase: {
        rotation: [0.27566, 0.03023, -0.00374, 0.96077],
      },
      mixamorigRightToe_End: {
        rotation: [0, 0, 0, 1],
      },
    },
  },
]
