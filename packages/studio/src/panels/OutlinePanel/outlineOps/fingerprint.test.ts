import {fingerprintOfConfig} from './fingerprint'
import type {SheetObjectPropTypeConfig} from '@dreamerbird/core/types/public'

const pos3 = {
  type: 'compound',
  props: {
    x: {type: 'number'},
    y: {type: 'number'},
    z: {type: 'number'},
  },
} as unknown as SheetObjectPropTypeConfig['props'][string]

const cameraLike = {
  type: 'compound',
  props: {
    position: pos3,
    aimTarget: {type: 'stringLiteral', options: {}},
    fov: {type: 'number'},
  },
} as unknown as SheetObjectPropTypeConfig

describe('fingerprintOfConfig', () => {
  it('同构模板指纹相同(与键序无关)', () => {
    const reordered = {
      type: 'compound',
      props: {
        fov: {type: 'number'},
        aimTarget: {type: 'stringLiteral', options: {}},
        position: {
          type: 'compound',
          props: {
            z: {type: 'number'},
            y: {type: 'number'},
            x: {type: 'number'},
          },
        },
      },
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(cameraLike)).toBe(fingerprintOfConfig(reordered))
  })

  it('顶层键不同则指纹不同', () => {
    const other = {
      type: 'compound',
      props: {position: pos3, aimTarget: {type: 'stringLiteral', options: {}}},
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(cameraLike)).not.toBe(fingerprintOfConfig(other))
  })

  it('compound 子键不同则指纹不同', () => {
    const other = {
      type: 'compound',
      props: {
        position: {
          type: 'compound',
          props: {x: {type: 'number'}, y: {type: 'number'}},
        },
      },
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(cameraLike)).not.toBe(fingerprintOfConfig(other))
  })

  it('同名键类型不同则指纹不同', () => {
    const other = {
      type: 'compound',
      props: {fov: {type: 'boolean'}},
    } as unknown as SheetObjectPropTypeConfig
    const mine = {
      type: 'compound',
      props: {fov: {type: 'number'}},
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(mine)).not.toBe(fingerprintOfConfig(other))
  })

  it('指纹只取结构:默认值/选项变化不影响指纹', () => {
    const a = {
      type: 'compound',
      props: {fov: {type: 'number', default: 50}},
    } as unknown as SheetObjectPropTypeConfig
    const b = {
      type: 'compound',
      props: {fov: {type: 'number', default: 90}},
    } as unknown as SheetObjectPropTypeConfig
    expect(fingerprintOfConfig(a)).toBe(fingerprintOfConfig(b))
  })
})
