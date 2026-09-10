/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-restricted-syntax */
/**
 * Save-file format compatibility regression (spec layer 1).
 *
 * `__fixtures__/0.7/representative.json` was generated through the real
 * serialization path (import via `getProject(id, {state})`, export via
 * `studio.createContentOfSaveFile`), so it is guaranteed to match the shape the
 * current build actually writes. `definitionVersion` has been `'0.4.0'` since
 * 0.7, so a 0.7 save file is isomorphic with the current on-disk format — these
 * tests pin the ability to open one, validate it, and reject future versions.
 *
 * The `createContentOfSaveFile` round-trip is covered in
 * `packages/studio/src/integration-tests/createContentOfSaveFile.test.ts`
 * (where that studio-only API lives), using the same committed fixture.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {getProject, val} from '@dreamerbird/core'
import * as t from '@dreamerbird/core/propTypes'
import {shallowValidateOnDiskState} from '@dreamerbird/core/projects/Project'
import {InvalidArgumentError} from '@dreamerbird/utils/errors'
import type {OnDiskState, ProjectId} from '@dreamerbird/core/types/public'

const representative = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__/0.7/representative.json'),
    'utf8',
  ),
) as unknown as OnDiskState

// Prop TYPES come from the caller (`sheet.object(key, config)`); the state
// carries only values + keyframes. This config mirrors the fixture's shapes.
const objProps = {
  position: {x: 0, y: 0, z: 0},
  color: t.rgba(),
  label: t.stringLiteral('r', {r: 'Red', g: 'Green'}),
  asset: t.file('model.glb'),
  deeply: {nested: {checkbox: false}},
}

const boxProps = {
  opacity: 1,
  scale: 1,
}

it('0.7 fixture imports via getProject(id, {state})', async () => {
  const project = getProject('0.7-fixture-import', {state: representative})
  await project.ready

  // SheetA: compound props, static file/stringLiteral/rgba/nested values
  const sheetA = project.sheet('SheetA')
  const obj = sheetA.object('obj', objProps)
  expect(val(obj.props.position.x)).toBe(1)
  expect(val(obj.props.position.z)).toBe(2)
  expect(val(obj.props.label)).toBe('r')
  expect(val(obj.props.asset)).toEqual({type: 'file', id: 'model.glb'})
  expect(val(obj.props.deeply.nested.checkbox)).toBe(true)

  // keyframed prop with mixed easings (bezier/bezier/hold) survives the import
  const keyframes = sheetA.sequence.getKeyframes(obj.props.position.y)
  expect(keyframes).toHaveLength(3)
  expect(keyframes.map((k) => k.value)).toEqual([0, 5, 5])

  // SheetB: scalar keyframed + static props
  const sheetB = project.sheet('SheetB')
  const box = sheetB.object('box', boxProps)
  expect(val(box.props.scale)).toBe(3)
  expect(sheetB.sequence.getKeyframes(box.props.opacity)).toHaveLength(2)
})

it('fixture passes shallowValidateOnDiskState', () => {
  expect(() =>
    shallowValidateOnDiskState(
      '0.7-fixture-validate' as ProjectId,
      representative,
    ),
  ).not.toThrow()
})

it('future-version state is rejected', () => {
  const tampered = {...representative, definitionVersion: '999.0.0'}
  expect(() => getProject('0.7-fixture-future', {state: tampered})).toThrow(
    InvalidArgumentError,
  )
})
