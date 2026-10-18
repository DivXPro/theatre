/**
 * 静态属性访问守卫(2026-10-17,Task 5):objects.update 与姿势/相机/路径
 * 领域命令共用的值形状校验、建轨检测和单事务静态写入。检测逻辑集中在
 * 本模块,不散落到各命令。
 *
 * 建轨检测与 poseTrack.getTrackIdForProp、Sequence.getKeyframesOfSimpleProp
 * 读同一份内部 track map(historic tracksByObject):顶层简单属性直接复用
 * getTrackIdForProp;compound 顶层与叶子路径经公共 sheet.sequence.getKeyframes
 * 适配(其内部即 trackIdByPropPath,键为 encodePathToProp(path))。
 *
 * 写入经 getStudioSync(与 poseTrack/Anchors/ShotCamera 同先例);整个 patch
 * 在单个 transaction 回调内同步写完,回调不跨 await。
 */
import {getStudioSync} from '@dreamerbird/core'
import type {ISheetObject} from '@dreamerbird/core'
import type {$IntentionalAny} from '@dreamerbird/core/types/public'
import type {Pointer} from '@dreamerbird/dataverse'
import {getTrackIdForProp} from '../poseMode/poseTrack'
import {AgentApiError} from './errors'

/**
 * 领域命令专属属性:generic objects.update 拒绝写入;姿势/相机/锚点/路径
 * 命令完成自身校验与建轨检查后,经 setStaticProps 写各自显式拥有的属性。
 */
const domainOwnedProps = new Set([
  'points',
  'pose',
  'poseOverride',
  'gestureL',
  'gestureR',
  'animation',
  'aimTarget',
  'pathKey',
  'parent',
  'source',
])

export {domainOwnedProps}

/** 按点路径('position.x')从 obj.props 导航出叶子指针,供 keyframes.* 使用 */
export function getSimplePropPointer(
  obj: ISheetObject<$IntentionalAny>,
  propPath: string,
): Pointer<$IntentionalAny> {
  let pointer = obj.props as $IntentionalAny
  for (const segment of propPath.split('.')) {
    pointer = pointer?.[segment]
  }
  return pointer as Pointer<$IntentionalAny>
}

/**
 * 检测属性是否已建轨。propPath 为顶层名('position')或点路径('position.x'):
 * - 顶层简单属性:getTrackIdForProp 直接命中;
 * - 顶层 compound:当前值的任一叶子建轨即整属性视为已建轨;
 * - 叶子路径:sheet.sequence.getKeyframes(同 getKeyframesOfSimpleProp 的
 *   内部 track map)非空即已建轨。
 */
export function isPropSequenced(
  obj: ISheetObject<$IntentionalAny>,
  propPath: string,
): boolean {
  const segments = propPath.split('.').filter((segment) => segment.length > 0)
  if (segments.length === 0) return false
  const [top, ...rest] = segments
  if (getTrackIdForProp(obj, top)) return true
  if (rest.length > 0) return leafSequenced(obj, segments)
  const current = (obj.value as Record<string, unknown> | undefined)?.[top]
  if (current && typeof current === 'object') {
    return collectLeafPaths(current).some((leaf) =>
      leafSequenced(obj, [top, ...leaf]),
    )
  }
  return false
}

function leafSequenced(
  obj: ISheetObject<$IntentionalAny>,
  segments: string[],
): boolean {
  const pointer = getSimplePropPointer(obj, segments.join('.'))
  return obj.sheet.sequence.getKeyframes(pointer as Pointer<{}>).length > 0
}

/** 收集 compound 当前值的全部叶子相对路径(空对象无叶子) */
function collectLeafPaths(value: object, prefix: string[] = []): string[][] {
  const paths: string[][] = []
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      paths.push(...collectLeafPaths(child, [...prefix, key]))
    } else {
      paths.push([...prefix, key])
    }
  }
  return paths
}

/** 值形状与当前求值递归匹配;compound 键集合必须完全一致(不做部分深合并) */
function validateValueShape(
  label: string,
  current: unknown,
  value: unknown,
): void {
  if (typeof current === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AgentApiError('INVALID_ARGUMENT', `${label} 必须是有限数字`)
    }
    return
  }
  if (typeof current === 'string' || typeof current === 'boolean') {
    if (typeof value !== typeof current) {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `${label} 必须是 ${typeof current} 类型`,
      )
    }
    return
  }
  if (Array.isArray(current)) {
    if (!Array.isArray(value) || value.length !== current.length) {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `${label} 必须是长度为 ${current.length} 的数组`,
      )
    }
    current.forEach((item, index) =>
      validateValueShape(`${label}[${index}]`, item, value[index]),
    )
    return
  }
  if (current && typeof current === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentApiError('INVALID_ARGUMENT', `${label} 必须是对象`)
    }
    const currentRecord = current as Record<string, unknown>
    const valueRecord = value as Record<string, unknown>
    const missing = Object.keys(currentRecord).filter(
      (key) => !(key in valueRecord),
    )
    const extra = Object.keys(valueRecord).filter(
      (key) => !(key in currentRecord),
    )
    if (missing.length > 0 || extra.length > 0) {
      const parts: string[] = []
      if (missing.length > 0) parts.push(`缺少 ${missing.join('、')}`)
      if (extra.length > 0) parts.push(`多余 ${extra.join('、')}`)
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `${label} 必须提供完整 compound 值(${parts.join(';')})`,
      )
    }
    for (const key of Object.keys(currentRecord)) {
      validateValueShape(
        `${label}.${key}`,
        currentRecord[key],
        valueRecord[key],
      )
    }
    return
  }
  throw new AgentApiError(
    'INVALID_ARGUMENT',
    `${label} 的当前值无法确定形状,拒绝写入`,
  )
}

/**
 * 写前校验:属性存在、值形状递归匹配(有限数字/完整 compound)、未建轨。
 * 全部通过才返回;任何一项失败抛出,调用方不得已进入事务。
 */
export function assertStaticPropsWritable(
  sheetObject: ISheetObject<$IntentionalAny>,
  props: Record<string, unknown>,
): void {
  const current = sheetObject.value as Record<string, unknown> | undefined
  for (const [key, value] of Object.entries(props)) {
    if (key.includes('.')) {
      throw new AgentApiError(
        'INVALID_ARGUMENT',
        `props 是顶层属性 patch,不接受嵌套路径: ${key}`,
      )
    }
    if (!current || !(key in current)) {
      throw new AgentApiError('INVALID_ARGUMENT', `未知属性: ${key}`, {
        details: {prop: key},
      })
    }
    validateValueShape(key, current[key], value)
  }
  for (const key of Object.keys(props)) {
    if (isPropSequenced(sheetObject, key)) {
      throw new AgentApiError(
        'INVALID_STATE',
        `属性 ${key} 已建轨,请改用 keyframes.* 写入`,
        {details: {prop: key}},
      )
    }
  }
}

/**
 * 低层静态写入:先全量校验(值形状 + 建轨),再在单个事务内写完整个
 * patch。供 objects.update 与领域命令复用;Studio 不可用抛
 * SCENE_UNAVAILABLE(不静默返回,spec 8.3)。
 */
export function setStaticProps(
  sheetObject: ISheetObject<$IntentionalAny>,
  props: Record<string, unknown>,
): void {
  assertStaticPropsWritable(sheetObject, props)
  writePropsInTransaction(sheetObject, props)
}

/**
 * 领域静态写入 + 坐标定格同事务(2026-10-19,Agent API F1 修复):
 * 绑定/父级切换类命令(setParent/clearParent/unbindPath/setAimTarget 解除)
 * 把看护 effect 的坐标定格折进写领域属性的同一事务,守住
 * undoable:'single-step' 契约(一次撤销同时回退属性与定格)。
 *
 * preflight(值形状 + 建轨拒绝)只覆盖 props 里的领域属性;freeze 里的
 * position/rotation 与 UI 看护的 scrub 写入同语义——不做建轨拒绝
 * (已建轨时 UI 看护同样照写),但只在领域属性通过校验后才落笔。
 */
export function setStaticPropsWithFreeze(
  sheetObject: ISheetObject<$IntentionalAny>,
  props: Record<string, unknown>,
  freeze: Record<string, unknown>,
): void {
  assertStaticPropsWritable(sheetObject, props)
  writePropsInTransaction(sheetObject, {...props, ...freeze})
}

function writePropsInTransaction(
  sheetObject: ISheetObject<$IntentionalAny>,
  props: Record<string, unknown>,
): void {
  const studio = getStudioSync()
  if (!studio) {
    throw new AgentApiError(
      'SCENE_UNAVAILABLE',
      'Studio 不可用,无法写入静态属性',
    )
  }
  studio.transaction(({set}) => {
    for (const [key, value] of Object.entries(props)) {
      set((sheetObject.props as $IntentionalAny)[key], value)
    }
  })
}
