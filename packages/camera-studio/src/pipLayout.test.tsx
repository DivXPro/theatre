/** @jest-environment jsdom */

import React, {act, useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {usePreviewLayout} from './pipLayout'

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  }
}

test('positions the navigation gizmo below a short inspector in a narrow viewport', () => {
  const host = document.createElement('div')
  host.id = 'theatrejs-studio-root'
  const shadow = host.attachShadow({mode: 'open'})
  const outline = document.createElement('div')
  outline.className = 'cs-studio-outline'
  outline.getBoundingClientRect = () => rect(12, 64, 146, 430)
  const inspector = document.createElement('div')
  inspector.dataset.testid = 'DetailPanel-Object'
  inspector.getBoundingClientRect = () => rect(202, 64, 306, 120)
  shadow.append(outline, inspector)

  const container = document.createElement('div')
  document.body.append(host, container)
  const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT
  const previousResizeObserver = globalThis.ResizeObserver
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class {
    constructor(_: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  function Probe() {
    const scene = useRef<HTMLDivElement>(null)
    const {gizmo} = usePreviewLayout(scene)
    return (
      <div
        ref={(element) => {
          scene.current = element
          if (element) {
            element.getBoundingClientRect = () => rect(0, 0, 520, 560)
          }
        }}
        data-gizmo-right={gizmo?.right}
        data-gizmo-top={gizmo?.top}
      />
    )
  }

  const root = createRoot(container)
  try {
    act(() => root.render(<Probe />))
    expect(container.firstElementChild?.getAttribute('data-gizmo-right')).toBe(
      '64',
    )
    expect(container.firstElementChild?.getAttribute('data-gizmo-top')).toBe(
      '248',
    )
  } finally {
    act(() => root.unmount())
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    globalThis.ResizeObserver = previousResizeObserver
    container.remove()
    host.remove()
  }
})
