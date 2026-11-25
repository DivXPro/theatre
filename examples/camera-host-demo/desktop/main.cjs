const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
} = require('electron')
const {mkdir, readFile, rename, rm, writeFile} = require('node:fs/promises')
const {randomUUID} = require('node:crypto')
const {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} = require('node:path')
const {pathToFileURL} = require('node:url')
const hostMessages = require('../src/hostMessages.json')

const projectId = 'Desktop Scene'
const entry = 'app://camera-studio/desktop.html'
const dist = resolve(__dirname, '../dist')
const catalog = resolve(__dirname, '../../../packages/camera-studio/assets')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {standard: true, secure: true, supportFetchAPI: true},
  },
])

function serveBundle(request) {
  const {hostname, pathname} = new URL(request.url)
  if (hostname !== 'camera-studio') return new Response(null, {status: 404})
  const asset = pathname.startsWith('/catalog/')
  const root = asset ? catalog : dist
  const path = asset ? pathname.slice('/catalog'.length) : pathname
  const file = resolve(root, `.${decodeURIComponent(path)}`)
  const fromDist = relative(root, file)
  if (
    !fromDist ||
    fromDist === '..' ||
    fromDist.startsWith(`..${sep}`) ||
    isAbsolute(fromDist)
  ) {
    return new Response(null, {status: 404})
  }
  return net.fetch(pathToFileURL(file).href)
}

function createWindow() {
  const language = app.getLocale().split('-')[0].toLowerCase()
  const locale =
    language === 'zh'
      ? 'zh-CN'
      : Object.hasOwn(hostMessages, language)
        ? language
        : 'en'
  const messages = hostMessages[locale]
  const window = new BrowserWindow({
    title: messages.desktopTitle,
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const sceneDirectory = join(app.getPath('userData'), 'camera-studio-desktop')
  const sceneFile = join(sceneDirectory, 'scene.json')
  const channels = []
  let connected = false
  let quitting = false

  function isEditor(event) {
    return (
      event.sender === window.webContents && event.senderFrame?.url === entry
    )
  }

  function handle(channel, handler) {
    const name = `camera-studio:${channel}`
    ipcMain.handle(name, (event, value) => {
      if (!isEditor(event)) throw new Error('Unknown Camera Studio renderer')
      return handler(value)
    })
    channels.push(name)
  }

  function send(command) {
    if (connected) window.webContents.send('camera-studio:command', command)
  }

  const hostTheme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  const onThemeChanged = () => send({type: 'theme', theme: hostTheme()})
  nativeTheme.on('updated', onThemeChanged)

  handle('load-scene', async () => {
    connected = true
    let initialState
    try {
      initialState = JSON.parse(await readFile(sceneFile, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return {projectId, initialState, locale, theme: hostTheme()}
  })
  handle('save-scene', async ({projectId: id, state}) => {
    if (id !== projectId) throw new Error('Unknown scene')
    const temp = `${sceneFile}.${randomUUID()}.tmp`
    await mkdir(sceneDirectory, {recursive: true})
    try {
      await writeFile(temp, JSON.stringify(state), {flag: 'wx'})
      await rename(temp, sceneFile)
    } finally {
      await rm(temp, {force: true})
    }
  })
  handle(
    'save-export',
    async ({projectId: id, kind, fileName, mimeType, data}) => {
      const extension =
        mimeType === 'image/png' && kind === 'image'
          ? 'png'
          : kind === 'video' && mimeType.startsWith('video/mp4')
            ? 'mp4'
            : kind === 'video' && mimeType.startsWith('video/webm')
              ? 'webm'
              : undefined
      if (
        id !== projectId ||
        !(data instanceof ArrayBuffer) ||
        !extension ||
        !data.byteLength
      ) {
        throw new Error('Invalid Camera Studio export')
      }
      const target = await dialog.showSaveDialog(window, {
        defaultPath: basename(fileName),
        filters: [{name: extension.toUpperCase(), extensions: [extension]}],
      })
      if (!target.canceled) await writeFile(target.filePath, Buffer.from(data))
    },
  )
  handle('scene-closed', ({projectId: id}) => {
    if (id !== projectId) throw new Error('Unknown scene')
    window.setTitle(`${messages.desktopTitle} · ${messages.closeScene}`)
  })

  const finishQuit = (event) => {
    if (!isEditor(event)) return
    quitting = true
    window.close()
  }
  ipcMain.on('camera-studio:finish-quit', finishQuit)
  window.on('close', (event) => {
    if (!connected || quitting) return
    event.preventDefault()
    send({type: 'quit'})
  })
  window.on('closed', () => {
    nativeTheme.removeListener('updated', onThemeChanged)
    for (const channel of channels) ipcMain.removeHandler(channel)
    ipcMain.removeListener('camera-studio:finish-quit', finishQuit)
  })
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: messages.scene,
        submenu: [
          {label: messages.openLocal, click: () => send({type: 'open'})},
          {label: messages.closeScene, click: () => send({type: 'close'})},
          {
            label: messages.quit,
            accelerator: 'CommandOrControl+Q',
            click: () => window.close(),
          },
        ],
      },
    ]),
  )
  void window.loadURL(entry)
}

void app.whenReady().then(() => {
  protocol.handle('app', serveBundle)
  createWindow()
})
app.on('window-all-closed', () => app.quit())
