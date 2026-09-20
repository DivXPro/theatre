/**
 * r3f 基础属性的界面词条(en + zh-CN 四部词典,纯数据无依赖)。
 * 由 main/i18n.ts 与 extension/i18n.ts 两个薄注册壳分别注入 studio
 * i18n 单例——src 根部禁值导入 @dreamerbird/studio 子路径(生产构建
 * 不可用),main/extension 各自的 eslint 规则又互禁跨边,所以词典
 * 放共享根部,注册壳放两侧。
 */
export const r3fPropsEn = {
  // 通用变换(所有可编辑对象)
  'r3f.props.position': 'Position',
  'r3f.props.rotation': 'Rotation',
  'r3f.props.scale': 'Scale',
  // 相机
  'r3f.props.fov': 'FOV',
  'r3f.props.zoom': 'Zoom',
  'r3f.props.near': 'Near',
  'r3f.props.far': 'Far',
  // 灯光
  'r3f.props.intensity': 'Intensity',
  'r3f.props.distance': 'Distance',
  'r3f.props.decay': 'Decay',
  'r3f.props.color': 'Color',
  'r3f.props.angle': 'Angle',
  'r3f.props.penumbra': 'Penumbra',
  'r3f.props.groundColor': 'Ground Color',
  // 雾
  'r3f.props.fogColor': 'Fog Color',
  'r3f.props.fogNear': 'Fog Near',
  'r3f.props.fogFar': 'Fog Far',
  // 快照编辑器相机(sheet 对象,属性面板可见)
  'r3f.props.transform': 'Transform',
  'r3f.props.target': 'Target',
  'r3f.props.lens': 'Lens',
  'r3f.props.focus': 'Focus',
  'r3f.props.filmGauge': 'Film Gauge',
  'r3f.props.filmOffset': 'Film Offset',
} as const

export const r3fPropsZhCN: Record<keyof typeof r3fPropsEn, string> = {
  'r3f.props.position': '位置',
  'r3f.props.rotation': '旋转',
  'r3f.props.scale': '缩放',
  'r3f.props.fov': '视野',
  'r3f.props.zoom': '变焦',
  'r3f.props.near': '近裁剪面',
  'r3f.props.far': '远裁剪面',
  'r3f.props.intensity': '强度',
  'r3f.props.distance': '距离',
  'r3f.props.decay': '衰减',
  'r3f.props.color': '颜色',
  'r3f.props.angle': '锥角',
  'r3f.props.penumbra': '半影',
  'r3f.props.groundColor': '地面颜色',
  'r3f.props.fogColor': '雾颜色',
  'r3f.props.fogNear': '雾起始距离',
  'r3f.props.fogFar': '雾结束距离',
  'r3f.props.transform': '变换',
  'r3f.props.target': '目标点',
  'r3f.props.lens': '镜头',
  'r3f.props.focus': '对焦距离',
  'r3f.props.filmGauge': '胶片规格',
  'r3f.props.filmOffset': '胶片偏移',
}

export const r3fEditorEn = {
  'r3f.editor.viewport': 'Viewport Config',
  'r3f.editor.showAxes': 'Axes',
  'r3f.editor.showGrid': 'Grid',
  'r3f.editor.showOverlayIcons': 'Overlay Icons',
  'r3f.editor.shading': 'Shading',
  'r3f.editor.referenceWindow': 'Reference Window',
  'r3f.editor.transformControls': 'Transform Controls',
  'r3f.editor.mode': 'Mode',
  'r3f.editor.space': 'Space',
} as const

export const r3fEditorZhCN: Record<keyof typeof r3fEditorEn, string> = {
  'r3f.editor.viewport': '视口配置',
  'r3f.editor.showAxes': '坐标轴',
  'r3f.editor.showGrid': '网格',
  'r3f.editor.showOverlayIcons': '叠加图标',
  'r3f.editor.shading': '着色',
  'r3f.editor.referenceWindow': '参考窗口',
  'r3f.editor.transformControls': '变换控制',
  'r3f.editor.mode': '模式',
  'r3f.editor.space': '空间',
}
