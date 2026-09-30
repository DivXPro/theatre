import type {Atom, Pointer} from '@dreamerbird/dataverse'

export const collapsedMap = new WeakMap<Pointer<{}>, Atom<boolean>>()
