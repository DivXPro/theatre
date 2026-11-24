/**
 * useCameraStudio(spec §3/§7):宿主唯一的初始化入口。
 *
 * - config 只在首帧取一次(useRef 锁存):后续渲染传新配置不热更,
 *   与 theatre.init 的一次性语义对齐;已 boot 后重挂换 config 不生效
 *   (模块级 promise 复用首 boot),console.warn 点名差异键;换配置需
 *   整页刷新,或在全部消费者卸载后显式 resetCameraStudio。
 * - 状态机:idle → initializing → ready / error;init 挂 bootstrap 的
 *   共享 promise,StrictMode 双跑/重复触发只复用。
 * - 单页单实例(studio 全局单例):同页第二个实例不占位、直接 error。
 * - 卸载清理由 disposeCameraStudio 对称执行(编辑器注销/状态订阅断开+
 *   flush/ui.hide);重挂幂等复用 boot,会话级资源重新装配 + ui.restore。
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {translate} from '@dreamerbird/studio/i18n'
import type {CameraStudioConfig, CameraStudioHandle} from './config'
import {
  acquireCameraStudioConsumer,
  disposeCameraStudio,
  getBootConfig,
  initCameraStudio,
  isBootedWithDifferentConfig,
  releaseCameraStudioConsumer,
  resetCameraStudio,
  resolveSceneProps,
} from './bootstrap'
import type {BootCtx} from './bootstrap'
import {getCameraStudioApi} from './agent/api'

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
  const [closed, setClosed] = useState(false)
  const activeContext = useRef<BootCtx | undefined>(undefined)
  const closePromise = useRef<Promise<void> | undefined>(undefined)
  const finishClose = useRef<(() => void) | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>({
    ready: false,
    error: undefined,
    ctx: undefined,
  })

  useEffect(() => {
    if (closed) return
    if (!acquireCameraStudioConsumer()) {
      setPhase({
        ready: false,
        error: new Error(
          '单页只允许一个 CameraScene 实例:同页第二个 useCameraStudio 被拒绝',
        ),
        ctx: undefined,
      })
      return
    }
    let cancelled = false
    let ctxRef: BootCtx | undefined
    void initCameraStudio(configRef.current).then(
      (ctx) => {
        if (cancelled) {
          // 卸载先于 init 解析:补一次 dispose(内部末位守卫决定拆不拆)
          void disposeCameraStudio(ctx).catch(() => {})
          return
        }
        ctxRef = ctx
        activeContext.current = ctx
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
      activeContext.current = undefined
      const remaining = releaseCameraStudioConsumer()
      if (finishClose.current) {
        const finish = finishClose.current
        finishClose.current = undefined
        // reset 等待 boot 上下文，让当前 React 提交先跑完场景清理。
        finish()
        return
      }
      // 最后一位消费者退场才拆解会话;init 未解析则由上面 cancelled 分支补
      if (remaining === 0 && ctxRef)
        void disposeCameraStudio(ctxRef).catch(() => {})
    }
  }, [closed])

  const closeScene = useCallback((): Promise<void> => {
    if (closePromise.current) return closePromise.current
    const ctx = activeContext.current
    if (!ctx)
      return Promise.reject(new Error('Camera Studio scene is not ready'))

    const close = (async () => {
      // flushState 自己会上报保存失败，保留场景供宿主重试。
      await ctx.flushState()
      try {
        if (activeContext.current !== ctx) {
          throw new Error('Camera Studio scene was unmounted while closing')
        }
        if (ctx.hasTemporaryChanges()) {
          throw new Error(translate('pg.toolbar.closeScene.pending'))
        }
        const projectId = ctx.sceneProps.project.address.projectId
        await new Promise<void>((resolve, reject) => {
          finishClose.current = () => {
            // 仅清除宿主管理的场景快照，保留独立模式的浏览器持久化。
            const teardown = ctx.config.state
              ? resetCameraStudio()
              : disposeCameraStudio(ctx)
            void teardown.then(resolve, (error) => {
              // 若最后一轮保存失败，重新挂载保留的项目以便重试。
              closePromise.current = undefined
              setClosed(false)
              reject(error)
            })
          }
          setPhase({ready: false, error: undefined, ctx: undefined})
          setClosed(true)
        })
        await configRef.current.onSceneClosed?.({projectId})
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        const onError = configRef.current.onError
        if (onError) onError({source: 'state', code: 'unknown', message, cause})
        else console.error(`[camera-studio] ${message}`, cause)
        throw cause
      }
    })()
    closePromise.current = close
    void close.catch(() => {
      if (activeContext.current === ctx) closePromise.current = undefined
    })
    return close
  }, [])

  // sceneProps 同步解析(getProject 渲染期调用安全,App 既有先例):
  // ready 前的占位也是真值,宿主提前渲染不炸;boot 完成后与 ctx 内一致。
  // 已 boot 且本次 config 与首 boot 不一致时,占位按首 boot 配置解析
  // (沿用首次配置,不为新 config 调 getProject 造闲置 IProject;差异
  // 告警由 initCameraStudio 发出,终审 I-1(b)③)
  const earlySceneProps = useMemo(() => {
    const cfg = isBootedWithDifferentConfig(configRef.current)
      ? getBootConfig() ?? configRef.current
      : configRef.current
    return resolveSceneProps(cfg)
  }, [])
  const baseSceneProps = phase.ctx?.sceneProps ?? earlySceneProps
  const sceneProps = useMemo(
    () => ({
      ...baseSceneProps,
      onCloseScene: configRef.current.onSceneClosed
        ? () => {
            void closeScene().catch(() => {})
          }
        : undefined,
    }),
    [baseSceneProps, closeScene],
  )
  // api 是模块级单例:首帧(占位)与 boot 完成后返回同一对象(Task 15)
  return {
    ready: phase.ready && !closed,
    error: phase.error,
    sceneProps,
    api: getCameraStudioApi(),
    closeScene,
    flushState: () => phase.ctx?.flushState() ?? Promise.resolve(),
    hasTemporaryChanges: () => phase.ctx?.hasTemporaryChanges() ?? false,
  }
}
