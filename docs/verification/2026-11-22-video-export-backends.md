# 视频导出双路径验证（H.264 WebCodecs / MediaRecorder）

日期：2026-11-22

## 范围

本记录覆盖 Previs 视频导出的两条路径：

1. WebCodecs H.264 主路径，输出 MP4；
2. MediaRecorder 降级路径，输出浏览器实际支持的 WebM。

同时验证导出期间的动作采样，与时间轴上同一时刻 seek 后的角色姿势一致。

## 验证环境

- macOS
- Google Chrome 157.0.0.0（桌面版，本地 `127.0.0.1` 安全上下文）
- 测试场景：Y Bot 单角色、3 秒 `QA Arc` 动作片段、15 fps、单条动作轨
- 相机：从导演视角创建的 `Shot Camera`
- 序列长度：5 秒

## 样片

### H.264 MP4 主路径

文件：[2026-11-22-h264-640x360-3s.mp4](./samples/2026-11-22-h264-640x360-3s.mp4)

```text
容器:      MP4
编码路径:  webcodecs
编码:      avc1.640028 (H.264 High)
分辨率:    640x360
帧率:      15 fps
时长:      3.000 s
帧数:      45
大小:      231123 bytes
SHA-256:   2f37653276342a892f663ad655530ee9790fc4dc114a16f4f8d575686696175a
```

验证结果：

- Chrome 中完整播放到 `ended`。
- `ffprobe` 读取到 45 帧。
- `ffmpeg -f null -` 全帧解码无错误。
- 1.5 秒帧截图：[2026-11-22-h264-frame-1500ms.png](./samples/2026-11-22-h264-frame-1500ms.png)

### MediaRecorder WebM 降级路径

文件：[2026-11-22-mediarecorder-vp9-320x180.webm](./samples/2026-11-22-mediarecorder-vp9-320x180.webm)

```text
容器:      WebM
编码路径:  mediarecorder
编码:      vp9
分辨率:    320x180
请求帧率:  15 fps
帧数:      18
实际末帧:  1.294 s
容器时长:  未写入（MediaRecorder 路径）
大小:      16473 bytes
SHA-256:   5dfa1b126d38210711a608b8487dc6f29201ca417731f105b3a5989a32e9d709
```

验证结果：

- 桌面 Chrome 中完整播放到 `ended`。
- `ffprobe` 读取到 18 帧。
- MediaRecorder 按真实时间录制，采样间隔不保证严格等于请求的 15 fps。

## 姿势一致性

H.264 完整导出期间记录每一帧的骨骼位置与四元数，共 45 个采样。

导出完成后，按每个采样对应的绝对时间执行时间轴 seek，再读取骨骼姿势：

```text
采样数:                 45
期望帧数:               45
首帧时间:               0.000000 s
末帧时间:               2.933333 s
位置/四元数最大差值:    0
```

导出结束后播放头恢复为导出前位置，播放状态保持暂停。

## 问题与修复

### H.264 主路径未启用

现象：桌面 Chrome 的 `VideoEncoder.isConfigSupported()` 已支持 H.264，
但导出仍降级到 MediaRecorder。

根因：

- `WebCodecsH264Writer.create()` 使用 `OffscreenCanvas` 预检 `VideoFrame`；
- Chrome 在画布尚未创建 2D 上下文时抛出 `Invalid source state`；
- 初始化异常被捕获后静默返回 `null`，于是触发降级。

修复：

- 创建视频帧画布时先初始化 2D 上下文，再交给 WebCodecs。

### MediaRecorder 首帧死锁

现象：MediaRecorder 导出停在 `accepted` / `progress: 0`。

根因：

- Chrome 在收到首帧后才发出 MediaRecorder `start` 事件；
- 原实现等待 `start` 后才提交首帧；
- 两边互相等待，录制无法开始。

修复：

- 首次 `addFrame()` 时启动录制，先 `requestFrame()` 并绘制首帧，再等待
  `start`；
- 首帧和停止均增加超时；
- 取消会立即中止录制并释放视频轨，避免异步任务悬挂；
- 录制器没有产出任何数据时抛出 `INTERNAL_ERROR`，不再静默返回空视频。

## 回归验证

```bash
node_modules/.bin/jest --runInBand --forceExit \
  --modulePathIgnorePatterns='/Users/huhui/Projects/theatre/.worktrees/|/prisma/client-generated/' \
  --runTestsByPath \
  packages/camera-studio/src/videoExport/sceneCapture.test.ts \
  packages/camera-studio/src/videoExport/videoEncoding.test.ts \
  packages/camera-studio/src/videoExport/videoEncoding.mediaRecorder.test.ts \
  packages/camera-studio/src/videoExport/mp4Muxer.test.ts \
  packages/camera-studio/src/videoExport/previsExporter.test.ts \
  packages/camera-studio/src/agent/commands/exports.test.ts

node_modules/.bin/tsc -b packages/camera-studio --pretty false
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=codec_name,width,height,nb_read_frames,r_frame_rate,duration \
  -of json docs/verification/samples/2026-11-22-h264-640x360-3s.mp4
ffmpeg -v error -i docs/verification/samples/2026-11-22-h264-640x360-3s.mp4 -f null -
```

结果：

```text
Test Suites: 6 passed, 6 total
Tests:       35 passed, 35 total
TypeScript:  passed
```
