import {setupTestSheet} from './testUtils'

test('adding the first property key snapshots the value and undo removes the new track', async () => {
  const {togglePropertyKeyframe} = await import(
    '../propEditors/propertyKeyframes'
  )
  const {obj, objPublicAPI, studio} = await setupTestSheet({
    staticOverrides: {byObject: {}},
  })
  const property = objPublicAPI.props.position.x
  const sequence = objPublicAPI.sheet.sequence
  studio.transaction(({set}) => set(property, 7))
  sequence.position = 1
  togglePropertyKeyframe(obj, property)

  expect(sequence.getKeyframes(property)).toMatchObject([
    {position: 1, value: 7},
  ])
  studio.undo()
  expect(sequence.getKeyframes(property)).toEqual([])
  expect(objPublicAPI.value.position.x).toBe(7)
  studio.transaction(({set}) => set(property, 9))
  expect(sequence.getKeyframes(property)).toEqual([])
})

test('the diamond adds and removes only the key at the current frame', async () => {
  const {togglePropertyKeyframe} = await import(
    '../propEditors/propertyKeyframes'
  )
  const {obj, objPublicAPI} = await setupTestSheet({
    staticOverrides: {byObject: {}},
  })
  const property = objPublicAPI.props.position.y
  const sequence = objPublicAPI.sheet.sequence
  sequence.position = 1
  togglePropertyKeyframe(obj, property)
  sequence.position = 3
  togglePropertyKeyframe(obj, property)
  togglePropertyKeyframe(obj, property)

  expect(sequence.getKeyframes(property)).toMatchObject([
    {position: 1, value: 0},
  ])
})
