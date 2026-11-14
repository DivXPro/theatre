/**
 * 最小 H.264 MP4 muxer(2026-11-14,Previs Capture)。
 *
 * 输入是 WebCodecs VideoEncoder 产出的 H.264 AVCC 样本(长度前缀 NAL),
 * 输出单轨、无音频的普通 MP4。布局固定为 ftyp + mdat + moov:
 * mdat 在前使 stco 偏移无需为 moov 自身大小做二次回填,播放器与浏览器
 * <video> 均可直接读取(包括 moov 在文件尾的常见场景)。
 *
 * 这是浏览器 bundle 内的纯 TS 实现,不依赖 Buffer / Node-only 包。
 */
import {AgentApiError} from '../agent/errors'

export type Mp4Sample = {
  data: Uint8Array
  timestampUs: number
  durationUs: number
  isKey: boolean
}

export type Mp4MuxInput = {
  width: number
  height: number
  fps: number
  samples: readonly Mp4Sample[]
  /** VideoEncoder output 的 decoderConfig.description(AVCDecoderConfigurationRecord) */
  avcC: Uint8Array
}

const MOVIE_TIMESCALE = 1000
const MEDIA_TIMESCALE = 90_000
const EMPTY = new Uint8Array(0)

function u8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff])
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff])
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function i32(value: number): Uint8Array {
  return u32(value >>> 0)
}

function zeros(length: number): Uint8Array {
  return new Uint8Array(length)
}

function ascii(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const payload = concat(parts)
  const size = 8 + payload.length
  if (size > 0xffffffff) {
    throw new AgentApiError('INTERNAL_ERROR', 'MP4 box 超过 4GB 上限')
  }
  return concat([u32(size), ascii(type), payload])
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  ...parts: Uint8Array[]
): Uint8Array {
  return box(
    type,
    u8(version),
    u8((flags >>> 16) & 0xff),
    u8((flags >>> 8) & 0xff),
    u8(flags & 0xff),
    ...parts,
  )
}

function matrixIdentity(): Uint8Array {
  return concat([
    u32(0x00010000),
    zeros(4),
    zeros(4),
    zeros(4),
    u32(0x00010000),
    zeros(4),
    zeros(4),
    zeros(4),
    u32(0x40000000),
  ])
}

function durationTicks(samples: readonly Mp4Sample[]): number {
  if (samples.length === 0) return 0
  const last = samples[samples.length - 1]!
  const durationUs = Math.max(
    1,
    last.timestampUs + last.durationUs - samples[0]!.timestampUs,
  )
  return Math.max(1, Math.round((durationUs * MEDIA_TIMESCALE) / 1_000_000))
}

function normalizeAvcC(description: Uint8Array): Uint8Array {
  if (
    description.length >= 8 &&
    String.fromCharCode(
      description[4]!,
      description[5]!,
      description[6]!,
      description[7]!,
    ) === 'avcC'
  ) {
    return description.slice(8)
  }
  return description
}

function makeAvc1(width: number, height: number, avcC: Uint8Array): Uint8Array {
  const compressorName = new Uint8Array(32)
  compressorName[0] = 0 // 空 C 字符串
  return box(
    'avc1',
    zeros(6),
    u16(1), // data_reference_index
    u16(0), // pre_defined
    u16(0), // reserved
    zeros(12),
    u16(width),
    u16(height),
    u32(0x00480000), // 72 dpi
    u32(0x00480000),
    zeros(4),
    u16(1), // frame_count
    compressorName,
    u16(0x0018), // depth
    u16(0xffff), // pre_defined = -1
    box('avcC', avcC),
  )
}

function makeStts(samples: readonly Mp4Sample[]): Uint8Array {
  // 同 fps 下样本时长恒定;最后一帧仍按 1/fps 计,保证总时长可预期。
  const delta = Math.max(
    1,
    Math.round((samples[0]!.durationUs * MEDIA_TIMESCALE) / 1_000_000),
  )
  return fullBox('stts', 0, 0, u32(1), u32(samples.length), u32(delta))
}

function makeStss(samples: readonly Mp4Sample[]): Uint8Array {
  const keyframes: number[] = []
  samples.forEach((sample, index) => {
    if (sample.isKey) keyframes.push(index + 1)
  })
  return fullBox(
    'stss',
    0,
    0,
    u32(keyframes.length),
    ...keyframes.map((n) => u32(n)),
  )
}

function makeMoov(input: Mp4MuxInput, mdatOffset: number): Uint8Array {
  const durationMs = Math.max(
    1,
    Math.round(
      ((input.samples[input.samples.length - 1]!.timestampUs +
        input.samples[input.samples.length - 1]!.durationUs) *
        MOVIE_TIMESCALE) /
        1_000_000,
    ),
  )
  const mediaDuration = durationTicks(input.samples)
  const avcC = normalizeAvcC(input.avcC)
  if (avcC.length < 7) {
    throw new AgentApiError(
      'INTERNAL_ERROR',
      'H.264 编码器未提供有效的 avcC decoder description',
    )
  }

  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    u32(0),
    u32(0),
    u32(MOVIE_TIMESCALE),
    u32(durationMs),
    u32(0x00010000),
    u16(0x0100),
    zeros(10),
    matrixIdentity(),
    zeros(24),
    u32(2),
  )

  const tkhd = fullBox(
    'tkhd',
    0,
    0x000007,
    u32(0),
    u32(0),
    u32(1),
    zeros(4),
    u32(durationMs),
    zeros(8),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    matrixIdentity(),
    u32(input.width << 16),
    u32(input.height << 16),
  )

  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    u32(0),
    u32(0),
    u32(MEDIA_TIMESCALE),
    u32(mediaDuration),
    u16(0x55c4), // und
    u16(0),
  )
  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    u32(0),
    ascii('vide'),
    zeros(12),
    ascii('VideoHandler\0'),
  )
  const vmhd = fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0))
  const url = fullBox('url ', 0, 1)
  const dref = fullBox('dref', 0, 0, u32(1), url)
  const dinf = box('dinf', dref)
  const stsd = fullBox(
    'stsd',
    0,
    0,
    u32(1),
    makeAvc1(input.width, input.height, avcC),
  )
  const stts = makeStts(input.samples)
  const stss = makeStss(input.samples)
  const stsc = fullBox(
    'stsc',
    0,
    0,
    u32(1),
    u32(1),
    u32(input.samples.length),
    u32(1),
  )
  const stsz = fullBox(
    'stsz',
    0,
    0,
    u32(0),
    u32(input.samples.length),
    ...input.samples.map((sample) => u32(sample.data.length)),
  )
  const stco = fullBox('stco', 0, 0, u32(1), u32(mdatOffset))
  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco)
  const minf = box('minf', vmhd, dinf, stbl)
  const mdia = box('mdia', mdhd, hdlr, minf)
  const trak = box('trak', tkhd, mdia)
  return box('moov', mvhd, trak)
}

/** 将编码器样本封装成普通 MP4 字节流 */
export function muxH264Mp4(input: Mp4MuxInput): Uint8Array {
  if (input.samples.length === 0) {
    throw new AgentApiError('INTERNAL_ERROR', '没有可封装的视频帧')
  }
  const ftyp = box(
    'ftyp',
    ascii('isom'),
    u32(0x00000200),
    ascii('isomiso2avc1mp41'),
  )
  const sampleBytes = concat(input.samples.map((sample) => sample.data))
  const mdat = box('mdat', sampleBytes)
  const mdatPayloadOffset = ftyp.length + 8
  const moov = makeMoov(input, mdatPayloadOffset)
  return concat([ftyp, mdat, moov])
}
