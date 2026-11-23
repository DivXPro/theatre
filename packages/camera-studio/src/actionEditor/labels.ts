import type {
  useT} from '@dreamerbird/studio/i18n';
import {
  registerFallback,
  registerMessages
} from '@dreamerbird/studio/i18n'
import type {ActionEditorChannelRef} from './keys'

const en = {
  'pg.actionEditor.title': 'Action editor',
  'pg.actionEditor.timeline': 'Action timeline',
  'pg.actionEditor.localTime': 'Local time (s)',
  'pg.actionEditor.localFrame': 'Local frame',
  'pg.actionEditor.previousFrame': 'Previous frame',
  'pg.actionEditor.nextFrame': 'Next frame',
  'pg.actionEditor.chooseBoneTrack': 'Select a bone to show its keyframes.',
  'pg.actionEditor.scrub': 'Scrub local time',
  'pg.actionEditor.sceneTime': 'Scene time {time} s',
  'pg.actionEditor.sceneFrame': 'Scene frame {frame}',
  'pg.actionEditor.loop': 'Loop {iteration} / {repeat}',
  'pg.actionEditor.position': 'Position',
  'pg.actionEditor.quaternion': 'Rotation (rad)',
  'pg.actionEditor.scale': 'Scale',
  'pg.actionEditor.bone': 'Bone',
  'pg.actionEditor.chooseBone': 'Select a bone',
  'pg.actionEditor.boneDetails': 'Bone details',
  'pg.actionEditor.pose': 'Pose',
  'pg.actionEditor.poseKeys': 'Pose keyframes',
  'pg.actionEditor.editInViewport': 'Edit in viewport',
  'pg.actionEditor.component': '{group} {axis}',
  'pg.actionEditor.keyAt': '{channel} keyframe at {time} s',
  'pg.actionEditor.keyAtFrame': '{channel} keyframe at frame {time}',
  'pg.actionEditor.addKey': 'Add {channel} keyframe',
  'pg.actionEditor.updateKey': 'Update {channel} keyframe',
  'pg.actionEditor.keyTime': 'Keyframe time (s)',
  'pg.actionEditor.keyFrame': 'Keyframe frame',
  'pg.actionEditor.moveKey': 'Move keyframe',
  'pg.actionEditor.deleteKey': 'Delete keyframe',
  'pg.actionEditor.moveError': 'Choose an unused time within the action.',
  'pg.actionEditor.keepKey': 'This channel needs at least one keyframe.',
  'pg.actionEditor.clearPreview': 'Restore sampled values',
  'pg.actionEditor.previewDiscarded': 'Unrecorded edits were discarded.',
  'pg.actionEditor.previewPending':
    'Record or restore the preview before applying.',
  'pg.actionEditor.recordPose': 'Record changed bones',
  'pg.actionEditor.viewportPending':
    'Drag the viewport controls to pose this frame.',
  'pg.actionEditor.recordCurrentPose': 'Record current pose',
  'pg.actionEditor.discardPreview': 'Discard preview',
  'pg.actionEditor.scope': 'Apply to',
  'pg.actionEditor.thisStrip': 'This strip only',
  'pg.actionEditor.allStrips': 'All {count} references',
  'pg.actionEditor.apply': 'Apply and return',
  'pg.actionEditor.applyError': 'Could not apply the action edits.',
  'pg.actionEditor.cancel': 'Cancel',
  'pg.actionEditor.confirmDiscard': 'Discard changes to this action?',
  'pg.actionEditor.discard': 'Discard edits',
  'pg.actionEditor.keepEditing': 'Keep editing',
}

const zh: Record<keyof typeof en, string> = {
  'pg.actionEditor.title': '动作编辑',
  'pg.actionEditor.timeline': '动作时间轴',
  'pg.actionEditor.localTime': '局部时间（秒）',
  'pg.actionEditor.localFrame': '局部帧',
  'pg.actionEditor.previousFrame': '上一帧',
  'pg.actionEditor.nextFrame': '下一帧',
  'pg.actionEditor.chooseBoneTrack': '在右栏选择骨骼，查看它的关键帧。',
  'pg.actionEditor.scrub': '拖动局部播放头',
  'pg.actionEditor.sceneTime': '场景时间 {time} 秒',
  'pg.actionEditor.sceneFrame': '场景第 {frame} 帧',
  'pg.actionEditor.loop': '第 {iteration} / {repeat} 次循环',
  'pg.actionEditor.position': '位置',
  'pg.actionEditor.quaternion': '旋转（弧度）',
  'pg.actionEditor.scale': '缩放',
  'pg.actionEditor.bone': '骨骼',
  'pg.actionEditor.chooseBone': '选择骨骼',
  'pg.actionEditor.boneDetails': '骨骼明细',
  'pg.actionEditor.pose': '姿势',
  'pg.actionEditor.poseKeys': '姿势关键帧',
  'pg.actionEditor.editInViewport': '在视口摆姿',
  'pg.actionEditor.component': '{group} {axis}',
  'pg.actionEditor.keyAt': '{channel}关键帧，位于 {time} 秒',
  'pg.actionEditor.keyAtFrame': '{channel}关键帧，位于第 {time} 帧',
  'pg.actionEditor.addKey': '添加{channel}关键帧',
  'pg.actionEditor.updateKey': '更新{channel}关键帧',
  'pg.actionEditor.keyTime': '关键帧时间（秒）',
  'pg.actionEditor.keyFrame': '关键帧帧号',
  'pg.actionEditor.moveKey': '移动关键帧',
  'pg.actionEditor.deleteKey': '删除关键帧',
  'pg.actionEditor.moveError': '请选择动作范围内没有关键帧的时间。',
  'pg.actionEditor.keepKey': '此通道至少需要一个关键帧。',
  'pg.actionEditor.clearPreview': '恢复采样值',
  'pg.actionEditor.previewDiscarded': '未打点的修改已丢弃。',
  'pg.actionEditor.previewPending': '请先打点或恢复采样值，再应用修改。',
  'pg.actionEditor.recordPose': '给已修改的骨骼打点',
  'pg.actionEditor.viewportPending': '拖动视口控制点，调整当前帧的姿势。',
  'pg.actionEditor.recordCurrentPose': '记录当前姿势',
  'pg.actionEditor.discardPreview': '放弃试摆',
  'pg.actionEditor.scope': '应用范围',
  'pg.actionEditor.thisStrip': '仅此片段',
  'pg.actionEditor.allStrips': '全部 {count} 个引用',
  'pg.actionEditor.apply': '应用并返回',
  'pg.actionEditor.applyError': '无法应用动作修改。',
  'pg.actionEditor.cancel': '取消',
  'pg.actionEditor.confirmDiscard': '放弃对此动作的修改？',
  'pg.actionEditor.discard': '放弃修改',
  'pg.actionEditor.keepEditing': '继续编辑',
}

registerMessages('en', en)
registerMessages('zh-CN', zh)
registerFallback('zh', 'zh-CN')

export function channelLabel(
  t: ReturnType<typeof useT>,
  channel: ActionEditorChannelRef,
) {
  return channel.kind === 'bone'
    ? channel.boneName
    : t(`pg.actionEditor.${channel.kind}`)
}
