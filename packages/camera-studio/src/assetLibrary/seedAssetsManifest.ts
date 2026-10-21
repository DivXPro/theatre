// 本文件由 build_seed_assets_manifest.ts 生成,勿手改。
// 重新生成:npx tsx packages/camera-studio/scripts/pose-pipeline/build_seed_assets_manifest.ts
// 模型 GLB 由 scripts/pose-pipeline/models/*.fbx 经运行时导入管线(FBXLoader+exportModelGLB)
// 转换产出,提交在 assets/models/;rig 与 contentHash 的算法见脚本头注释。
export type SeedModelAsset = {
  /** 运行时 id 用稳定 key(小写连字符),如 catalog:runtime/model/<key> */
  key: string
  /** assets/models/ 下的文件名( served 相对路径 models/<file> ) */
  file: string
  /** GLB 字节 FNV-1a;条目 id = seed-model-<contentHash> */
  contentHash: string
  name: string
  /** 运行时 FBX 解析同一判定(rigIdOf);勿用 GLB joints 重算(剥骨/双套差异) */
  rig: string
  boneCount: number
  vertexCount: number
}

export type SeedPoseThumbAsset = {
  /** 姿势种子 key(qbx-hands-*),与姿势条目 id 后缀一致 */
  key: string
  file: string
}

export type SeedAssetsManifest = {
  models: SeedModelAsset[]
  poseThumbs: SeedPoseThumbAsset[]
}

export const seedAssetsManifest: SeedAssetsManifest = {
  models: [
    {
      key: 'y-bot',
      file: 'Y Bot.glb',
      contentHash: 'd1b47880a8a72b81',
      name: 'Y Bot',
      rig: 'rig-16a71e249f45355b',
      boneCount: 117,
      vertexCount: 165960,
    },
  ],
  poseThumbs: [
    {key: 'qbx-hands-01-base-base-l', file: 'qbx-hands-01-base-base-l.png'},
    {key: 'qbx-hands-01-base-base-r', file: 'qbx-hands-01-base-base-r.png'},
    {
      key: 'qbx-hands-01-base-point-relaxed-l',
      file: 'qbx-hands-01-base-point-relaxed-l.png',
    },
    {
      key: 'qbx-hands-01-base-point-relaxed-r',
      file: 'qbx-hands-01-base-point-relaxed-r.png',
    },
    {
      key: 'qbx-hands-01-base-point-straight-l',
      file: 'qbx-hands-01-base-point-straight-l.png',
    },
    {
      key: 'qbx-hands-01-base-point-straight-r',
      file: 'qbx-hands-01-base-point-straight-r.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-01-l',
      file: 'qbx-hands-01-base-relaxed-01-l.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-01-r',
      file: 'qbx-hands-01-base-relaxed-01-r.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-02-l',
      file: 'qbx-hands-01-base-relaxed-02-l.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-02-r',
      file: 'qbx-hands-01-base-relaxed-02-r.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-03-l',
      file: 'qbx-hands-01-base-relaxed-03-l.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-03-r',
      file: 'qbx-hands-01-base-relaxed-03-r.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-04-l',
      file: 'qbx-hands-01-base-relaxed-04-l.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-04-r',
      file: 'qbx-hands-01-base-relaxed-04-r.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-05-l',
      file: 'qbx-hands-01-base-relaxed-05-l.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-05-r',
      file: 'qbx-hands-01-base-relaxed-05-r.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-06-l',
      file: 'qbx-hands-01-base-relaxed-06-l.png',
    },
    {
      key: 'qbx-hands-01-base-relaxed-06-r',
      file: 'qbx-hands-01-base-relaxed-06-r.png',
    },
    {key: 'qbx-hands-02-other-bowl-l', file: 'qbx-hands-02-other-bowl-l.png'},
    {key: 'qbx-hands-02-other-bowl-r', file: 'qbx-hands-02-other-bowl-r.png'},
    {key: 'qbx-hands-02-other-card-l', file: 'qbx-hands-02-other-card-l.png'},
    {key: 'qbx-hands-02-other-card-r', file: 'qbx-hands-02-other-card-r.png'},
    {key: 'qbx-hands-02-other-claw-l', file: 'qbx-hands-02-other-claw-l.png'},
    {key: 'qbx-hands-02-other-claw-r', file: 'qbx-hands-02-other-claw-r.png'},
    {key: 'qbx-hands-02-other-fist-l', file: 'qbx-hands-02-other-fist-l.png'},
    {key: 'qbx-hands-02-other-fist-r', file: 'qbx-hands-02-other-fist-r.png'},
    {key: 'qbx-hands-02-other-grip-l', file: 'qbx-hands-02-other-grip-l.png'},
    {key: 'qbx-hands-02-other-grip-r', file: 'qbx-hands-02-other-grip-r.png'},
    {key: 'qbx-hands-02-other-ko-l', file: 'qbx-hands-02-other-ko-l.png'},
    {key: 'qbx-hands-02-other-ko-r', file: 'qbx-hands-02-other-ko-r.png'},
    {
      key: 'qbx-hands-02-other-nail-check-01-l',
      file: 'qbx-hands-02-other-nail-check-01-l.png',
    },
    {
      key: 'qbx-hands-02-other-nail-check-01-r',
      file: 'qbx-hands-02-other-nail-check-01-r.png',
    },
    {
      key: 'qbx-hands-02-other-nail-check-02-l',
      file: 'qbx-hands-02-other-nail-check-02-l.png',
    },
    {
      key: 'qbx-hands-02-other-nail-check-02-r',
      file: 'qbx-hands-02-other-nail-check-02-r.png',
    },
    {key: 'qbx-hands-02-other-offer-l', file: 'qbx-hands-02-other-offer-l.png'},
    {key: 'qbx-hands-02-other-offer-r', file: 'qbx-hands-02-other-offer-r.png'},
    {key: 'qbx-hands-02-other-push-l', file: 'qbx-hands-02-other-push-l.png'},
    {key: 'qbx-hands-02-other-push-r', file: 'qbx-hands-02-other-push-r.png'},
    {
      key: 'qbx-hands-02-other-push-the-button-l',
      file: 'qbx-hands-02-other-push-the-button-l.png',
    },
    {
      key: 'qbx-hands-02-other-push-the-button-r',
      file: 'qbx-hands-02-other-push-the-button-r.png',
    },
    {
      key: 'qbx-hands-02-other-scratch-l',
      file: 'qbx-hands-02-other-scratch-l.png',
    },
    {
      key: 'qbx-hands-02-other-scratch-r',
      file: 'qbx-hands-02-other-scratch-r.png',
    },
    {
      key: 'qbx-hands-02-other-spread-l',
      file: 'qbx-hands-02-other-spread-l.png',
    },
    {
      key: 'qbx-hands-02-other-spread-r',
      file: 'qbx-hands-02-other-spread-r.png',
    },
    {key: 'qbx-hands-02-other-write-l', file: 'qbx-hands-02-other-write-l.png'},
    {key: 'qbx-hands-02-other-write-r', file: 'qbx-hands-02-other-write-r.png'},
    {
      key: 'qbx-hands-03-signs-cobblepot-l',
      file: 'qbx-hands-03-signs-cobblepot-l.png',
    },
    {
      key: 'qbx-hands-03-signs-cobblepot-r',
      file: 'qbx-hands-03-signs-cobblepot-r.png',
    },
    {
      key: 'qbx-hands-03-signs-fingers-crossed-l',
      file: 'qbx-hands-03-signs-fingers-crossed-l.png',
    },
    {
      key: 'qbx-hands-03-signs-fingers-crossed-r',
      file: 'qbx-hands-03-signs-fingers-crossed-r.png',
    },
    {key: 'qbx-hands-03-signs-five-l', file: 'qbx-hands-03-signs-five-l.png'},
    {key: 'qbx-hands-03-signs-five-r', file: 'qbx-hands-03-signs-five-r.png'},
    {key: 'qbx-hands-03-signs-four-l', file: 'qbx-hands-03-signs-four-l.png'},
    {key: 'qbx-hands-03-signs-four-r', file: 'qbx-hands-03-signs-four-r.png'},
    {
      key: 'qbx-hands-03-signs-four-ring-l',
      file: 'qbx-hands-03-signs-four-ring-l.png',
    },
    {
      key: 'qbx-hands-03-signs-four-ring-r',
      file: 'qbx-hands-03-signs-four-ring-r.png',
    },
    {key: 'qbx-hands-03-signs-fu-l', file: 'qbx-hands-03-signs-fu-l.png'},
    {key: 'qbx-hands-03-signs-fu-r', file: 'qbx-hands-03-signs-fu-r.png'},
    {key: 'qbx-hands-03-signs-index-l', file: 'qbx-hands-03-signs-index-l.png'},
    {key: 'qbx-hands-03-signs-index-r', file: 'qbx-hands-03-signs-index-r.png'},
    {
      key: 'qbx-hands-03-signs-martian-reactor-switch-l',
      file: 'qbx-hands-03-signs-martian-reactor-switch-l.png',
    },
    {
      key: 'qbx-hands-03-signs-martian-reactor-switch-r',
      file: 'qbx-hands-03-signs-martian-reactor-switch-r.png',
    },
    {
      key: 'qbx-hands-03-signs-one-does-not-simply-l',
      file: 'qbx-hands-03-signs-one-does-not-simply-l.png',
    },
    {
      key: 'qbx-hands-03-signs-one-does-not-simply-r',
      file: 'qbx-hands-03-signs-one-does-not-simply-r.png',
    },
    {
      key: 'qbx-hands-03-signs-peace-flipped-r',
      file: 'qbx-hands-03-signs-peace-flipped-r.png',
    },
    {
      key: 'qbx-hands-03-signs-peace-flipped',
      file: 'qbx-hands-03-signs-peace-flipped.png',
    },
    {key: 'qbx-hands-03-signs-peace-l', file: 'qbx-hands-03-signs-peace-l.png'},
    {key: 'qbx-hands-03-signs-peace-r', file: 'qbx-hands-03-signs-peace-r.png'},
    {
      key: 'qbx-hands-03-signs-perfect-l',
      file: 'qbx-hands-03-signs-perfect-l.png',
    },
    {
      key: 'qbx-hands-03-signs-perfect-r',
      file: 'qbx-hands-03-signs-perfect-r.png',
    },
    {
      key: 'qbx-hands-03-signs-pinky-swear-l',
      file: 'qbx-hands-03-signs-pinky-swear-l.png',
    },
    {
      key: 'qbx-hands-03-signs-pinky-swear-r',
      file: 'qbx-hands-03-signs-pinky-swear-r.png',
    },
    {
      key: 'qbx-hands-03-signs-rock-out-l',
      file: 'qbx-hands-03-signs-rock-out-l.png',
    },
    {
      key: 'qbx-hands-03-signs-rock-out-r',
      file: 'qbx-hands-03-signs-rock-out-r.png',
    },
    {
      key: 'qbx-hands-03-signs-scout-salute-l',
      file: 'qbx-hands-03-signs-scout-salute-l.png',
    },
    {
      key: 'qbx-hands-03-signs-scout-salute-r',
      file: 'qbx-hands-03-signs-scout-salute-r.png',
    },
    {key: 'qbx-hands-03-signs-spock-l', file: 'qbx-hands-03-signs-spock-l.png'},
    {key: 'qbx-hands-03-signs-spock-r', file: 'qbx-hands-03-signs-spock-r.png'},
    {key: 'qbx-hands-03-signs-stop-l', file: 'qbx-hands-03-signs-stop-l.png'},
    {key: 'qbx-hands-03-signs-stop-r', file: 'qbx-hands-03-signs-stop-r.png'},
    {
      key: 'qbx-hands-03-signs-surf-s-up-flipped-l',
      file: 'qbx-hands-03-signs-surf-s-up-flipped-l.png',
    },
    {
      key: 'qbx-hands-03-signs-surf-s-up-flipped-r',
      file: 'qbx-hands-03-signs-surf-s-up-flipped-r.png',
    },
    {
      key: 'qbx-hands-03-signs-surf-s-up-l',
      file: 'qbx-hands-03-signs-surf-s-up-l.png',
    },
    {
      key: 'qbx-hands-03-signs-surf-s-up-r',
      file: 'qbx-hands-03-signs-surf-s-up-r.png',
    },
    {
      key: 'qbx-hands-03-signs-three-hicox-l',
      file: 'qbx-hands-03-signs-three-hicox-l.png',
    },
    {
      key: 'qbx-hands-03-signs-three-hicox-r',
      file: 'qbx-hands-03-signs-three-hicox-r.png',
    },
    {key: 'qbx-hands-03-signs-three-l', file: 'qbx-hands-03-signs-three-l.png'},
    {key: 'qbx-hands-03-signs-three-r', file: 'qbx-hands-03-signs-three-r.png'},
    {
      key: 'qbx-hands-03-signs-three-ring-l',
      file: 'qbx-hands-03-signs-three-ring-l.png',
    },
    {
      key: 'qbx-hands-03-signs-three-ring-r',
      file: 'qbx-hands-03-signs-three-ring-r.png',
    },
    {
      key: 'qbx-hands-03-signs-thumbs-up-l',
      file: 'qbx-hands-03-signs-thumbs-up-l.png',
    },
    {
      key: 'qbx-hands-03-signs-thumbs-up-r',
      file: 'qbx-hands-03-signs-thumbs-up-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-detonator-l',
      file: 'qbx-hands-04-weapons-detonator-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-detonator-r',
      file: 'qbx-hands-04-weapons-detonator-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-grip-sword-l',
      file: 'qbx-hands-04-weapons-grip-sword-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-grip-sword-r',
      file: 'qbx-hands-04-weapons-grip-sword-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-gun-01-l',
      file: 'qbx-hands-04-weapons-gun-01-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-gun-01-r',
      file: 'qbx-hands-04-weapons-gun-01-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-gun-02-l',
      file: 'qbx-hands-04-weapons-gun-02-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-gun-02-r',
      file: 'qbx-hands-04-weapons-gun-02-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-gun-03-l-cock-the-hammer',
      file: 'qbx-hands-04-weapons-gun-03-l-cock-the-hammer.png',
    },
    {
      key: 'qbx-hands-04-weapons-gun-03-r-cock-the-hammer',
      file: 'qbx-hands-04-weapons-gun-03-r-cock-the-hammer.png',
    },
    {
      key: 'qbx-hands-04-weapons-hadoken-l',
      file: 'qbx-hands-04-weapons-hadoken-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-hadoken-r',
      file: 'qbx-hands-04-weapons-hadoken-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-pistol-double-l',
      file: 'qbx-hands-04-weapons-pistol-double-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-pistol-double-r',
      file: 'qbx-hands-04-weapons-pistol-double-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-pistol-l',
      file: 'qbx-hands-04-weapons-pistol-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-pistol-r',
      file: 'qbx-hands-04-weapons-pistol-r.png',
    },
    {
      key: 'qbx-hands-04-weapons-throw-l',
      file: 'qbx-hands-04-weapons-throw-l.png',
    },
    {
      key: 'qbx-hands-04-weapons-throw-r',
      file: 'qbx-hands-04-weapons-throw-r.png',
    },
  ],
}
