/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import {setLanguage} from '@dreamerbird/studio/i18n'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {ActionEditor} from './ActionEditor'
import {createActionEditorSession, type ActionEditorOptions} from './session'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

function mount(
  overrides: Partial<ActionEditorOptions> = {},
  onRequestBoneGizmo?: () => void,
) {
  setLanguage('en')
  const onApply = jest.fn()
  const onClose = jest.fn()
  const session = createActionEditorSession({
    strip: {
      id: 'object',
      startMs: 2000,
      sourceInMs: 0,
      sourceOutMs: 1000,
      repeat: 3,
    },
    name: 'Turn',
    durationMs: 1000,
    sceneTimeMs: 3250,
    referenceCount: 2,
    channels: [
      {
        kind: 'position',
        keys: [{id: 'start', timeMs: 0, value: {x: 0, y: 0, z: 0}}],
      },
      {
        kind: 'quaternion',
        keys: [{id: 'start', timeMs: 0, value: {x: 0, y: 0, z: 0, w: 1}}],
      },
    ],
    sample: () => ({object: {}, bones: {}}),
    onApply,
    onClose,
    ...overrides,
  })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  act(() =>
    root.render(
      <ActionEditor
        session={session}
        onRequestBoneGizmo={onRequestBoneGizmo}
      />,
    ),
  )
  const button = (label: string) =>
    [...element.querySelectorAll('button')].find(
      (item) => (item.getAttribute('aria-label') ?? item.textContent) === label,
    )!
  const field = (label: string) =>
    element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  return {
    element,
    button,
    field,
    onApply,
    onClose,
    session,
    dispose() {
      act(() => root.unmount())
      element.remove()
    },
  }
}

function change(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
    input.dispatchEvent(new Event('change', {bubbles: true}))
  })
}

it('edits XYZ and Euler inputs, records one frame, and applies to the current strip', () => {
  const view = mount()
  try {
    expect(view.element.textContent).toContain('Loop 2 / 3')
    expect(view.field('Local time (s)').value).toBe('0.25')
    change(view.field('Position X'), '8')
    change(view.field('Rotation (rad) Z'), String(Math.PI / 2))
    act(() => view.button('Add Rotation (rad) keyframe').click())
    expect(
      view
        .button('Rotation (rad) keyframe at 0.25 s')
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(view.button('Apply and return').disabled).toBe(true)
    act(() => view.button('Restore sampled values').click())
    act(() => view.button('Apply and return').click())
    const commit = view.onApply.mock.calls[0][0]
    expect(commit.scope).toBe('strip')
    expect(commit.channels[0].keys).toHaveLength(1)
    expect(commit.channels[1].keys[1].value.z).toBeCloseTo(Math.SQRT1_2)
    expect(view.onClose).toHaveBeenCalledWith('applied')
    expect(view.session.getSnapshot().entry.sceneTimeMs).toBe(3250)
  } finally {
    view.dispose()
  }
})

it('navigates by local frames and shows source bone keys before any edits', () => {
  const transform = {
    position: {x: 0, y: 0, z: 0},
    quaternion: {x: 0, y: 0, z: 0, w: 1},
    scale: {x: 1, y: 1, z: 1},
  }
  const view = mount({
    framesPerSecond: 24,
    channels: [],
    boneNames: ['Hand'],
    sample: () => ({object: {}, bones: {Hand: transform}}),
    seedBoneKeys: () =>
      [0, 250, 500].map((timeMs) => ({timeMs, value: transform})),
  })
  try {
    expect(view.field('Local frame').value).toBe('6')
    act(() => view.button('Next frame').click())
    expect(view.field('Local frame').value).toBe('7')
    act(() => view.session.selectBone('Hand'))
    expect(view.session.getSnapshot().isDirty).toBe(false)
    act(() => view.button('Hand keyframe at frame 6').click())
    expect(view.field('Local frame').value).toBe('6')
    expect(view.button('Update Hand keyframe')).toBeDefined()
    change(view.field('Keyframe frame'), '8')
    act(() => view.button('Move keyframe').click())
    expect(view.field('Local frame').value).toBe('8')
    act(() => view.button('Delete keyframe').click())
    act(() => view.button('Apply and return').click())
    expect(
      view.onApply.mock.calls[0][0].channels[0].keys.map(
        (key: {timeMs: number}) => key.timeMs,
      ),
    ).toEqual([0, 500])
  } finally {
    view.dispose()
  }
})

it('selects and moves timeline keys and requests confirmation before discarding edits', () => {
  const view = mount()
  try {
    act(() => view.button('Add Position keyframe').click())
    act(() => view.button('Position keyframe at 0 s').click())
    expect(view.field('Local time (s)').value).toBe('0')
    change(view.field('Keyframe time (s)'), '0.5')
    act(() => view.button('Move keyframe').click())
    expect(view.field('Local time (s)').value).toBe('0.5')
    act(() => view.button('Delete keyframe').click())
    expect(view.button('Position keyframe at 0.5 s')).toBeUndefined()
    act(() => view.button('Cancel').click())
    expect(view.onClose).not.toHaveBeenCalled()
    act(() => view.button('Discard edits').click())
    expect(view.onApply).not.toHaveBeenCalled()
    expect(view.onClose).toHaveBeenCalledWith('cancelled')
  } finally {
    view.dispose()
  }
})

it('opens viewport posing before selecting a bone and keeps bone details collapsed', () => {
  const request = jest.fn()
  const value = {
    position: {x: 0, y: 0, z: 0},
    quaternion: {x: 0, y: 0, z: 0, w: 1},
    scale: {x: 1, y: 1, z: 1},
  }
  const view = mount(
    {
      channels: [],
      boneNames: ['Hand'],
      referenceCount: 1,
      sourcePoseKeyTimes: [0, 250],
      sample: () => ({object: {}, bones: {Hand: value}}),
    },
    request,
  )
  try {
    expect(view.element.querySelector('select')).toBeNull()
    expect(view.button('Pose keyframe at 0.25 s')).toBeDefined()
    act(() => view.button('Edit in viewport').click())
    expect(request).toHaveBeenCalledWith()
    act(() => view.button('Bone details').click())
    expect(view.element.querySelector('select')).not.toBeNull()
    act(() => view.session.selectBone('Hand'))
    const preview = {...value, position: {...value.position, x: 2}}
    act(() => view.session.setBonePreview('Hand', preview))
    expect(view.session.getSnapshot().channels).toHaveLength(0)
    act(() => view.button('Add Hand keyframe').click())
    act(() => view.button('Apply and return').click())
    expect(view.onApply.mock.calls[0][0].channels).toEqual([
      {
        kind: 'bone',
        boneName: 'Hand',
        keys: [{id: expect.any(String), timeMs: 250, value: preview}],
      },
    ])
  } finally {
    view.dispose()
  }
})
