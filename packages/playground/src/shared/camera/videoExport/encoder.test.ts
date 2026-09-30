import {extForMime, pickMimeType} from './encoder'

describe('pickMimeType', () => {
  it('优先选 vp9 的 webm', () => {
    expect(pickMimeType(() => true)).toBe('video/webm;codecs=vp9')
  })

  it('按候选顺序回退', () => {
    expect(pickMimeType((t) => t === 'video/webm')).toBe('video/webm')
    expect(pickMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
  })

  it('全不支持返回 undefined', () => {
    expect(pickMimeType(() => false)).toBeUndefined()
  })
})

describe('extForMime', () => {
  it('mp4 容器给 mp4 扩展名', () => {
    expect(extForMime('video/mp4')).toBe('mp4')
  })

  it('其余(webm)给 webm 扩展名', () => {
    expect(extForMime('video/webm;codecs=vp9')).toBe('webm')
  })
})
