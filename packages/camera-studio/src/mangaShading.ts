import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
} from 'three'

export const mangaShadingPresets = {
  off: [0, 0, 0, 0, 0, 0],
  light: [0, 0, 1, 1, 2, 2],
  medium: [1, 1, 2, 2, 3, 3],
  dark: [2, 2, 3, 3, 4, 4],
  heavy: [3, 3, 4, 4, 5, 5],
  layered: [0, 0, 1, 2, 3, 4],
} as const

export type MangaShadingPreset = keyof typeof mangaShadingPresets

const dotRadii = [0, 0.14, 0.19, 0.24, 0.29, 0.34]
export const mangaPaperDotsPerHeight = 6 * 64

export function createMangaPaperTexture() {
  const size = 64
  const area = size * size
  const paper = new Uint8Array(area * dotRadii.length)
  paper.fill(255, 0, area)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const distance = Math.hypot(col + 0.5 - size / 2, row + 0.5 - size / 2)
      for (let layer = 1; layer < dotRadii.length; layer++) {
        const coverage = Math.min(
          1,
          Math.max(0, dotRadii[layer] * size - distance + 0.5),
        )
        paper[layer * area + row * size + col] = Math.round(
          255 * (1 - coverage),
        )
      }
    }
  }

  const texture = new DataArrayTexture(paper, size, size, dotRadii.length)
  texture.name = 'Manga halftone paper'
  texture.format = RedFormat
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
