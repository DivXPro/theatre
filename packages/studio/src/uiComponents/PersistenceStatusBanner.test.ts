/* eslint-disable no-restricted-syntax */
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Atom} from '@dreamerbird/dataverse'
import type {$IntentionalAny} from '@dreamerbird/utils/types'
import {setStudio} from '@dreamerbird/studio/getStudio'
import {PersistenceStatusBanner} from './PersistenceStatusBanner'

const makeStudio = (persistenceStatus: 'ok' | 'degraded') => ({
  ephemeralAtom: new Atom({persistenceStatus}),
})

test('shows the banner when persistence is degraded', () => {
  setStudio(makeStudio('degraded') as $IntentionalAny)
  const html = renderToStaticMarkup(
    React.createElement(PersistenceStatusBanner),
  )
  expect(html).toContain('data-testid="persistence-banner"')
})

test('renders nothing when persistence is ok', () => {
  setStudio(makeStudio('ok') as $IntentionalAny)
  const html = renderToStaticMarkup(
    React.createElement(PersistenceStatusBanner),
  )
  expect(html).toBe('')
})
