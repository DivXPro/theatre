/**
 * BlobCollectSink(2026-10-17,Task 13):Agent 视频导出的内存收集 sink。
 *
 * 契约:
 *  - start 后按序 write,finish 后 blob() 返回正确 MIME/大小/字节;
 *  - abort 后 blob() 抛 INVALID_STATE,后续 write 拒绝;
 *  - 重复 start 清空旧块;
 *  - 不触发浏览器下载(无 DOM 依赖,node 环境直接测)。
 */
import {AgentApiError} from '../agent/errors'
import {BlobCollectSink} from './BlobCollectSink'

const meta = {mimeType: 'video/webm', suggestedName: '镜头-test.webm'}

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

/** blob() 是同步抛错(非 Promise 拒绝),用 try/catch 断言错误码 */
function expectBlobThrows(sink: BlobCollectSink) {
  let caught: unknown
  try {
    sink.blob()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(AgentApiError)
  expect((caught as AgentApiError).code).toBe('INVALID_STATE')
}

test('start → 按序 write 两块 → finish → blob() 返回正确 MIME、大小和字节', async () => {
  const sink = new BlobCollectSink()
  await sink.start(meta)
  await sink.write(new Uint8Array([1, 2, 3]))
  await sink.write(new Uint8Array([4, 5]))
  await sink.finish()
  const blob = sink.blob()
  expect(blob.type).toBe('video/webm')
  expect(blob.size).toBe(5)
  expect(await bytesOf(blob)).toEqual([1, 2, 3, 4, 5])
  expect(sink.fileName).toBe('镜头-test.webm')
  expect(sink.mimeType).toBe('video/webm')
})

test('abort 后 blob() 抛 INVALID_STATE,后续 write 拒绝', async () => {
  const sink = new BlobCollectSink()
  await sink.start(meta)
  await sink.write(new Uint8Array([1]))
  await sink.abort()
  expectBlobThrows(sink)
  await expect(sink.write(new Uint8Array([2]))).rejects.toMatchObject({
    code: 'INVALID_STATE',
  })
})

test('重复 start 清空旧块', async () => {
  const sink = new BlobCollectSink()
  await sink.start(meta)
  await sink.write(new Uint8Array([9, 9, 9]))
  await sink.start({mimeType: 'video/mp4', suggestedName: 'second.mp4'})
  await sink.write(new Uint8Array([7]))
  await sink.finish()
  const blob = sink.blob()
  expect(blob.type).toBe('video/mp4')
  expect(blob.size).toBe(1)
  expect(await bytesOf(blob)).toEqual([7])
  expect(sink.fileName).toBe('second.mp4')
})

test('abort 后重新 start 可再次收集(恢复可用)', async () => {
  const sink = new BlobCollectSink()
  await sink.start(meta)
  await sink.abort()
  await sink.start(meta)
  await sink.write(new Uint8Array([1, 2]))
  const blob = sink.blob()
  expect(blob.size).toBe(2)
})

test('未 start 就 blob() 抛 INVALID_STATE', () => {
  expectBlobThrows(new BlobCollectSink())
})

test('available 恒 true(不依赖 File System Access 等可选能力)', () => {
  expect(new BlobCollectSink().available()).toBe(true)
})
