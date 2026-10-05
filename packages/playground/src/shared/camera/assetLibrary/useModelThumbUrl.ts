// packages/playground/src/shared/camera/assetLibrary/useModelThumbUrl.ts
/**
 * 缩略图懒加载 hook:从 AssetLibraryPanel 抽出(2026-10-01 注册制改造),
 * 内置模型框体与注册进站的宿主模型框体(ModelPickerProps.getThumbUrl)共用;
 * 2026-10-05 起姿势/手势选择框也用它(姿势条目的 QBX 预览图)。
 *
 * 用法:卡片渲染时调 getThumbUrl——命中缓存直接给 URL;未命中触发异步
 * 加载并先返回 undefined,加载完成 setState 触发重渲后命中。并发同一
 * 条目只发一次 getBlobUrl;URL 生命周期由后端 session 级缓存管理,这里
 * 不在卸载时 revoke,避免其他消费者拿到失效地址。dropThumbUrl 供删除
 * 条目后清掉该条缓存。
 */
import {useEffect, useRef, useState} from 'react'
import {getLibrary} from './library'

/** 结构只要 id + thumbnailId:模型/姿势条目都满足 */
export type ThumbEntry = {id: string; thumbnailId?: string}

export function useModelThumbUrl(): {
  getThumbUrl: (entry: ThumbEntry) => string | undefined
  dropThumbUrl: (id: string) => void
} {
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  // 防止同一缩略图并发多次 getBlobUrl
  const loadingRef = useRef<Set<string>>(new Set())
  // 卸载后丢弃迟到的加载结果,不写已卸载组件的 state
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const getThumbUrl = (entry: ThumbEntry): string | undefined => {
    if (!entry.thumbnailId) return undefined
    const cached = thumbUrls[entry.id]
    if (cached) return cached
    if (loadingRef.current.has(entry.id)) return undefined
    loadingRef.current.add(entry.id)
    void getLibrary()
      .backend.getBlobUrl(entry.thumbnailId)
      .then((url) => {
        loadingRef.current.delete(entry.id)
        if (!mountedRef.current) return
        setThumbUrls((m) => ({...m, [entry.id]: url}))
      })
      .catch(() => {
        loadingRef.current.delete(entry.id)
      })
    return undefined
  }

  const dropThumbUrl = (id: string): void => {
    setThumbUrls((m) => {
      const {[id]: _, ...rest} = m
      return rest
    })
  }

  return {getThumbUrl, dropThumbUrl}
}
