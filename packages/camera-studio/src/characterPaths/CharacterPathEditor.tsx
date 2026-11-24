import React, {useState} from 'react'
import type {ISheetObject} from '@dreamerbird/core'
import type {PropTypeConfig_AllSimples} from '@dreamerbird/core/types/public'
import {usePrism, useVal} from '@dreamerbird/react'
import {useT} from '@dreamerbird/studio/i18n'
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
  const t = useT()
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
      aria-label={t('pg.characterPath.settings')}
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
      {evaluation.status === 'missing' && (
        <div>{t('pg.characterPath.missing')}</div>
      )}
      {evaluation.status === 'active' && (
        <div>
          {orient
            ? t('pg.characterPath.positionAndRotation')
            : t('pg.characterPath.position')}
        </div>
      )}
      {choices.length > 0 ? (
        <label className="cs-character-path-field">
          {t('pg.characterPath.path')}
          <select
            autoFocus
            value={canBind ? pathKey : ''}
            onChange={(event) => {
              setPathKey(event.currentTarget.value)
              setError('')
            }}
          >
            <option value="" disabled>
              {t('pg.characterPath.choose')}
            </option>
            {choices.map(({pathKey: key}) => (
              <option key={key} value={key}>
                {pathObjectName(key)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div>{t('pg.characterPath.empty')}</div>
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
        {t('pg.characterPath.orient')}
      </label>
      {error && <div role="alert">{error}</div>}
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
        <button type="submit" disabled={!canBind}>
          {t('pg.characterPath.confirm')}
        </button>
        {evaluation.status !== 'unbound' && (
          <button type="button" onClick={() => submit('')}>
            {t('pg.characterPath.unbind')}
          </button>
        )}
        <button type="button" onClick={close}>
          {t('pg.characterPath.cancel')}
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
  const t = useT()
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
      ? `${t('pg.characterPath.bound')} · ${
          orient
            ? t('pg.characterPath.heading')
            : t('pg.characterPath.fixedHeading')
        }`
      : evaluation.status === 'missing'
        ? t('pg.characterPath.repair')
        : t('pg.characterPath.bind')
  return (
    <div className="cs-character-path-control">
      <button
        type="button"
        aria-label={
          evaluation.status === 'active'
            ? t('pg.characterPath.settings')
            : caption
        }
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
