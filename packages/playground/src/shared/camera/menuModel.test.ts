import {
  buildCameraMenuItems,
  buildPathMenuItems,
  buildObjectMenuItems,
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

test('对象右键菜单:提供姿势/动作回调时多出两项,位于手柄模式上方', () => {
  const onSelectMode = jest.fn()
  const onDelete = jest.fn()
  const onChangePose = jest.fn()
  const onPlayAnimation = jest.fn()
  const items = buildObjectMenuItems({
    mode: 'rotate',
    onSelectMode,
    onDelete,
    onChangePose,
    onPlayAnimation,
  })
  // [改变姿势, 播放动作, sep, translate, rotate, scale, sep, 删除]
  expect(items.map((i) => i.type)).toEqual([
    'normal',
    'normal',
    'separator',
    'normal',
    'normal',
    'normal',
    'separator',
    'normal',
  ])
  expect(String((items[0] as any).label)).toContain('改变姿势')
  expect(String((items[1] as any).label)).toContain('播放动作')
  expect(String((items[7] as any).label)).toContain('删除')
  ;(items[0] as any).callback?.({} as any)
  expect(onChangePose).toHaveBeenCalled()
  ;(items[1] as any).callback?.({} as any)
  expect(onPlayAnimation).toHaveBeenCalled()
})

test('对象右键菜单:只传姿势回调时只有「改变姿势」一项', () => {
  const items = buildObjectMenuItems({
    mode: 'translate',
    onSelectMode: jest.fn(),
    onDelete: jest.fn(),
    onChangePose: jest.fn(),
  })
  // [改变姿势, sep, translate, rotate, scale, sep, 删除]
  expect(items).toHaveLength(7)
  expect(String((items[0] as any).label)).toContain('改变姿势')
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
