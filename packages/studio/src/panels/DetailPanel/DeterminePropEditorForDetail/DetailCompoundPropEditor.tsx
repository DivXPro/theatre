import type {
  PropTypeConfig_Compound,
  PropTypeConfig_Number,
} from '@dreamerbird/core/types/public'

import type {$FixMe} from '@dreamerbird/core/types/public'
import {Atom, getPointerParts} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import last from 'lodash-es/last'
import React, {useMemo} from 'react'
import styled from 'styled-components'
import {rowIndentationFormulaCSS} from '@dreamerbird/studio/panels/DetailPanel/DeterminePropEditorForDetail/rowIndentationFormulaCSS'
import {propNameTextCSS} from '@dreamerbird/studio/propEditors/utils/propNameTextCSS'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import DeterminePropEditorForDetail from '@dreamerbird/studio/panels/DetailPanel/DeterminePropEditorForDetail'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import {useEditingToolsForCompoundProp} from '@dreamerbird/studio/propEditors/useEditingToolsForCompoundProp'
import type {PropHighlighted} from '@dreamerbird/studio/panels/SequenceEditorPanel/whatPropIsHighlighted'
import {whatPropIsHighlighted} from '@dreamerbird/studio/panels/SequenceEditorPanel/whatPropIsHighlighted'
import {deriver} from '@dreamerbird/studio/utils/derive-utils'
import NumberPropEditor from '@dreamerbird/studio/propEditors/simpleEditors/NumberPropEditor'
import type {IDetailSimplePropEditorProps} from './DetailSimplePropEditor'
import {useEditingToolsForSimplePropInDetailsPanel} from '@dreamerbird/studio/propEditors/useEditingToolsForSimpleProp'
import {usePrism} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import {HiOutlineChevronRight} from 'react-icons/hi'
import memoizeFn from '@dreamerbird/utils/memoizeFn'
import {collapsedMap} from './collapsedMap'
import useChordial from '@dreamerbird/studio/uiComponents/chordial/useChodrial'
import {__private} from '@dreamerbird/core'
import {usePropLabel, useT} from '@dreamerbird/studio/i18n'
import {PropertyKeyframeField} from '@dreamerbird/studio/propEditors/PropertyKeyframeButton'

const {isPropConfigComposite} = __private.propTypeUtils

const Container = styled.div`
  --step: 8px;
  --left-pad: 8px;
  ${pointerEventsAutoInNormalMode};

  &[data-section='true'] {
    margin: 6px 0;
    padding-bottom: 5px;
    border: 1px solid var(--theatre-panel-border);
    border-radius: 9px;
    background: var(--theatre-panel-bg-95);
  }
`

const Header = styled.div`
  height: 30px;
  display: flex;
  align-items: stretch;
  position: relative;
`

const Padding = styled.div`
  padding-left: ${rowIndentationFormulaCSS};
  display: flex;
  align-items: center;
  width: 100%;
  overflow: hidden;
`

const ControlIndicators = styled.div`
  flex-shrink: 0;
`

const PropName = deriver(styled.div<{$isHighlighted: PropHighlighted}>`
  min-width: 0;
  margin-left: 4px;
  cursor: default;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
  &:hover {
    color: var(--theatre-text-primary);
  }
  overflow: hidden;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  ${() => propNameTextCSS};
`)

const CollapseIcon = styled.button<{$isCollapsed: boolean}>`
  width: 25px;
  height: 25px;
  margin-left: auto;
  margin-right: 3px;
  padding: 0;
  flex: none;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--theatre-text-muted);
  cursor: pointer;

  svg {
    transform: rotate(${({$isCollapsed}) => ($isCollapsed ? 0 : 90)}deg);
  }
  &:hover {
    background: var(--theatre-input-bg);
    color: var(--theatre-text-primary);
  }
  &:focus-visible {
    outline: 1px solid var(--theatre-accent);
  }
`

const PropertySection = styled.details`
  margin: 5px 0;
  padding-bottom: 4px;
  border: 1px solid var(--theatre-panel-border);
  border-radius: 9px;
  background: var(--theatre-panel-bg-95);

  > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 29px;
    padding: 0 8px;
    font-weight: 600;
    cursor: pointer;
  }
  > summary::-webkit-details-marker {
    display: none;
  }
  &[open] > summary svg {
    transform: rotate(90deg);
  }
  > summary:focus-visible {
    outline: 1px solid var(--theatre-accent);
    border-radius: 7px;
  }
`

const transformKeys = ['position', 'rotation', 'scale']
const lensKeys = ['fov', 'zoom', 'near', 'far']

const SubProps = styled.div<{$depth: number; $lastSubIsComposite: boolean}>`
  /* padding: ${(props) => (props.$lastSubIsComposite ? 0 : '4px')} 0; */
`

const isVectorProp = memoizeFn((propConfig: PropTypeConfig_Compound<any>) => {
  const props = Object.entries(propConfig.props)

  return (
    props.length <= 3 &&
    props.every(
      ([name, conf]) =>
        conf.type === 'number' && ['x', 'y', 'z'].includes(name),
    )
  )
})

function VectorComponentEditor<TPropTypeConfig extends PropTypeConfig_Number>({
  propConfig,
  pointerToProp,
  obj,
  axis,
  label,
}: Pick<
  IDetailSimplePropEditorProps<TPropTypeConfig>,
  'obj' | 'pointerToProp' | 'propConfig'
> & {axis: string; label: string}) {
  const editingTools = useEditingToolsForSimplePropInDetailsPanel(
    pointerToProp,
    obj,
    propConfig,
  )

  return (
    <PropertyKeyframeField
      object={obj}
      pointer={pointerToProp}
      axis={axis}
      label={label}
    >
      <NumberPropEditor
        editingTools={editingTools}
        propConfig={propConfig}
        value={editingTools.value}
      />
    </PropertyKeyframeField>
  )
}

const InputContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: stretch;
  gap: 4px;
  padding: 0 6px 1px;
  box-sizing: border-box;
`

export type ICompoundPropDetailEditorProps<
  TPropTypeConfig extends PropTypeConfig_Compound<any>,
> = {
  propConfig: TPropTypeConfig
  pointerToProp: Pointer<TPropTypeConfig['valueType']>
  obj: SheetObject
  visualIndentation: number
}

function DetailCompoundPropEditor<
  TPropTypeConfig extends PropTypeConfig_Compound<any>,
>({
  pointerToProp,
  obj,
  propConfig,
  visualIndentation,
}: ICompoundPropDetailEditorProps<TPropTypeConfig>) {
  const t = useT()
  const propName =
    usePropLabel(propConfig.label) ??
    (last(getPointerParts(pointerToProp).path) as string)

  const allSubs = Object.entries(propConfig.props).filter(
    ([, conf]) => !conf.hidden,
  )
  const compositeSubs = allSubs.filter(([_, conf]) =>
    isPropConfigComposite(conf),
  )
  const nonCompositeSubs = allSubs.filter(
    ([_, conf]) => !isPropConfigComposite(conf),
  )

  const tools = useEditingToolsForCompoundProp(
    pointerToProp as $FixMe,
    obj,
    propConfig,
  )

  // 根 compound(对象本身的属性树)没有 propName,回退到收编的"Props/属性"
  const label: string = propName || t('detailPanel.propsRoot')

  const lastSubPropIsComposite = compositeSubs.length > 0

  const isPropHighlightedD = useMemo(
    () =>
      whatPropIsHighlighted.getIsPropHighlightedD({
        ...obj.address,
        pathToProp: getPointerParts(pointerToProp).path,
      }),
    [pointerToProp],
  )

  // isVectorProp is already memoized, so no need to wrap this in `useMemo()`
  const isVector = isVectorProp(propConfig)

  const isCollapsedAtom = useMemo(() => {
    if (!collapsedMap.has(pointerToProp)) {
      collapsedMap.set(pointerToProp, new Atom(isVector))
    }
    return collapsedMap.get(pointerToProp)!
  }, [pointerToProp])

  const isCollapsed = usePrism(() => {
    return isCollapsedAtom ? val(isCollapsedAtom.pointer) : isVector
  }, [isCollapsedAtom, isVector])

  const {targetRef} = useChordial(() => {
    const title = ['obj', 'props', ...getPointerParts(pointerToProp).path].join(
      '.',
    )
    return {title, items: tools.contextMenuItems}
  })

  const renderSub = ([key, config]: (typeof allSubs)[number]) => (
    <DeterminePropEditorForDetail
      key={key}
      propConfig={config}
      pointerToProp={(pointerToProp as $FixMe)[key] as Pointer<$FixMe>}
      obj={obj}
      visualIndentation={visualIndentation + 1}
    />
  )
  const renderSection = (title: string, entries: typeof allSubs) =>
    entries.length > 0 && (
      <PropertySection open>
        <summary>
          {title}
          <HiOutlineChevronRight aria-hidden="true" />
        </summary>
        {entries.map(renderSub)}
      </PropertySection>
    )
  const ordered = [...nonCompositeSubs, ...compositeSubs]
  const transform =
    visualIndentation === 1
      ? compositeSubs.filter(
          ([key, config]) =>
            transformKeys.includes(key) &&
            config.type === 'compound' &&
            isVectorProp(config),
        )
      : []
  const lens =
    visualIndentation === 1 && nonCompositeSubs.some(([key]) => key === 'fov')
      ? nonCompositeSubs.filter(([key]) => lensKeys.includes(key))
      : []
  const grouped = new Set([...transform, ...lens])
  const other = ordered.filter((entry) => !grouped.has(entry))

  return (
    <Container data-section={visualIndentation === 2 && !isVector}>
      <Header
        // @ts-ignore
        style={{'--depth': visualIndentation - 1}}
      >
        <Padding>
          <ControlIndicators>{tools.controlIndicators}</ControlIndicators>

          <PropName $isHighlighted={isPropHighlightedD} ref={targetRef}>
            <span>{label}</span>
          </PropName>
          <CollapseIcon
            type="button"
            $isCollapsed={isCollapsed}
            aria-expanded={!isCollapsed}
            aria-label={label}
            onClick={() => {
              isCollapsedAtom.set(!isCollapsedAtom.get())
            }}
          >
            <HiOutlineChevronRight />
          </CollapseIcon>
        </Padding>
      </Header>
      {isVector && isCollapsed && (
        <InputContainer>
          {[...allSubs].map(([subPropKey, subPropConfig]) => {
            return (
              <VectorComponentEditor
                key={'prop-' + subPropKey}
                axis={subPropKey}
                label={`${label} ${subPropKey.toUpperCase()}`}
                // @ts-ignore
                propConfig={subPropConfig}
                pointerToProp={
                  (pointerToProp as $FixMe)[subPropKey] as Pointer<$FixMe>
                }
                obj={obj}
              />
            )
          })}
        </InputContainer>
      )}

      {!isCollapsed && (
        <SubProps
          // @ts-ignore
          style={{'--depth': visualIndentation}}
          $depth={visualIndentation}
          $lastSubIsComposite={lastSubPropIsComposite}
        >
          {renderSection(t('workspace.transform'), transform)}
          {renderSection(t('workspace.lens'), lens)}
          {other.map(renderSub)}
        </SubProps>
      )}
    </Container>
  )
}

export default React.memo(DetailCompoundPropEditor)
