let retainedRoot: HTMLElement | undefined

/** 纯 Node/SSR 没有 DOM:挂载流程应直接跳过,而不是轮询等待。 */
function hasDom(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.getElementById === 'function'
  )
}

export function resetStudioRootCache(): void {
  retainedRoot = undefined
}

export function mountStudioRoot(
  container?: HTMLElement,
): HTMLElement | undefined {
  if (!hasDom()) return undefined
  const root = document.getElementById('theatrejs-studio-root') ?? retainedRoot
  if (!root) return undefined
  retainedRoot = root
  root.dataset.cameraWorkspace = ''

  const target = container ?? document.body
  target.appendChild(root)
  const embedded = target !== document.body
  root.style.position = embedded ? 'absolute' : 'fixed'
  root.style.inset = '0'
  root.style.transform = embedded ? 'translateZ(0)' : ''
  root.style.zIndex = embedded ? '40' : '100'
  return root
}

export async function mountStudioRootWhenReady(
  container?: HTMLElement,
): Promise<HTMLElement | undefined> {
  if (!hasDom()) return undefined
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const root = mountStudioRoot(container)
    if (root) return root
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return undefined
}
