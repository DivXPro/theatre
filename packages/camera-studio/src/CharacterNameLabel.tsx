import React from 'react'
import {Html} from '@react-three/drei'
import {suggestBoneMap} from '@dreamerbird/threeik'
import {Vector3, type Object3D} from 'three'
import styled from 'styled-components'
import {collectBoneNames} from './assetLibrary/rig'
import {normalizeBoneName} from './boneAnchors'

export type CharacterNameStyle = 'original' | 'manga'

export function findCharacterNameAnchor(instance: Object3D) {
  const {map} = suggestBoneMap(collectBoneNames(instance))
  const headName = map.findModelBone('Head')
  const head = headName ? instance.getObjectByName(headName) : undefined
  if (!head) return null

  const crown = head.children.find(({name}) => {
    const normalized = normalizeBoneName(name)
    return normalized === 'headtop' || normalized === 'headtopend'
  })
  const neckName = map.findModelBone('Neck')
  const neck = neckName ? instance.getObjectByName(neckName) : undefined
  return {head, crown, neck}
}

const Name = styled.span`
  display: block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font:
    600 12px / 1.25 system-ui,
    sans-serif;
  color: #fff;
  text-shadow: 0 1px 3px rgb(0 0 0 / 65%);

  &[data-character-name='manga'] {
    color: #202020;
    text-shadow: none;
  }
`

const headPosition = new Vector3()
const neckPosition = new Vector3()

export function CharacterNameLabel({
  name,
  anchor,
  appearance,
  posing,
}: {
  name: string
  anchor: NonNullable<ReturnType<typeof findCharacterNameAnchor>>
  appearance: CharacterNameStyle
  posing: boolean
}) {
  return (
    <Html
      zIndexRange={[4, 1]}
      calculatePosition={(label, camera, {width, height}) => {
        const {head, crown, neck} = anchor
        const origin = crown ?? head
        origin.getWorldPosition(headPosition)
        if (!crown) {
          // Rigs without a head tip use the neck-to-head distance, in scene units.
          headPosition.y += neck
            ? headPosition.distanceTo(neck.getWorldPosition(neckPosition)) * 1.5
            : 0.15
        }
        // Keep Drei's camera visibility check on the same anchor it projects.
        label.position.copy(headPosition)
        label.parent?.worldToLocal(label.position)
        label.updateMatrixWorld()

        headPosition.project(camera)
        return [
          ((headPosition.x + 1) * width) / 2,
          ((1 - headPosition.y) * height) / 2,
        ]
      }}
      style={{
        pointerEvents: 'none',
        transform: `translate(-50%, calc(-100% - ${posing ? 34 : 7}px))`,
      }}
    >
      <Name data-character-name={appearance}>{name}</Name>
    </Html>
  )
}
