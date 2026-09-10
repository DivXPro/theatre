import {useVal} from '@dreamerbird/react'
import getStudio from '@dreamerbird/studio/getStudio'
import React from 'react'
import styled from 'styled-components'

/**
 * Shown when persistence (IndexedDB) is unavailable and the studio degrades to
 * in-memory-only editing: nothing will be saved. Mirrors StateConflictRow's
 * red-accent styling.
 */
const Container = styled.div`
  padding: 8px 10px;
  position: relative;
  background-color: #6d232352;
  &:before {
    position: absolute;
    content: ' ';
    display: block;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background-color: #ff000070;
  }
`

export const PersistenceStatusBanner: React.FC = () => {
  const status = useVal(getStudio().ephemeralAtom.pointer.persistenceStatus)
  if (status !== 'degraded') return null
  return (
    <Container data-testid="persistence-banner">
      This session's state won't be saved.
    </Container>
  )
}
