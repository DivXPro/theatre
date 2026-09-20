/**
 * camera 场景的词条注册:en + zh-CN 两部词典,模块加载即注入 studio
 * 的 i18n 单例(与宿主共享实例,宿主可后注册覆盖同名 key 做品牌定制)。
 *
 * 收编范围:顶栏 tooltip、右键/导出菜单、面板动作名、相机/放置对象的
 * 属性标签、资产库框体文案、导入确认弹层。key 一律 `pg.` 前缀,避免与
 * studio 内置词条撞车。
 *
 * 纯逻辑层(菜单构建/导入计划)不直接调 translate,而是由调用方把 t
 * 传进来(默认 translate)——测试可以注入词典 stub 断言固定语言。
 */
import {
  registerMessages,
  registerFallback,
  translate,
  type InterpolationVars,
  type Messages,
} from '@dreamerbird/studio/i18n'

export const en: Messages = {
  'pg.toolbar.addModel': 'Add model',
  'pg.toolbar.addModel.hint':
    'Open the model library; click or drag to place a model',
  'pg.toolbar.addPath': 'Add path',
  'pg.toolbar.addPath.hint':
    'Open the path preset library; click or drag to create a camera track',
  'pg.toolbar.addCamera': 'Add camera',
  'pg.toolbar.addCamera.hint':
    'Create a camera from the current director view (becomes the active camera)',
  'pg.toolbar.addAnchor': 'Add anchor',
  'pg.toolbar.addAnchor.hint':
    'Place an empty anchor in front of the current view (aim target / parentable)',
  'pg.toolbar.pip': 'Picture in picture',
  'pg.toolbar.pip.show': 'Show the shot preview in the bottom-right corner',
  'pg.toolbar.pip.hide': 'Hide the shot preview',
  'pg.toolbar.pip.disabled': 'Add a camera first',
  'pg.toolbar.export': 'Export video',
  'pg.toolbar.stopExport': 'Stop & save',
  'pg.toolbar.export.esc': 'Press Esc to cancel',
  'pg.toolbar.export.hint':
    'Record the live shot: the sequence plays start to finish and saves automatically',
  'pg.toolbar.placing':
    'Placing: confirm or cancel the current placement first',

  'pg.menu.viewShot': 'View this shot',
  'pg.menu.deleteCamera': 'Delete camera',
  'pg.menu.deleteAnchor': 'Delete anchor',
  'pg.menu.editPath': 'Edit path (Tab)',
  'pg.menu.exitEditPath': 'Exit editing (Tab)',
  'pg.menu.bindCamera': 'Bind to active camera',
  'pg.menu.deletePath': 'Delete path',
  'pg.menu.changePose': 'Change pose',
  'pg.menu.playAnimation': 'Play animation',
  'pg.menu.delete': 'Delete',

  'pg.gizmo.translate': 'Move',
  'pg.gizmo.rotate': 'Rotate',
  'pg.gizmo.scale': 'Scale',

  'pg.action.movePathToCamera': 'Move path to camera',

  'pg.props.aimTarget': 'Aim target',
  'pg.props.aimNone': 'None',
  'pg.props.anchorParent': 'Parent',
  'pg.props.parentNone': 'None',
  'pg.props.pathKey': 'Bound path',
  'pg.props.pathManual': 'None',
  'pg.props.animation': 'Animation',
  'pg.props.pose': 'Pose',
  'pg.props.source': 'Source file',
  'pg.parts.head': 'Head',
  'pg.parts.chest': 'Chest',
  'pg.parts.handL': 'Left hand',
  'pg.parts.handR': 'Right hand',
  'pg.parts.legL': 'Left leg',
  'pg.parts.legR': 'Right leg',
  'pg.props.pathProgress': 'Travel Progress',
  'pg.props.position': 'Position',
  'pg.props.rotationRadian': 'Rotation (radians)',
  'pg.props.scale': 'Scale',

  'pg.lib.title.model': 'Models',
  'pg.lib.title.pose': 'Poses',
  'pg.lib.title.animation': 'Animations',
  'pg.lib.title.path': 'Path presets',
  'pg.lib.import': 'Import files',
  'pg.lib.close': 'Close',
  'pg.lib.rigRenamePrompt': 'Rig family name',
  'pg.lib.renamePrompt': 'Rename',
  'pg.lib.delete.inUse':
    'Delete "{name}"? {count} placed instance(s) use it; they will fall back to bind pose / no animation or fail to load.',
  'pg.lib.delete.unused': 'Delete "{name}"? Placed instances are not affected.',
  'pg.lib.rigTitle': '{rig}\nClick to name this rig',
  'pg.lib.rigMismatch': ' · rig mismatch',
  'pg.lib.modelCardTitle':
    'Click to place at scene center; drag to a spot on the canvas',
  'pg.lib.filterHint':
    'Only entries of the same rig family can be applied; others are greyed out',
  'pg.lib.savePose': 'Save current pose',
  'pg.lib.savePoseDisabled': 'Select a placed model with a skeleton first',
  'pg.lib.similar.title': 'Similar models detected, choose how to handle:',
  'pg.lib.similar.desc':
    'New file "{newName}" is similar to "{existingName}" in the library',
  'pg.lib.similar.reuse': 'Reuse library entry (discard new file)',
  'pg.lib.similar.keep': 'Keep as new entry',
  'pg.lib.cancel': 'Cancel',
  'pg.lib.confirm': 'Confirm',
  'pg.lib.ctx.rename': 'Rename',
  'pg.lib.ctx.delete': 'Delete',

  'pg.import.summary.models': 'Models ×{count}',
  'pg.import.summary.animations': 'Animations ×{count}',
  'pg.import.summary.poses': 'Poses ×{count}',
  'pg.import.summary.skips': 'Skipped ×{count}',
  'pg.import.summary.prefix': 'Identified:',
  'pg.import.summary.empty': 'Nothing to import',
  'pg.import.reason.badPoseJson': 'Invalid pose JSON',
  'pg.import.reason.parseFailed': 'Failed to parse the file',
  'pg.import.reason.noContent': 'No mesh and no animation, unrecognized',
  'pg.import.reason.modelExportFailed': 'Model export failed',
  'pg.import.reason.modelExists': 'Model already exists (same as "{name}")',
  'pg.import.reason.animationExportFailed': 'Animation export failed',
  'pg.import.reason.animationExists': 'Animation already in the library',
}

export const zhCN: Messages = {
  'pg.toolbar.addModel': '添加模型',
  'pg.toolbar.addModel.hint': '打开模型库,点击或拖拽把模型放进场景',
  'pg.toolbar.addPath': '添加路径',
  'pg.toolbar.addPath.hint': '打开路径预设库,点击或拖拽生成相机轨迹',
  'pg.toolbar.addCamera': '添加相机',
  'pg.toolbar.addCamera.hint': '从当前导演视角创建一台相机(落地即活动相机)',
  'pg.toolbar.addAnchor': '添加锚点',
  'pg.toolbar.addAnchor.hint':
    '在当前视角前方放一个空锚点(可被相机瞄准、可绑父级)',
  'pg.toolbar.pip': '画中画',
  'pg.toolbar.pip.show': '显示右下角的镜头画中画',
  'pg.toolbar.pip.hide': '隐藏右下角的镜头画中画',
  'pg.toolbar.pip.disabled': '先添加相机',
  'pg.toolbar.export': '导出视频',
  'pg.toolbar.stopExport': '停止并保存',
  'pg.toolbar.export.esc': 'Esc 取消',
  'pg.toolbar.export.hint':
    '把镜头取景实时录成视频:序列从头播到尾,录完自动保存',
  'pg.toolbar.placing': '放置中:先确认或取消当前放置',

  'pg.menu.viewShot': '查看此镜头',
  'pg.menu.deleteCamera': '删除相机',
  'pg.menu.deleteAnchor': '删除锚点',
  'pg.menu.editPath': '编辑路径(Tab)',
  'pg.menu.exitEditPath': '退出编辑(Tab)',
  'pg.menu.bindCamera': '绑定到活动相机',
  'pg.menu.deletePath': '删除路径',
  'pg.menu.changePose': '改变姿势',
  'pg.menu.playAnimation': '播放动作',
  'pg.menu.delete': '删除',

  'pg.gizmo.translate': '移动',
  'pg.gizmo.rotate': '旋转',
  'pg.gizmo.scale': '缩放',

  'pg.action.movePathToCamera': '路径平移到相机',

  'pg.props.aimTarget': '瞄准目标',
  'pg.props.aimNone': '无',
  'pg.props.anchorParent': '父级',
  'pg.props.parentNone': '无',
  'pg.props.pathKey': '绑定路径',
  'pg.props.pathManual': '无',
  'pg.props.animation': '动作',
  'pg.props.pose': '姿势',
  'pg.props.source': '来源文件',
  'pg.parts.head': '头',
  'pg.parts.chest': '胸口',
  'pg.parts.handL': '左手',
  'pg.parts.handR': '右手',
  'pg.parts.legL': '左腿',
  'pg.parts.legR': '右腿',
  'pg.props.pathProgress': '行进进度',
  'pg.props.position': '位置',
  'pg.props.rotationRadian': '旋转(弧度)',
  'pg.props.scale': '缩放',

  'pg.lib.title.model': '模型库',
  'pg.lib.title.pose': '姿势库',
  'pg.lib.title.animation': '动作库',
  'pg.lib.title.path': '路径预设',
  'pg.lib.import': '导入文件',
  'pg.lib.close': '关闭',
  'pg.lib.rigRenamePrompt': '骨架族名称',
  'pg.lib.renamePrompt': '重命名',
  'pg.lib.delete.inUse':
    '删除「{name}」?场景中有 {count} 个实例正在使用它,删除后这些实例将回退为绑定姿势/无动作或无法加载。',
  'pg.lib.delete.unused': '删除「{name}」?场景里已放置的实例不受影响。',
  'pg.lib.rigTitle': '{rig}\n点击给这套骨架起名',
  'pg.lib.rigMismatch': ' · 骨架不匹配',
  'pg.lib.modelCardTitle': '点击放到场景中心;按住拖到画布指定落点',
  'pg.lib.filterHint': '只列出同骨架族的条目可套用,不同族的已置灰',
  'pg.lib.savePose': '存当前姿势',
  'pg.lib.savePoseDisabled': '先选中一个带骨架的已放置模型',
  'pg.lib.similar.title': '检测到相似模型,请选择处理方式:',
  'pg.lib.similar.desc': '新文件「{newName}」与库中「{existingName}」相似',
  'pg.lib.similar.reuse': '复用库中(丢弃新文件)',
  'pg.lib.similar.keep': '保留为新条目',
  'pg.lib.cancel': '取消',
  'pg.lib.confirm': '确认',
  'pg.lib.ctx.rename': '重命名',
  'pg.lib.ctx.delete': '删除',

  'pg.import.summary.models': '模型 ×{count}',
  'pg.import.summary.animations': '动作 ×{count}',
  'pg.import.summary.poses': '姿势 ×{count}',
  'pg.import.summary.skips': '跳过 ×{count}',
  'pg.import.summary.prefix': '识别为:',
  'pg.import.summary.empty': '没有可导入的内容',
  'pg.import.reason.badPoseJson': '姿势 JSON 格式不正确',
  'pg.import.reason.parseFailed': '文件解析失败',
  'pg.import.reason.noContent': '无网格也无动画,无法识别',
  'pg.import.reason.modelExportFailed': '模型导出失败',
  'pg.import.reason.modelExists': '模型已存在(同库中「{name}」)',
  'pg.import.reason.animationExportFailed': '动作导出失败',
  'pg.import.reason.animationExists': '动作已在库中',
}

registerMessages('en', en)
registerMessages('zh-CN', zhCN)
// navigator.language 是 'zh' / 'zh-TW' 等时也能落到 zh-CN 词典
registerFallback('zh', 'zh-CN')

/** 测试/宿主定制用:从一部词典构造固定语言的 t(含 `{var}` 插值) */
export function makeDictT(
  dict: Messages,
): (key: string, vars?: InterpolationVars) => string {
  return (key, vars) => {
    const template = dict[key] ?? key
    if (!vars) return template
    return template.replace(/\{(\w+)\}/g, (m: string, name: string) =>
      vars[name] !== undefined ? String(vars[name]) : m,
    )
  }
}

/** 默认 t:走全局单例当前语言(菜单构建等纯逻辑层的缺省) */
export const defaultT = translate
