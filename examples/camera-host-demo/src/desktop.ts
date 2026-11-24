import {
  mountCameraStudioDesktop,
  type CameraStudioDesktopHost,
  type CameraStudioDesktopScene,
} from '@dreamerbird/camera-studio'
import hostMessages from './hostMessages.json'

type DesktopCommand =
  | {type: 'open' | 'close' | 'quit'}
  | {type: 'locale'; locale: keyof typeof hostMessages}

type DesktopIpc = CameraStudioDesktopHost & {
  loadScene(): Promise<CameraStudioDesktopScene>
  finishQuit(): void
  onCommand(listener: (command: DesktopCommand) => void): () => void
}

declare global {
  interface Window {
    cameraStudioDesktop: DesktopIpc
  }
}

const host = window.cameraStudioDesktop
const home = document.querySelector<HTMLElement>('#home')!
const openButton = document.querySelector<HTMLButtonElement>('#open')!
const notice = document.querySelector<HTMLElement>('#error')!

function showError(error: unknown) {
  notice.textContent = error instanceof Error ? error.message : String(error)
  notice.hidden = false
}

const editor = mountCameraStudioDesktop(
  document.querySelector<HTMLElement>('#editor')!,
  {
    saveScene: (scene) => host.saveScene(scene),
    saveExport: (output) => host.saveExport(output),
    async sceneClosed(scene) {
      home.hidden = false
      await host.sceneClosed(scene)
    },
  },
  {
    storage: {namespace: 'camera-host-desktop'},
    assets: {baseUrl: 'app://camera-studio/catalog/'},
    ui: {locale: 'zh-CN'},
    onError: ({message}) => showError(message),
  },
)

let opening: Promise<void> | undefined

function openScene(): Promise<void> {
  if (editor.api) return Promise.resolve()
  if (opening) return opening
  notice.hidden = true
  openButton.disabled = true
  opening = host
    .loadScene()
    .then((scene) => editor.openScene(scene))
    .then(() => {
      home.hidden = true
    })
    .finally(() => {
      openButton.disabled = false
      opening = undefined
    })
  return opening
}

async function handleCommand(command: DesktopCommand) {
  switch (command.type) {
    case 'open':
      await openScene()
      break
    case 'close':
      await opening
      await editor.closeScene()
      break
    case 'locale':
      document.documentElement.lang = command.locale
      document.title = hostMessages[command.locale].desktopTitle
      openButton.textContent = hostMessages[command.locale].openLocal
      editor.setLocale(command.locale)
      break
    case 'quit':
      await opening?.catch(() => {})
      await editor.dispose()
      host.finishQuit()
      break
  }
}

if (host) {
  openButton.addEventListener('click', () => {
    void openScene().catch(showError)
  })
  const unsubscribe = host.onCommand((command) => {
    void handleCommand(command).catch(showError)
  })
  window.addEventListener('pagehide', unsubscribe, {once: true})
  void openScene().catch(showError)
} else {
  openButton.disabled = true
  showError('请从 Electron 桌面示例启动此页面。')
}
