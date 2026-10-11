// packages/playground/src/shared/camera/poseMode/dragState.test.ts
import {anyControlDragging} from './dragState'

const target = (dragging: boolean) => ({isDragging: dragging})
const ctl = (targets: unknown, handles: Record<string, unknown> = {}) =>
  ({
    targets: targets as Array<{isDragging: boolean}>,
    get: (name: string) => handles[name],
  }) as Parameters<typeof anyControlDragging>[0]

const NAMES = ['hips', 'armL', 'spine', 'chest']

test('无拖动 → false(空 targets、句柄缺面、未知名都不误报)', () => {
  expect(anyControlDragging(ctl([]), NAMES)).toBe(false)
  expect(
    anyControlDragging(
      ctl([target(false), target(false)], {
        armL: {pole: {isDragging: false}, elbowRings: {isDragging: false}},
      }),
      NAMES,
    ),
  ).toBe(false)
  expect(anyControlDragging(ctl([target(false)]), ['nope'])).toBe(false)
})

test('任一 target 拖动 → true', () => {
  expect(anyControlDragging(ctl([target(false), target(true)]), NAMES)).toBe(
    true,
  )
})

test('pole/elbowRings/rings/shoulderRings 任一拖动 → true', () => {
  for (const surface of ['pole', 'elbowRings', 'rings', 'shoulderRings']) {
    expect(
      anyControlDragging(
        ctl([target(false)], {armL: {[surface]: {isDragging: true}}}),
        NAMES,
      ),
    ).toBe(true)
  }
})
