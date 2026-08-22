import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ConnectionStatusBadge from './ConnectionStatusBadge'

describe('ConnectionStatusBadge', () => {
  test('renders nothing when connected', () => {
    expect(
      renderToStaticMarkup(
        React.createElement(ConnectionStatusBadge, {status: 'connected'}),
      ),
    ).toBe('')
  })
  test('renders a reconnecting badge when reconnecting', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionStatusBadge, {status: 'reconnecting'}),
    )
    expect(html).toContain('Reconnecting')
    expect(html).toContain('data-testid="connection-status-badge"')
  })
})
