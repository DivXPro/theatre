import type {SheetObjectAddress} from '@dreamerbird/core/types/public'
import {Atom} from '@dreamerbird/dataverse'
import type {AnimationStrip} from './model'

export type AnimationStripSelection = {
  objectAddressKey: string
  stripId: string
}

export const animationStripSelectionB =
  new Atom<AnimationStripSelection | null>(null)

export function animationObjectAddressKey(address: SheetObjectAddress): string {
  return [
    address.projectId,
    address.sheetId,
    address.sheetInstanceId,
    address.objectKey,
  ].join('\u0000')
}

export function selectAnimationStrip(
  address: SheetObjectAddress,
  stripId: string,
): void {
  animationStripSelectionB.set({
    objectAddressKey: animationObjectAddressKey(address),
    stripId,
  })
}

export function clearAnimationStripSelection(): void {
  animationStripSelectionB.set(null)
}

const actionOpeners = new Map<string, (strip: AnimationStrip) => void>()

export function registerAnimationStripActionOpener(
  objectAddressKey: string,
  opener: (strip: AnimationStrip) => void,
): () => void {
  actionOpeners.set(objectAddressKey, opener)
  return () => {
    if (actionOpeners.get(objectAddressKey) === opener) {
      actionOpeners.delete(objectAddressKey)
    }
  }
}

export function openAnimationStripAction(
  objectAddressKey: string,
  strip: AnimationStrip,
): void {
  actionOpeners.get(objectAddressKey)?.(strip)
}
