import {useLayoutEffect, useRef} from 'react'
import {useFrame, useThree} from '@react-three/fiber'
import {createMangaViewport} from './mangaViewport'
import type {MangaViewportOptions, ViewportRenderMode} from './mangaViewport'

export function useMangaViewport(
  mode: ViewportRenderMode,
  options: MangaViewportOptions | undefined,
) {
  const invalidate = useThree((state) => state.invalidate)
  const renderer = useRef<ReturnType<typeof createMangaViewport> | null>(null)
  const enabled = mode !== 'original'
  useLayoutEffect(() => {
    if (!enabled) return
    const instance = createMangaViewport()
    renderer.current = instance
    return () => {
      renderer.current = null
      instance.dispose()
      invalidate()
    }
  }, [enabled, invalidate])
  useLayoutEffect(() => {
    invalidate()
  }, [invalidate, mode, options])
  return renderer
}

export function MangaViewportFrame({
  mode,
  options,
}: {
  mode: ViewportRenderMode
  options: MangaViewportOptions | undefined
}) {
  const renderer = useMangaViewport(mode, options)
  useFrame(({gl, scene, camera, size}) => {
    renderer.current?.render(gl, scene, camera, size, mode, options, true)
  }, 1)
  return null
}
