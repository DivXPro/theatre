import React, {useState} from 'react'
import type {ISheetObject} from '@dreamerbird/core'
import type {PropTypeConfig_AllSimples} from '@dreamerbird/core/types/public'
import {usePrism, useVal} from '@dreamerbird/react'
import {useI18n} from '@dreamerbird/studio/i18n'
import {
  registerCustomPropEditor,
  unregisterCustomPropEditor,
} from '@dreamerbird/studio/propEditors/customPropEditors'
import type {ISimplePropEditorReactProps} from '@dreamerbird/studio/propEditors/simpleEditors/ISimplePropEditorReactProps'
import usePopover from '@dreamerbird/studio/uiComponents/Popover/usePopover'
import {revealAdditionalSequenceRows} from '@dreamerbird/studio/panels/SequenceEditorPanel/additionalRows'
import {pathObjectName} from '../CameraPath'
import type {PathEntry} from '../pathRegistry'
import {
  CHARACTER_PATH_EDITOR,
  evaluateCharacterPath,
  readCharacterPathChoices,
  setCharacterPathBinding,
} from './index'
import type {
  characterPathPropConfig,
  CharacterPathBinding,
  CharacterPathEvaluation,
} from './index'

const labels = {
  en: {
    bind: 'Bind path…',
    settings: 'Character path settings',
    repair: 'Repair path…',
    missing: 'The bound path is missing or has no usable curve.',
    empty: 'Add a usable scene path from the path library.',
    path: 'Scene path',
    choose: 'Choose a path',
    orient: 'Orient along path',
    bound: 'Bound',
    heading: 'Heading',
    fixedHeading: 'Fixed heading',
    confirm: 'Confirm binding',
    unbind: 'Unbind',
    cancel: 'Cancel',
    position: 'The path drives position. Position keys resume when unbound.',
    positionAndRotation:
      'The path drives position and heading. Their keys resume when unbound.',
  },
  zh: {
    bind: '绑定路径…',
    settings: '角色路径设置',
    repair: '修复路径…',
    missing: '绑定的路径已丢失或没有可用曲线。',
    empty: '请从路径库添加一条可用的场景路径。',
    path: '场景路径',
    choose: '选择路径',
    orient: '沿路径转向',
    bound: '已绑定',
    heading: '转向',
    fixedHeading: '固定朝向',
    confirm: '确认绑定',
    unbind: '解除绑定',
    cancel: '取消',
    position: '路径接管位置。解除绑定后恢复位置关键帧。',
    positionAndRotation: '路径接管位置和朝向。解除绑定后恢复原有关键帧。',
  },
}

function usePathLabels() {
  const {language} = useI18n()
  return labels[language.startsWith('zh') ? 'zh' : 'en']
}

type CharacterPathBindingFormProps = {
  choices: PathEntry[]
  evaluation: CharacterPathEvaluation
  orient: boolean
  style?: React.CSSProperties
  commit: (
    binding: CharacterPathBinding,
  ) => ReturnType<typeof setCharacterPathBinding>
  close: () => void
}

export const CharacterPathBindingForm = React.forwardRef<
  HTMLFormElement,
  CharacterPathBindingFormProps
>(function CharacterPathBindingForm(
  {choices, evaluation, orient, commit, close, style},
  ref,
) {
  const text = usePathLabels()
  const [pathKey, setPathKey] = useState(
    evaluation.status === 'active' ? evaluation.pathKey : '',
  )
  const [draftOrient, setDraftOrient] = useState(orient)
  const [error, setError] = useState('')
  const canBind = choices.some((entry) => entry.pathKey === pathKey)

  const submit = (key: string) => {
    const result = commit({pathKey: key, orient: draftOrient})
    if (result.ok) close()
    else setError(result.message)
  }
  return (
    <form
      ref={ref}
      aria-label={text.settings}
      onSubmit={(event) => {
        event.preventDefault()
        if (canBind) submit(pathKey)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
      className="cs-character-path-popup"
      style={style}
    >
      {evaluation.status === 'missing' && <div>{text.missing}</div>}
      {evaluation.status === 'active' && (
        <div>{orient ? text.positionAndRotation : text.position}</div>
      )}
      {choices.length > 0 ? (
        <label className="cs-character-path-field">
          {text.path}
          <select
            autoFocus
            value={canBind ? pathKey : ''}
            onChange={(event) => {
              setPathKey(event.currentTarget.value)
              setError('')
            }}
          >
            <option value="" disabled>
              {text.choose}
            </option>
            {choices.map(({pathKey: key}) => (
              <option key={key} value={key}>
                {pathObjectName(key)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div>{text.empty}</div>
      )}
      <label>
        <input
          type="checkbox"
          checked={draftOrient}
          onChange={(event) => {
            setDraftOrient(event.currentTarget.checked)
            setError('')
          }}
        />
        {text.orient}
      </label>
      {error && <div role="alert">{error}</div>}
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
        <button type="submit" disabled={!canBind}>
          {text.confirm}
        </button>
        {evaluation.status !== 'unbound' && (
          <button type="button" onClick={() => submit('')}>
            {text.unbind}
          </button>
        )}
        <button type="button" onClick={close}>
          {text.cancel}
        </button>
      </div>
    </form>
  )
})

function CharacterPathRow({
  character,
}: {
  character: ISheetObject<typeof characterPathPropConfig>
}) {
  const text = usePathLabels()
  const evaluation = usePrism(
    () => evaluateCharacterPath(character.sheet, character.value),
    [character],
  )
  const orient = useVal(character.props.characterPathOrient)
  const popover = usePopover(
    {debugName: 'CharacterPathEditor', closeWhenPointerIsDistant: false},
    () => (
      <BindingPopover
        character={character}
        evaluation={evaluation}
        orient={orient}
        close={() => popover.close('binding finished')}
      />
    ),
  )
  const caption =
    evaluation.status === 'active'
      ? `${text.bound} · ${orient ? text.heading : text.fixedHeading}`
      : evaluation.status === 'missing'
        ? text.repair
        : text.bind
  return (
    <div className="cs-character-path-control">
      <button
        type="button"
        aria-label={evaluation.status === 'active' ? text.settings : caption}
        aria-expanded={popover.isOpen}
        title={
          evaluation.status === 'active'
            ? pathObjectName(evaluation.pathKey)
            : caption
        }
        onClick={(event) => popover.toggle(event, event.currentTarget)}
        className="cs-character-path-trigger"
      >
        {caption}
      </button>
      {popover.node}
    </div>
  )
}

const BindingPopover = React.forwardRef<
  HTMLFormElement,
  {
    character: ISheetObject<typeof characterPathPropConfig>
    evaluation: CharacterPathEvaluation
    orient: boolean
    close: () => void
    style?: React.CSSProperties
  }
>(function BindingPopover({character, evaluation, orient, close, style}, ref) {
  const {sheet} = character
  const choices = usePrism(() => readCharacterPathChoices(sheet), [sheet])
  return (
    <CharacterPathBindingForm
      ref={ref}
      style={style}
      choices={choices}
      evaluation={evaluation}
      orient={orient}
      commit={(binding) => {
        const result = setCharacterPathBinding(character, binding)
        if (result.ok && binding.pathKey) {
          revealAdditionalSequenceRows(character as unknown as ISheetObject)
        }
        return result
      }}
      close={close}
    />
  )
})

export function CharacterPathEditor(
  props: ISimplePropEditorReactProps<PropTypeConfig_AllSimples>,
) {
  if (!props.obj || !('type' in props.editingTools)) return <></>
  return (
    <CharacterPathRow
      key={props.obj.address.objectKey}
      character={
        props.obj.publicApi as unknown as ISheetObject<
          typeof characterPathPropConfig
        >
      }
    />
  )
}

let mountedScenes = 0

export function registerCharacterPathEditor(): () => void {
  if (mountedScenes++ === 0) {
    registerCustomPropEditor(CHARACTER_PATH_EDITOR, CharacterPathEditor)
  }
  return () => {
    if (--mountedScenes === 0) unregisterCustomPropEditor(CHARACTER_PATH_EDITOR)
  }
}
