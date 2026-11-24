import type {VoidFn} from '@dreamerbird/core/types/public'
import {pointerEventsAutoInNormalMode} from '@dreamerbird/studio/css'
import React from 'react'
import styled, {css} from 'styled-components'
import {PresenceFlag} from '@dreamerbird/studio/uiComponents/usePresence'
import usePresence from '@dreamerbird/studio/uiComponents/usePresence'
import type {StudioSheetItemKey} from '@dreamerbird/core/types/private'
import type {BasicKeyframe} from '@dreamerbird/core'

export type NearbyKeyframesControls = {
  prev?: Pick<BasicKeyframe, 'position'> & {
    jump: VoidFn
    itemKey: StudioSheetItemKey
  }
  cur:
    | {type: 'on'; toggle: VoidFn; itemKey: StudioSheetItemKey}
    | {type: 'off'; toggle: VoidFn}
  next?: Pick<BasicKeyframe, 'position'> & {
    jump: VoidFn
    itemKey: StudioSheetItemKey
  }
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-left: 2px;
  border-radius: 5px;
  opacity: 0.7;

  &:hover {
    opacity: 1;
    background: var(--theatre-input-bg);
  }
`

const Button = styled.div`
  display: grid;
  place-items: center;
  flex: 0 0 13px;
  width: 13px;
  height: 20px;
  background: none;
  border: 0;
  outline: none;
  cursor: pointer;
`

export const nextPrevCursorsTheme = {
  offColor: '#555',
  onColor: '#e0c917',
}

const CurButton = styled(Button)<{
  $isOn: boolean
  $presence: PresenceFlag | undefined
}>`
  ${pointerEventsAutoInNormalMode};

  &:hover {
    color: #e0c917;
  }

  color: ${(props) =>
    props.$presence === PresenceFlag.Primary
      ? 'white'
      : props.$isOn
        ? nextPrevCursorsTheme.onColor
        : nextPrevCursorsTheme.offColor};
`

const pointerEventsNone = css`
  pointer-events: none !important;
`

const PrevOrNextButton = styled(Button)<{
  $available: boolean
  $flag: PresenceFlag | undefined
}>`
  color: ${(props) =>
    props.$flag === PresenceFlag.Primary
      ? 'white'
      : props.$available
        ? nextPrevCursorsTheme.onColor
        : nextPrevCursorsTheme.offColor};

  ${(props) =>
    props.$available ? pointerEventsAutoInNormalMode : pointerEventsNone};
`

namespace Icons {
  const Chevron_Group = styled.g`
    stroke-width: 1;
    ${PrevOrNextButton}:hover & path {
      stroke-width: 3;
    }
  `

  export const Prev = () => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Chevron_Group transform={`translate(6 3)`}>
        <path d="M4 1L1 4L4 7" stroke="currentColor" />
      </Chevron_Group>
    </svg>
  )

  export const Next = () => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Chevron_Group transform={`translate(1 3)`}>
        <path d="M1 1L4 4L1 7" stroke="currentColor" />
      </Chevron_Group>
    </svg>
  )

  const Cur_Group = styled.g`
    stroke-width: 0;
    ${CurButton}:hover & path {
      stroke: currentColor;
      stroke-width: 2;
    }
  `

  export const Cur = () => (
    <svg
      width="8"
      height="12"
      viewBox="0 0 8 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Cur_Group transform="translate(1 4)">
        <path d="M3 0L6 3L3 6L0 3L3 0Z" fill="currentColor" />
      </Cur_Group>
    </svg>
  )
}

const NextPrevKeyframeCursors: React.FC<NearbyKeyframesControls> = (props) => {
  const prevPresence = usePresence(props.prev?.itemKey)
  const curPresence = usePresence(
    props.cur?.type === 'on' ? props.cur.itemKey : undefined,
  )
  const nextPresence = usePresence(props.next?.itemKey)

  return (
    <Container>
      <PrevOrNextButton
        $available={!!props.prev}
        onClick={props.prev?.jump}
        $flag={prevPresence.flag}
        {...prevPresence.attrs}
      >
        <Icons.Prev />
      </PrevOrNextButton>
      <CurButton
        $isOn={props.cur.type === 'on'}
        onClick={props.cur.toggle}
        $presence={curPresence.flag}
        {...curPresence.attrs}
      >
        <Icons.Cur />
      </CurButton>
      <PrevOrNextButton
        $available={!!props.next}
        onClick={props.next?.jump}
        $flag={nextPresence.flag}
        {...nextPresence.attrs}
      >
        <Icons.Next />
      </PrevOrNextButton>
    </Container>
  )
}

export default NextPrevKeyframeCursors
