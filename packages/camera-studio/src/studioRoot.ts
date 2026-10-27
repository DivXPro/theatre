let retainedRoot: HTMLElement | undefined

export function resetStudioRootCache(): void {
  retainedRoot = undefined
}

export function mountStudioRoot(
  container?: HTMLElement,
): HTMLElement | undefined {
  const root = document.getElementById('theatrejs-studio-root') ?? retainedRoot
  if (!root) return undefined
  retainedRoot = root

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
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const root = mountStudioRoot(container)
    if (root) return root
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return undefined
}
