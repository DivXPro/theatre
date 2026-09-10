import {
  buildCameraMenuItems,
  buildPathMenuItems,
  buildObjectMenuItems,
  buildCameraPanelActions,
  buildPathPanelActions,
  buildExportMenuItems,
} from './menuModel'

test('相机右键菜单:查看此镜头 / 删除相机', () => {
  const onViewShot = jest.fn()
  const onDeleteCamera = jest.fn()
  const items = buildCameraMenuItems({onViewShot, onDeleteCamera})
  expect(items).toHaveLength(3)
  expect(items.map((i) => i.type)).toEqual(['normal', 'separator', 'normal'])
  expect(items[0]).toMatchObject({type: 'normal', label: '查看此镜头'})
  expect(items[2]).toMatchObject({type: 'normal', label: '删除相机'})
  ;(items[0] as any).callback?.({} as any)
  expect(onViewShot).toHaveBeenCalled()
  ;(items[2] as any).callback?.({} as any)
  expect(onDeleteCamera).toHaveBeenCalled()
})

test('路径右键菜单:编辑(带 Tab 标注)与删除,编辑中显示退出编辑', () => {
  const onToggleEdit = jest.fn()
  const onDelete = jest.fn()
  const items = buildPathMenuItems({
    metaKey: 'Pos Path',
    editing: false,
    onToggleEdit,
    onDelete,
  })
  // [编辑路径(Tab), separator, 删除路径]
  expect(items.map((i) => i.type)).toEqual(['normal', 'separator', 'normal'])
  expect(String((items[0] as any).label)).toContain('编辑路径')
  expect(String((items[0] as any).label)).toContain('Tab')
  expect(String((items[2] as any).label)).toContain('删除路径')

  const editingItems = buildPathMenuItems({
    metaKey: 'Pos Path',
    editing: true,
    onToggleEdit,
    onDelete,
  })
  expect(String((editingItems[0] as any).label)).toContain('退出编辑')
})

test('模型右键菜单:三种 gizmo 模式,当前模式打勾,末尾删除', () => {
  const onSelectMode = jest.fn()
  const onDelete = jest.fn()
  const items = buildObjectMenuItems({
    mode: 'rotate',
    onSelectMode,
    onDelete,
  })
  // [translate, rotate, scale, separator, 删除]
  expect(items).toHaveLength(5)
  expect(String((items[0] as any).label)).not.toContain('✓')
  expect(String((items[1] as any).label)).toContain('✓')
  expect(String((items[4] as any).label)).toContain('删除')
})

test('相机面板动作:路径为空不含对齐;Target 在不含恢复', () => {
  const a = buildCameraPanelActions({
    hasPoints: false,
    targetHidden: false,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
  })
  expect(Object.keys(a)).toEqual([])
  const b = buildCameraPanelActions({
    hasPoints: true,
    targetHidden: true,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
  })
  expect(Object.keys(b)).toEqual(['对齐到路径起点', '恢复 Target'])
})

test('路径面板动作:空路径不含平移', () => {
  expect(
    Object.keys(
      buildPathPanelActions({hasPoints: false, onMovePathToCamera: jest.fn()}),
    ),
  ).toEqual([])
  expect(
    Object.keys(
      buildPathPanelActions({hasPoints: true, onMovePathToCamera: jest.fn()}),
    ),
  ).toEqual(['路径平移到相机'])
})

test('导出菜单:每个 sink 一项,点击回传 sink', () => {
  const onPick = jest.fn()
  const sinks = [
    {id: 'a', label: 'WebM'},
    {id: 'b', label: 'MP4'},
  ] as any
  const items = buildExportMenuItems(sinks, onPick)
  expect(items).toHaveLength(2)
  ;(items[1] as any).callback?.({} as any)
  expect(onPick).toHaveBeenCalledWith(sinks[1])
})

test('路径右键菜单:提供 onBindToActiveCamera 时出「绑定到活动相机」', () => {
  const onBind = jest.fn()
  const items = buildPathMenuItems({
    metaKey: 'Pos Path 2',
    editing: false,
    onToggleEdit: jest.fn(),
    onDelete: jest.fn(),
    onBindToActiveCamera: onBind,
  })
  // [编辑路径(Tab), 绑定到活动相机, separator, 删除路径]
  expect(items.map((i) => i.type)).toEqual([
    'normal',
    'normal',
    'separator',
    'normal',
  ])
  expect((items[1] as any).label).toBe('绑定到活动相机')
  ;(items[1] as any).callback?.({} as any)
  expect(onBind).toHaveBeenCalled()

  // 不提供时结构不变(向后兼容)
  const plain = buildPathMenuItems({
    metaKey: 'Pos Path 2',
    editing: false,
    onToggleEdit: jest.fn(),
    onDelete: jest.fn(),
  })
  expect(plain.map((i) => i.type)).toEqual(['normal', 'separator', 'normal'])
})

test('相机面板动作:未绑定时每条可绑路径一个按钮;已绑定出解绑', () => {
  const onBindPath = jest.fn()
  const onUnbindPath = jest.fn()
  const unbound = buildCameraPanelActions({
    hasPoints: false,
    targetHidden: false,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
    bindablePaths: [
      {pathKey: 'Pos Path', label: 'Pos Path'},
      {pathKey: 'Pos Path 2', label: 'Pos Path 2'},
    ],
    boundPathKey: null,
    onBindPath,
    onUnbindPath,
  })
  expect(Object.keys(unbound)).toEqual(['绑定到 Pos Path', '绑定到 Pos Path 2'])
  unbound['绑定到 Pos Path 2']({} as any)
  expect(onBindPath).toHaveBeenCalledWith('Pos Path 2')

  const bound = buildCameraPanelActions({
    hasPoints: false,
    targetHidden: false,
    onAlignToPathStart: jest.fn(),
    onRestoreTarget: jest.fn(),
    bindablePaths: [
      {pathKey: 'Pos Path', label: 'Pos Path'},
      {pathKey: 'Pos Path 2', label: 'Pos Path 2'},
    ],
    boundPathKey: 'Pos Path',
    onBindPath,
    onUnbindPath,
  })
  // 已绑定的那条不再出「绑定到」,改出「解绑路径」
  expect(Object.keys(bound)).toEqual(['解绑路径', '绑定到 Pos Path 2'])
  bound['解绑路径']({} as any)
  expect(onUnbindPath).toHaveBeenCalled()
})
