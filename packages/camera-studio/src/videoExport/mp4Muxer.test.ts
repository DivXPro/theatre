import {muxH264Mp4} from './mp4Muxer'

function text(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function boxAt(bytes: Uint8Array, start: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    size: view.getUint32(start),
    type: text(bytes, start + 4, 4),
  }
}

function findBox(bytes: Uint8Array, type: string): number {
  for (let i = 0; i + 8 <= bytes.length; i++) {
    if (text(bytes, i + 4, 4) === type) return i
  }
  throw new Error(`box not found: ${type}`)
}

describe('muxH264Mp4', () => {
  test('输出 ftyp + mdat + moov,stco 指向样本数据', () => {
    const samples = [
      {
        data: new Uint8Array([0, 0, 0, 1, 0x65, 1, 2, 3]),
        timestampUs: 0,
        durationUs: 33_333,
        isKey: true,
      },
      {
        data: new Uint8Array([0, 0, 0, 1, 0x41, 4, 5]),
        timestampUs: 33_333,
        durationUs: 33_333,
        isKey: false,
      },
    ]
    const mp4 = muxH264Mp4({
      width: 320,
      height: 180,
      fps: 30,
      samples,
      // AVCDecoderConfigurationRecord 最小形状(profile/compat/level + lenSize + SPS/PPS 长度)
      avcC: new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0, 0, 1, 0, 0]),
    })

    expect(text(mp4, 4, 4)).toBe('ftyp')
    expect(text(mp4, 8, 4)).toBe('isom')
    expect(text(mp4, 16, 4)).toBe('isom')

    const mdat = findBox(mp4, 'mdat')
    expect(boxAt(mp4, mdat).type).toBe('mdat')
    const sampleStart = mdat + 8
    expect([
      ...mp4.subarray(sampleStart, sampleStart + samples[0]!.data.length),
    ]).toEqual([...samples[0]!.data])
    const secondStart = sampleStart + samples[0]!.data.length
    expect([
      ...mp4.subarray(secondStart, secondStart + samples[1]!.data.length),
    ]).toEqual([...samples[1]!.data])

    const stco = findBox(mp4, 'stco')
    const view = new DataView(mp4.buffer, mp4.byteOffset, mp4.byteLength)
    expect(view.getUint32(stco)).toBe(20)
    expect(view.getUint32(stco + 12)).toBe(1)
    expect(view.getUint32(stco + 16)).toBe(sampleStart)

    const moov = findBox(mp4, 'moov')
    expect(boxAt(mp4, moov).type).toBe('moov')
    expect(moov).toBeGreaterThan(mdat)
  })

  test('无样本直接拒绝', () => {
    expect(() =>
      muxH264Mp4({
        width: 10,
        height: 10,
        fps: 30,
        samples: [],
        avcC: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
      }),
    ).toThrow(/没有可封装/)
  })
})
