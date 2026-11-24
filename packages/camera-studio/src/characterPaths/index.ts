import {getStudioSync, types} from '@dreamerbird/core'
import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {translate} from '@dreamerbird/studio/i18n'
import '../i18n'
import {getPathMeta} from '../CameraPath'
import {parsePathPoints} from '../pathModel'
import type {PathTransform, Vec3Like} from '../pathModel'
import {getPathsRegistry, parsePathEntries} from '../pathRegistry'
import type {PathEntry} from '../pathRegistry'
import {buildCharacterPathSampler} from './sampler'
import type {CharacterPathForward, CharacterPathSample} from './sampler'
export type {CharacterPathForward, CharacterPathSample} from './sampler'

export const CHARACTER_PATH_EDITOR = 'characterPathBinding'

export const characterPathPropConfig = {
  characterPathId: types.string('', {
    label: () => translate('pg.characterPath.property'),
    editor: CHARACTER_PATH_EDITOR,
  }),
  characterPathOrient: types.boolean(true, {hidden: true}),
  characterPathProgress: types.number(0, {
    range: [0, 100],
    label: () => translate('pg.characterPath.progress'),
    hidden: true,
  }),
}

export type CharacterPathValues = {
  [prop: string]: unknown
  characterPathId?: string
  characterPathOrient?: boolean
  characterPathProgress?: number
}

export type CharacterPathBinding = {pathKey: string; orient: boolean}
export type CharacterPathChannels = {position: boolean; rotation: boolean}
export type CharacterPathBindingValidator = (
  proposal: CharacterPathBinding & CharacterPathChannels,
) => string | undefined

type BindingResult = {ok: true} | {ok: false; message: string}
type IdentifiedPath = PathEntry & {characterPathId?: string}

export type CharacterPathEvaluation =
  | {status: 'unbound'}
  | {status: 'missing'; pathId: string; pathKey?: string}
  | ({status: 'active'; pathId: string; pathKey: string} & CharacterPathSample)

const validators = new WeakMap<object, CharacterPathBindingValidator>()
const pathLists = new WeakMap<ISheet, {json: string; paths: IdentifiedPath[]}>()
const samplers = new WeakMap<
  ReturnType<typeof getPathMeta>,
  {
    points: string
    transform: PathTransform
    sampler: ReturnType<typeof buildCharacterPathSampler>
  }
>()
const defaultForward = {x: 0, z: 1}
let nextId = 0

function readScenePaths(sheet: ISheet): IdentifiedPath[] {
  const json = getPathsRegistry(sheet).value.list
  const cached = pathLists.get(sheet)
  if (cached?.json === json) return cached.paths
  const paths = parsePathEntries(json)
  pathLists.set(sheet, {json, paths})
  return paths
}

function sameVector(left: Vec3Like, right: Vec3Like): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z
}

function readSampler(sheet: ISheet, pathKey: string) {
  const meta = getPathMeta(sheet, pathKey)
  const {points, position, rotation, scale} = meta.value
  const transform = {
    position: position as Vec3Like,
    rotation: rotation as Vec3Like,
    scale: scale as Vec3Like,
  }
  const cached = samplers.get(meta)
  if (
    cached?.points === points &&
    sameVector(cached.transform.position, transform.position) &&
    sameVector(cached.transform.rotation, transform.rotation) &&
    sameVector(cached.transform.scale, transform.scale)
  ) {
    return cached.sampler
  }
  const sampler = buildCharacterPathSampler(parsePathPoints(points), transform)
  samplers.set(meta, {points, transform, sampler})
  return sampler
}

export function readCharacterPathChoices(sheet: ISheet): PathEntry[] {
  return readScenePaths(sheet).filter(({pathKey}) =>
    readSampler(sheet, pathKey),
  )
}

export function getCharacterPathChannels(
  values: CharacterPathValues,
): CharacterPathChannels {
  const position = Boolean(values.characterPathId)
  return {position, rotation: position && (values.characterPathOrient ?? true)}
}

export function evaluateCharacterPath(
  sheet: ISheet,
  values: CharacterPathValues,
  modelForward: CharacterPathForward = defaultForward,
): CharacterPathEvaluation {
  const pathId = values.characterPathId
  if (!pathId) return {status: 'unbound'}
  const path = readScenePaths(sheet).find(
    (entry) => entry.characterPathId === pathId,
  )
  const pathKey = path?.pathKey
  if (!pathKey) {
    const marker = pathId.lastIndexOf(': ')
    return {
      status: 'missing',
      pathId,
      pathKey: marker > 0 ? pathId.slice(0, marker) : undefined,
    }
  }
  const sampler = readSampler(sheet, pathKey)
  if (!sampler) return {status: 'missing', pathId, pathKey}
  return {
    status: 'active',
    pathId,
    pathKey,
    ...sampler.sample(
      values.characterPathProgress ?? 0,
      values.characterPathOrient ?? true ? modelForward : undefined,
    ),
  }
}

export function validateCharacterPathForExport(
  sheet: ISheet,
  values: CharacterPathValues,
) {
  const evaluation = evaluateCharacterPath(sheet, values)
  if (evaluation.status !== 'missing') return undefined
  return {
    code: 'RESOURCE_LOAD_FAILED' as const,
    pathId: evaluation.pathId,
    pathKey: evaluation.pathKey,
    message: `Character path "${
      evaluation.pathKey ?? evaluation.pathId
    }" is missing or has no usable curve. Choose another path or unbind the character.`,
  }
}

export function registerCharacterPathBindingValidator(
  obj: ISheetObject<any>,
  validate: CharacterPathBindingValidator,
): () => void {
  validators.set(obj, validate)
  return () => {
    if (validators.get(obj) === validate) validators.delete(obj)
  }
}

export function setCharacterPathBinding(
  obj: ISheetObject<any>,
  {pathKey, orient}: CharacterPathBinding,
): BindingResult {
  const studio = getStudioSync()
  if (!studio) return {ok: false, message: 'Studio is unavailable.'}
  const character = obj as ISheetObject<typeof characterPathPropConfig>
  const {sheet} = character
  if (!pathKey) {
    studio.transaction(({set}) => set(character.props.characterPathId, ''))
    return {ok: true}
  }

  const paths = readScenePaths(sheet)
  const path = paths.find((entry) => entry.pathKey === pathKey)
  if (!path || !readSampler(sheet, pathKey)) {
    return {
      ok: false,
      message: 'The selected path is missing or has no usable curve.',
    }
  }
  const message = validators.get(obj)?.({
    pathKey,
    orient,
    position: true,
    rotation: orient,
  })
  if (message) return {ok: false, message}

  const pathId =
    path.characterPathId ||
    `${pathKey}: ${
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++nextId}`
    }`
  studio.transaction(({set, sequenceProp}) => {
    if (!path.characterPathId) {
      set(
        getPathsRegistry(sheet).props.list,
        JSON.stringify(
          paths.map((entry) =>
            entry === path ? {...entry, characterPathId: pathId} : entry,
          ),
        ),
      )
    }
    set(character.props.characterPathId, pathId)
    set(character.props.characterPathOrient, orient)
    // 绑定时就建立空的进度轨道:时间轴会立即出现「路径进度 (%)」行,
    // 用户可以在播放头的 ◇ 上直接打第一颗关键帧。空轨道不写值,
    // 当前静态进度仍按 Theatre 的默认回退规则生效。
    sequenceProp(character.props.characterPathProgress)
  })
  return {ok: true}
}
