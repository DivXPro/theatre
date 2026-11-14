# @dreamerbird/camera-studio

3D 舞台编辑与 Previs Capture 导出。本文档说明 `0.5.0` 起的静帧 / 视频
导出 API 与平台能力边界。

## Previs Capture

两条导出命令都走同一个离线渲染核心:

```ts
import type {
  CameraStudioApi,
  StillExportResult,
  VideoExportResult,
} from '@dreamerbird/camera-studio'

const api: CameraStudioApi = window.__cameraStudioApi

// 白模静帧:指定相机、时间点、精确 1920x1080
const {jobId} = await api.exports.captureStill({
  cameraId: 'camera:main',
  renderMode: 'clay',
  output: {width: 1920, height: 1080},
  timeMs: 2500,
})

let snapshot = await api.jobs.get({jobId})
while (snapshot.state === 'running' || snapshot.state === 'pending') {
  await new Promise((resolve) => setTimeout(resolve, 250))
  snapshot = await api.jobs.get({jobId})
}
if (snapshot.state !== 'succeeded') throw snapshot.error

const still = snapshot.result as StillExportResult
// still.blob / fileName / width / height / timeMs / renderMode
```

```ts
// 确定性白模动画:0–4s、24fps、720p H.264 MP4
const {jobId} = await api.exports.startVideo({
  cameraId: 'camera:main',
  renderMode: 'clay',
  aspectRatio: '16:9',
  range: {startMs: 0, endMs: 4000},
  fps: 24,
})

const result = (await waitForJob(jobId)) as VideoExportResult
// waitForJob:调用方对 jobs.get 的轮询封装(状态离开 running/pending 即返回)
// result.mimeType === 'video/mp4' (WebCodecs 主路径)
// result.encoding === 'webcodecs' | 'mediarecorder'
// result.width / height / fps / durationMs / codec / range
```

### 参数

共享参数:

| 参数 | 说明 |
| --- | --- |
| `cameraId` | `camera:<key>`;缺省当前活动相机。无活动相机 → `INVALID_STATE` |
| `renderMode` | `styled`(默认)或 `clay`(临时白模材质覆盖) |
| `output` | 精确像素尺寸;缺省当前 canvas drawing buffer 尺寸 |
| `aspectRatio` | `16:9` / `9:16` / `1:1` / `4:3` / `3:4`;与 `output` 同时给出时 `output` 优先 |
| `clayColor` | 白模颜色,默认 `#D8D8D8` |
| `background` | `scene`(默认 styled)/ `neutral`(默认 clay)/ `transparent`(仅静帧) |

`captureStill` 额外参数:

- `timeMs`:毫秒;缺省当前播放头;自动 clamp 到 `[0, sequence.length * 1000]`,不抛错。

`startVideo` 额外参数:

- `range`:缺省完整 sequence;要求 `0 <= startMs < endMs <= length * 1000`。
- `fps`:整数 `1..60`,默认 `30`。

同一场景同一时间只允许一个导出任务;并发请求返回 `INVALID_STATE`。

### 渲染语义

- 输出走独立 `WebGLRenderTarget`,不读取 DOM canvas;像素尺寸精确等于请求值。
- 导出期临时将相机 aspect 改为 `width / height`,关闭 R3F 自动帧循环并手动
  `advance()`;逐帧设置 sequence 位置,不依赖实时播放速度。
- 编辑器辅助对象(地面网格、相机视锥、路径线、瞄准点、gizmo 等)在导出期
  统一隐藏,结束后恢复。
- `clay` 使用 `scene.overrideMaterial` 的中性灰 `MeshStandardMaterial`
  (`metalness: 0`、`roughness: 1`、无贴图 / 顶点色 / 环境反射、opaque、
  `depthWrite: true`、`DoubleSide`),蒙皮与实例化网格同样覆盖。
- 场景没有任何灯光时临时添加中性三点光;已有灯光只读复用。
- 成功、异常、`jobs.cancel`、场景 dispose 都走同一条幂等恢复路径:恢复材质、
  灯光、背景、fog、相机 aspect / 投影矩阵、renderer 尺寸 / pixelRatio /
  render target / clear color / 色彩空间 / autoClear,以及播放头与播放状态。
  不写 undo、不 bump revision、不持久化任何临时改动。

### 视频编码

- 主路径:`WebCodecs VideoEncoder`(H.264/AVC)+ 包内纯 TypeScript MP4 muxer,
  输出 `video/mp4`,关键帧间隔约 1 秒。
- 码率:1080p 及以上 12 Mbps,720p 及以上 6 Mbps,更小尺寸 4 Mbps。
- 帧时间戳严格按 `i / fps` 计算,总帧数
  `max(1, round((endMs - startMs) / 1000 * fps))`;编码器 flush 后关闭全部
  `VideoFrame`,视频无音轨。
- 仅当 `VideoEncoder` 或 H.264 配置不可用时显式降级到 `MediaRecorder`
  (通常为 WebM)。结果如实返回 `encoding: 'mediarecorder'` 与实际
  `mimeType`,不会伪装成 MP4。
- 用户提前停止时,`durationMs` 报告实际已编码时长。

### 错误

导出使用现有 `AgentApiError`,常见错误码:

`INVALID_ARGUMENT`、`INVALID_ID_KIND`、`OBJECT_NOT_FOUND`、
`INVALID_STATE`、`SCENE_UNAVAILABLE`、`CAPABILITY_UNAVAILABLE`、
`JOB_CANCELLED`、`INTERNAL_ERROR`。

### 桥接

命令与浏览器 JS API 共用同一导出核心。HTTP 桥接的 `hello/schema` 会列出
`exports.captureStill` 与 `exports.startVideo`;任务结果中的 `Blob` 由桥接
上传并替换为 `{fileId, fileName, mimeType, size, width, height, ...}` 文件
描述,绝不把 `Blob` 做 JSON 序列化。

## 已知限制

- 浏览器 H.264 编码档位支持不一致;Safari / Firefox / Chromium 的可用
  profile 与分辨率上限可能不同,不支持时回落到 MediaRecorder。
- MediaRecorder 路径受实时录制能力影响,不保证逐帧确定性;需要严格确定性
  时请确认结果 `encoding === 'webcodecs'`。
- 超大尺寸(接近 `16384` 像素)受 GPU / 编码器内存与 `MAX_TEXTURE_SIZE`
  限制,失败时返回结构化 `CAPABILITY_UNAVAILABLE` / `INTERNAL_ERROR`。
