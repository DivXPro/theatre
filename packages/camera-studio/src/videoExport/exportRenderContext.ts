/**
 * 专用导出渲染上下文(2026-11-14)。
 *
 * CameraScene 内一个无渲染组件把 R3F 的 renderer/scene/camera 与手动
 * 帧推进能力登记到这里。导出核心只拿 Three 对象直接渲染,不查询 DOM
 * canvas,也不依赖实时画面刚好停在目标帧。
 */
import type {PerspectiveCamera, Scene, WebGLRenderer} from 'three'

export type FrameloopMode = 'always' | 'demand' | 'never'

export type ExportRenderContext = {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  getCamera(cameraKey: string): PerspectiveCamera | null
  getCanvasSize(): {width: number; height: number}
  getFrameloop(): FrameloopMode
  setFrameloop(mode: FrameloopMode): void
  /** 在有导出的临时场景状态下手动推进一次 R3F 帧,执行 useFrame */
  advance(timestampMs: number): void
  invalidate(): void
}

let current: ExportRenderContext | undefined

export function registerExportRenderContext(
  next: ExportRenderContext,
): () => void {
  current = next
  return () => {
    if (current === next) current = undefined
  }
}

export function getExportRenderContext(): ExportRenderContext | undefined {
  return current
}
