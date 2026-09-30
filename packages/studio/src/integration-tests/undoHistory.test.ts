/* eslint-disable import/no-extraneous-dependencies */
/**
 * 撤销栈卫生回归测试:视图/界面态的写入不得占用撤销历史。
 *
 * 背景:saaz 只在事务带 backwardOps 时才入撤销栈(SaazFront._pushOptimisticUpdate),
 * 而 undoable 标志决定是否携带 backwardOps。以下三类「不产生创作内容」的写入
 * 必须走 undoable=false,否则撤销栈顶被无视觉效果的条目霸占,用户连按 Ctrl+Z
 * 多次都弹不到真正的改动(实测:摆一次姿势前后栈顶压 5 条选中记录):
 *   1. scrub.commit(false) —— 提交生效但不入栈(编辑器视角持久化用)
 *   2. studio.setSelection —— 选中变化是界面态,不可撤销
 *   3. studio.createContentOfSaveFile —— 读存档的 revisionHistory 副作用不入栈
 *
 * 测试技法说明:每个用例先压一笔「修改已有 key」的锚点事务占位栈顶,再执行
 * 被测操作,最后 undo——弹掉的必须是锚点而不是被测操作。
 */
import {val} from '@dreamerbird/core'
import {setupTestSheet} from '@dreamerbird/studio/integration-tests/testUtils'
import getStudio from '@dreamerbird/studio/getStudio'
import type {ObjectAddressKey} from '@dreamerbird/core/types/public'

const studio = getStudio()!

/** 探 saaz 撤销栈(私有路径,供本文件用例断言栈行为) */
const undoStackOf = (): any[] => {
  const s = studio as any
  const saaz = s._store?._saaz ?? s._saaz
  return saaz?._atom?.get?.()?.undoRedo?.stack ?? []
}

/** 读 saaz 当前可见状态(optimistic)里某路径的 cell,walk 走指向分支 */
const readCellAt = (segs: string[]): any => {
  const s = studio as any
  const saaz = s._store?._saaz ?? s._saaz
  let c = saaz?._prisms?.optimisticState?.getValue?.()?.cell
  for (const seg of segs) {
    const b = c && c.$branches && c.$branches[c.$type[1]]
    c = b && b.$mapProps ? b.$mapProps[seg] : undefined
  }
  return c
}

test('往空 map 容器写首个 key 的事务必须入撤销栈(姿势建轨→首帧的真实形状)', async () => {
  await setupTestSheet({staticOverrides: {byObject: {}}})
  const s = studio as any
  const saaz = s._store?._saaz ?? s._saaz
  // 发现本用例的项目 id(setupTestSheet 每次自增)
  const projId = Object.keys(
    readCellAt(['historic', 'coreByProject'])?.$branches?.base?.$mapProps ?? {},
  )[0]
  expect(projId).toBeTruthy()

  const len0 = undoStackOf().length

  // tx1:建空容器——模拟 sequenceProp 建轨落下的空 keyframes.byId;
  // 空 map 落库后没有指向分支($branches 为空),这是触发缺陷的形状
  saaz.tx(undefined, (draft: any) => {
    const sbi = draft.historic.coreByProject[projId].sheetsById
    if (!sbi.Sheet) sbi.Sheet = {}
    sbi.Sheet.__emptyBox = {}
  })
  // tx2:往这个空容器写首个 key——模拟 scrub 提交首个关键帧;
  // 修复前这笔 backwardOps 为空,不进撤销栈
  saaz.tx(undefined, (draft: any) => {
    draft.historic.coreByProject[projId].sheetsById.Sheet.__emptyBox.firstKey =
      {value: 1}
  })

  expect(undoStackOf().length).toBe(len0 + 2) // 两笔都必须入栈

  const boxKeys = (): string[] => {
    const box = readCellAt([
      'historic',
      'coreByProject',
      projId,
      'sheetsById',
      'Sheet',
      '__emptyBox',
    ])
    const b = box && box.$branches && box.$branches[box.$type[1]]
    if (!b || !b.$mapProps) return []
    // saaz 删除是软删($type 标 deleted,key 仍在),统计可见 key 要过滤
    return Object.keys(b.$mapProps).filter(
      (k) => b.$mapProps[k]?.$type?.[0] !== 'deleted',
    )
  }
  expect(boxKeys()).toEqual(['firstKey'])

  // undo 弹掉 tx2:firstKey 消失(容器还在);redo 回来
  studio.undo()
  expect(boxKeys()).toEqual([])
  ;(studio as any).redo()
  expect(boxKeys()).toEqual(['firstKey'])
})

/** 预置 override:让 byObject.obj 子树与两个 prop 都已是「已有 key」 */
const PRESET_OVERRIDES = {
  byObject: {
    ['obj' as ObjectAddressKey]: {
      position: {x: 1, y: 1, z: 1},
      deeply: {nested: {checkbox: true}},
    },
  },
}

test('scrub.commit(false): 状态生效但不入撤销栈,undo 跳过它', async () => {
  const {objPublicAPI} = await setupTestSheet({
    staticOverrides: PRESET_OVERRIDES,
  })

  // 锚点:一笔可撤的真改动(修改已有 key,backward 为叶子级 SetBoxedValue)
  const scrubAnchor = studio.scrub()
  scrubAnchor.capture(({set}) => {
    set(objPublicAPI.props.deeply.nested.checkbox, false)
  })
  scrubAnchor.commit()
  expect(val(objPublicAPI.props.deeply.nested.checkbox)).toBe(false)

  // 被测:commit(false)
  const scrubB = studio.scrub()
  scrubB.capture(({set}) => {
    set(objPublicAPI.props.position, {x: 7, y: 8, z: 9})
  })
  scrubB.commit(false)
  // 生效:值立刻是新值
  expect(val(objPublicAPI.props.position)).toMatchObject({x: 7, y: 8, z: 9})

  // undo 弹栈顶。若 commit(false) 入了栈,栈顶就是它,position 会被弹回预置值;
  // 正确行为是栈顶仍是锚点:checkbox 回 true,position 保持 (7,8,9)
  studio.undo()
  expect(val(objPublicAPI.props.deeply.nested.checkbox)).toBe(true)
  expect(val(objPublicAPI.props.position)).toMatchObject({x: 7, y: 8, z: 9})

  // 对照组:默认 commit() 入栈、undo 回退
  const scrubC = studio.scrub()
  scrubC.capture(({set}) => {
    set(objPublicAPI.props.position, {x: 4, y: 4, z: 4})
  })
  scrubC.commit()
  expect(val(objPublicAPI.props.position)).toMatchObject({x: 4, y: 4, z: 4})
  studio.undo()
  expect(val(objPublicAPI.props.position)).toMatchObject({x: 7, y: 8, z: 9})
})

test('studio.setSelection: 选中变化不进撤销栈,undo 不改变选中', async () => {
  const {objPublicAPI} = await setupTestSheet({
    staticOverrides: PRESET_OVERRIDES,
  })

  // setSelection 在 TheatreStudio(publicApi)上,getStudio() 是私有 Studio
  const theatreStudio = (studio as any).publicApi as {
    setSelection: (s: unknown[]) => void
    selection: unknown[]
  }

  // 先压锚点占位栈顶:undo 弹什么由此可控(共享单例,栈里可能有 setup/init
  // 留下的旧条目,直接 undo 弹到它们会污染断言)
  const scrubAnchor = studio.scrub()
  scrubAnchor.capture(({set}) => {
    set(objPublicAPI.props.deeply.nested.checkbox, false)
  })
  scrubAnchor.commit()

  theatreStudio.setSelection([objPublicAPI])
  expect(theatreStudio.selection).toHaveLength(1)

  // undo 应弹锚点(checkbox 回 true)而不是 selection;若 setSelection 入了栈,
  // 栈顶是它,undo 会把选中弹回空——本断言即红
  studio.undo()
  expect(val(objPublicAPI.props.deeply.nested.checkbox)).toBe(true)
  expect(theatreStudio.selection).toHaveLength(1)

  theatreStudio.setSelection([])
})

test('studio.createContentOfSaveFile: revisionHistory 副作用不进撤销栈', async () => {
  const {objPublicAPI, project} = await setupTestSheet({
    staticOverrides: PRESET_OVERRIDES,
  })

  // 一笔真改动(修改已有 key,必入栈):undo 应该弹它,
  // 而不是 createContentOfSaveFile 的副作用
  const scrub = studio.scrub()
  scrub.capture(({set}) => {
    set(objPublicAPI.props.position, {x: 5, y: 5, z: 5})
  })
  scrub.commit()
  expect(val(objPublicAPI.props.position)).toMatchObject({x: 5, y: 5, z: 5})

  studio.createContentOfSaveFile(project.address.projectId)

  // 若 createContentOfSaveFile 的 revisionHistory 入了栈,栈顶是它,undo 先弹它,
  // position 保持 (5,5,5)——本断言即红;正确行为是直接弹掉真改动
  studio.undo()
  expect(val(objPublicAPI.props.position)).toMatchObject({x: 1, y: 1, z: 1})
})
