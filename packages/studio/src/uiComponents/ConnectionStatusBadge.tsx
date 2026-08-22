import React from 'react'
import styled from 'styled-components'

const Badge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: #fff;
  background: rgba(120, 120, 120, 0.35);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
`

export default function ConnectionStatusBadge({
  status,
}: {
  status: 'connected' | 'reconnecting'
}) {
  if (status === 'connected') return null
  return (
    <Badge data-testid="connection-status-badge">
      <span aria-hidden>⚠</span> Reconnecting…
    </Badge>
  )
}
