import type {Atom, Pointer} from '@toy-box/dataverse'

export const collapsedMap = new WeakMap<Pointer<{}>, Atom<boolean>>()
