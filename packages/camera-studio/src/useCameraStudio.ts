/**
 * useCameraStudio(spec §3/§7):宿主唯一的初始化入口。
 *
 * - config 只在首帧取一次(useRef 锁存):后续渲染传新配置不热更,
 *   与 theatre.init 的一次性语义对齐;宿主文档注明「配置要变请重挂页面」。
 * - 状态机:idle → initializing → ready / error;init 挂 bootstrap 的
 *   共享 promise,StrictMode 双跑/重复触发只复用。
 * - 单页单实例(studio 全局单例):同页第二个实例不占位、直接 error。
 * - 卸载清理由 disposeCameraStudio 对称执行(编辑器注销/状态订阅断开+
 *   flush/ui.hide);重挂幂等复用 boot,会话级资源重新装配 + ui.restore。
 */
import {useEffect, useMemo, useRef, useState} from 'react'
import type {CameraStudioConfig, CameraStudioHandle} from './config'
import {
  acquireCameraStudioConsumer,
  disposeCameraStudio,
  initCameraStudio,
  releaseCameraStudioConsumer,
  resolveSceneProps,
} from './bootstrap'
import type {BootCtx} from './bootstrap'

type Phase = {
  ready: boolean
  error: Error | undefined
  ctx: BootCtx | undefined
}

export function useCameraStudio(
  config: CameraStudioConfig = {},
): CameraStudioHandle {
  // config 首帧锁存(变更不热更)
  const configRef = useRef(config)
  const [phase, setPhase] = useState<Phase>({
    ready: false,
    error: undefined,
    ctx: undefined,
  })

  useEffect(() => {
    const slot = acquireCameraStudioConsumer()
    if (slot > 1) {
      setPhase({
        ready: false,
        error: new Error(
          '单页只允许一个 CameraScene 实例:同页第二个 useCameraStudio 被拒绝',
        ),
        ctx: undefined,
      })
      return () => {
        // 报错实例不占会话;但若是最后离场者,要替正常实例补拆(其 cleanup
        // 在还有消费者时按守卫跳过拆解)
        if (releaseCameraStudioConsumer() === 0) void disposeCameraStudio()
      }
    }
    let cancelled = false
    let ctxRef: BootCtx | undefined
    void initCameraStudio(configRef.current).then(
      (ctx) => {
        if (cancelled) {
          // 卸载先于 init 解析:补一次 dispose(内部末位守卫决定拆不拆)
          void disposeCameraStudio(ctx)
          return
        }
        ctxRef = ctx
        setPhase({ready: true, error: undefined, ctx})
      },
      (error) => {
        if (cancelled) return
        setPhase({
          ready: false,
          error: error instanceof Error ? error : new Error(String(error)),
          ctx: undefined,
        })
      },
    )
    return () => {
      cancelled = true
      const remaining = releaseCameraStudioConsumer()
      // 最后一位消费者退场才拆解会话;init 未解析则由上面 cancelled 分支补
      if (remaining === 0 && ctxRef) void disposeCameraStudio(ctxRef)
    }
  }, [])

  // sceneProps 同步解析(getProject 渲染期调用安全,App 既有先例):
  // ready 前的占位也是真值,宿主提前渲染不炸;boot 完成后与 ctx 内一致
  const earlySceneProps = useMemo(
    () => resolveSceneProps(configRef.current),
    [],
  )
  const sceneProps = phase.ctx?.sceneProps ?? earlySceneProps
  return {ready: phase.ready, error: phase.error, sceneProps}
}
